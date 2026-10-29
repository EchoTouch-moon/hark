/**
 * @fileoverview 项目洞察查询与统计服务
 * 
 * 职责：
 * 1. 洞察列表多维度组合检索（项目、状态集合、严重性、游标分页）；
 * 2. 复合游标编码与游标后查询（statusRank > severityRank > observedAt > insightId 严格确定性排序）；
 * 3. 模板文案渲染（根据参数字典安全拼接标题与详情内容，转义潜在特殊字符）；
 * 4. 证据可访问性检查（AVAILABLE/MISSING/UNAVAILABLE）；
 * 5. 全局洞察概览汇总（引擎评估健康状态、各项目待处理洞察数）。
 */

import { DEFAULT_RULE_POLICY, type InsightFeedbackKind, type InsightStatus } from '../contracts.js';
import { InsightError } from '../errors.js';
import { renderDetail, renderTitle, sanitizeTemplateData } from '../rules/templates.js';
import type { InsightStore } from '../store/store.js';

/** 默认查询的状态集合（待处理与已确认） */
export const DEFAULT_FEED_STATUSES: InsightStatus[] = ['OPEN', 'ACKNOWLEDGED'];

const STATUS_RANK: Record<string, number> = {
  OPEN: 0,
  ACKNOWLEDGED: 1,
  DISMISSED: 2,
  RESOLVED: 3,
  WITHDRAWN: 4,
};
const SEVERITY_RANK: Record<string, number> = { important: 0, attention: 1, info: 2 };

/** 洞察列表分页查询参数 */
export interface InsightListQuery {
  /** 限制所属项目 ID（可选） */
  projectId?: string;
  /** 状态筛选集合（默认 OPEN 与 ACKNOWLEDGED） */
  statuses?: InsightStatus[];
  /** 严重性级别筛选 */
  severity?: 'info' | 'attention' | 'important';
  /** 分页游标 */
  cursor?: string;
  /** 每页返回记录数（默认 20，上限 50） */
  limit?: number;
}

/** 列表项简要视图模型 */
export interface InsightListItem {
  id: string;
  projectId: string;
  streamEpoch: number;
  episodeKey: string;
  status: InsightStatus;
  severity: 'info' | 'attention' | 'important';
  confidence: 'low' | 'medium' | 'high';
  primaryRuleId: string;
  primaryRuleVersion: string;
  title: string;
  summary: string;
  observedAt: string;
  headBinding: string;
  evidenceCount: number;
  evidenceAvailability: 'AVAILABLE' | 'MISSING' | 'UNAVAILABLE';
  historical: boolean;
  feedback: InsightFeedbackKind | null;
}

/** 洞察详情视图模型（含关联规则、原因代码、证据详情与模板变量） */
export interface InsightDetail extends InsightListItem {
  issueFamily: string;
  reasonCodes: string[];
  templateData: Record<string, string | number | boolean | null>;
  firstObservedAt: string;
  observeHref: string;
  evidence: Array<{
    role: string;
    sourceKind: string;
    sourceId: string;
    quality: string;
  }>;
  engineFrozen: boolean;
}

/** 洞察引擎全局健康度与待处理汇总 */
export interface InsightSummary {
  /** 引擎健康度：NOT_EVALUATED（尚未评估）、OK（健康运行）、DEGRADED（部分项目降级冻结） */
  engineHealth: 'NOT_EVALUATED' | 'OK' | 'DEGRADED';
  /** 全局待关注洞察总数 */
  openCount: number;
  /** 各项目待关注分布 */
  projects: Array<{ projectId: string; openCount: number }>;
}

type EpisodeRow = Record<string, unknown>;

function asString(value: unknown): string {
  return String(value);
}

function statusRank(status: string): number {
  return STATUS_RANK[status] ?? 9;
}

function severityRank(severity: string): number {
  return SEVERITY_RANK[severity] ?? 9;
}

function parseCursor(cursor: string): { sr: number; vr: number; at: string; id: string } | null {
  const parts = cursor.split('|');
  if (parts.length !== 4) return null;
  const sr = Number(parts[0]);
  const vr = Number(parts[1]);
  const at = parts[2];
  const id = parts[3];
  if (!Number.isFinite(sr) || !Number.isFinite(vr) || at === undefined || id === undefined) return null;
  return { sr, vr, at, id };
}

function encodeCursor(item: { status: string; severity: string; observedAt: string; id: string }): string {
  return `${statusRank(item.status)}|${severityRank(item.severity)}|${item.observedAt}|${item.id}`;
}

function afterCursorSql(cursor: { sr: number; vr: number; at: string; id: string }): { sql: string; params: Array<string | number> } {
  return {
    sql: `AND (
      CASE e.status WHEN 'OPEN' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1 WHEN 'DISMISSED' THEN 2 WHEN 'RESOLVED' THEN 3 ELSE 4 END > ?
      OR (
        CASE e.status WHEN 'OPEN' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1 WHEN 'DISMISSED' THEN 2 WHEN 'RESOLVED' THEN 3 ELSE 4 END = ?
        AND CASE e.severity WHEN 'important' THEN 0 WHEN 'attention' THEN 1 ELSE 2 END > ?
      )
      OR (
        CASE e.status WHEN 'OPEN' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1 WHEN 'DISMISSED' THEN 2 WHEN 'RESOLVED' THEN 3 ELSE 4 END = ?
        AND CASE e.severity WHEN 'important' THEN 0 WHEN 'attention' THEN 1 ELSE 2 END = ?
        AND (e.last_material_observed_at < ? OR (e.last_material_observed_at = ? AND e.insight_id < ?))
      )
    )`,
    params: [cursor.sr, cursor.sr, cursor.vr, cursor.sr, cursor.vr, cursor.at, cursor.at, cursor.id],
  };
}

function reasonCodesFor(titleKey: string, primaryRuleId: string): string[] {
  switch (titleKey) {
    case 'test_failure_observed':
      return ['junit_failures_gt_0'];
    case 'test_result_changed':
      return ['junit_zero_to_fail'];
    case 'observation_gap_detected':
      return ['observation_gap_event'];
    case 'observer_health_degraded':
      return ['adapter_error_streak'];
    case 'repository_unavailable':
      return ['repo_unavailable_streak'];
    default:
      return [primaryRuleId];
  }
}

function evidenceAvailability(store: InsightStore, projectId: string, openingSignalId: string): 'AVAILABLE' | 'MISSING' | 'UNAVAILABLE' {
  const interrupted = store
    .listInterruptions(projectId)
    .some(
      (item) =>
        item.resolutionStatus === 'OPEN' &&
        (item.interruptionType === 'PROJECT_REMOVED' || item.interruptionType === 'CURSOR_AHEAD_OF_STREAM'),
    );
  if (interrupted) return 'UNAVAILABLE';
  const row = store.db.prepare('SELECT 1 AS ok FROM signal_inbox WHERE signal_id = ?').get(openingSignalId) as
    | { ok: number }
    | undefined;
  return row === undefined ? 'MISSING' : 'AVAILABLE';
}

function engineFrozen(store: InsightStore, projectId: string): boolean {
  const progress = store.db
    .prepare(`SELECT state FROM insight_rule_progress WHERE project_id = ? AND state = 'FROZEN' LIMIT 1`)
    .get(projectId) as { state: string } | undefined;
  if (progress !== undefined) return true;
  return store.listCheckpoints(projectId).some((item) => item.status === 'FROZEN');
}

function toItem(store: InsightStore, row: EpisodeRow): InsightListItem {
  const template = sanitizeTemplateData(JSON.parse(asString(row['template_data_json'])) as Record<string, unknown>);
  const titleKey = asString(row['title_key']);
  const detailKey = asString(row['detail_key']);
  const projectId = asString(row['project_id']);
  const opening = asString(row['opening_signal_id']);
  const countRow = store.db
    .prepare('SELECT COUNT(*) AS n FROM insight_evidence_refs WHERE insight_id = ?')
    .get(asString(row['insight_id'])) as { n: number };
  return {
    id: asString(row['insight_id']),
    projectId,
    streamEpoch: Number(row['stream_epoch']),
    episodeKey: asString(row['episode_key']),
    status: asString(row['status']) as InsightStatus,
    severity: asString(row['severity']) as InsightListItem['severity'],
    confidence: asString(row['confidence']) as InsightListItem['confidence'],
    primaryRuleId: asString(row['primary_rule_id']),
    primaryRuleVersion: asString(row['primary_rule_version']),
    title: renderTitle(titleKey, template),
    summary: renderDetail(detailKey, template),
    observedAt: asString(row['last_material_observed_at']),
    headBinding: 'UNDETERMINED',
    evidenceCount: Number(countRow.n),
    evidenceAvailability: evidenceAvailability(store, projectId, opening),
    historical: Number(row['historical']) === 1,
    feedback: row['feedback_kind'] == null ? null : (asString(row['feedback_kind']) as InsightFeedbackKind),
  };
}

/**
 * 分页检索项目洞察列表
 * 
 * 排序逻辑：
 * 1. 状态权重（OPEN -> ACKNOWLEDGED -> DISMISSED -> RESOLVED -> WITHDRAWN）；
 * 2. 严重性（important -> attention -> info）；
 * 3. 观察时间倒序（最新优先）；
 * 4. insightId 倒序（保证严格确定性）。
 */
export function listInsights(store: InsightStore, query: InsightListQuery): { items: InsightListItem[]; nextCursor: string | null } {
  const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
  const statuses = query.statuses !== undefined && query.statuses.length > 0 ? query.statuses : DEFAULT_FEED_STATUSES;
  const params: Array<string | number> = [];
  let sql = `SELECT e.*, f.kind AS feedback_kind
    FROM insight_episodes e
    LEFT JOIN insight_feedback f ON f.insight_id = e.insight_id
    WHERE 1=1`;
  if (query.projectId !== undefined) {
    sql += ' AND e.project_id = ?';
    params.push(query.projectId);
  }
  sql += ` AND e.status IN (${statuses.map(() => '?').join(',')})`;
  params.push(...statuses);
  if (query.severity !== undefined) {
    sql += ' AND e.severity = ?';
    params.push(query.severity);
  }
  if (query.cursor !== undefined) {
    const parsed = parseCursor(query.cursor);
    if (parsed === null) throw new InsightError('INVALID_CURSOR', 'insight cursor is malformed');
    const extra = afterCursorSql(parsed);
    sql += ` ${extra.sql}`;
    params.push(...extra.params);
  }
  sql += ` ORDER BY
    CASE e.status WHEN 'OPEN' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1 WHEN 'DISMISSED' THEN 2 WHEN 'RESOLVED' THEN 3 ELSE 4 END,
    CASE e.severity WHEN 'important' THEN 0 WHEN 'attention' THEN 1 ELSE 2 END,
    e.last_material_observed_at DESC,
    e.insight_id DESC
    LIMIT ?`;
  params.push(limit + 1);
  const rows = store.db.prepare(sql).all(...params) as EpisodeRow[];
  const page = rows.slice(0, limit).map((row) => toItem(store, row));
  const extra = rows[limit];
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor:
      extra !== undefined && last !== undefined
        ? encodeCursor({ status: last.status, severity: last.severity, observedAt: last.observedAt, id: last.id })
        : null,
  };
}

/**
 * 获取指定单条洞察的完整详情（含证据链与模板上下文）
 */
export function getInsight(store: InsightStore, id: string): InsightDetail | null {
  const row = store.db
    .prepare(
      `SELECT e.*, f.kind AS feedback_kind
       FROM insight_episodes e
       LEFT JOIN insight_feedback f ON f.insight_id = e.insight_id
       WHERE e.insight_id = ?`,
    )
    .get(id) as EpisodeRow | undefined;
  if (row === undefined) return null;
  const item = toItem(store, row);
  const refs = store.db
    .prepare('SELECT role, source_kind AS sourceKind, source_id AS sourceId, quality FROM insight_evidence_refs WHERE insight_id = ?')
    .all(id) as Array<{ role: string; sourceKind: string; sourceId: string; quality: string }>;
  const template = sanitizeTemplateData(JSON.parse(asString(row['template_data_json'])) as Record<string, unknown>);
  return {
    ...item,
    issueFamily: asString(row['issue_family']),
    reasonCodes: reasonCodesFor(asString(row['title_key']), item.primaryRuleId),
    templateData: template,
    firstObservedAt: asString(row['first_observed_at']),
    observeHref: `/observe/${item.projectId}`,
    evidence: refs,
    engineFrozen: engineFrozen(store, item.projectId),
  };
}

/**
 * 汇总当前洞察引擎的整体健康度与各项目待处理数
 */
export function summarizeInsights(store: InsightStore): InsightSummary {
  const progress = store.db.prepare('SELECT COUNT(*) AS n FROM insight_rule_progress').get() as { n: number };
  const frozen = store.db.prepare(`SELECT COUNT(*) AS n FROM insight_rule_progress WHERE state = 'FROZEN'`).get() as {
    n: number;
  };
  const openRows = store.db
    .prepare(
      `SELECT project_id AS projectId, COUNT(*) AS openCount
       FROM insight_episodes
       WHERE status IN ('OPEN', 'ACKNOWLEDGED')
       GROUP BY project_id`,
    )
    .all() as Array<{ projectId: string; openCount: number }>;
  const openCount = openRows.reduce((sum, row) => sum + Number(row.openCount), 0);
  let engineHealth: InsightSummary['engineHealth'] = 'OK';
  if (Number(progress.n) === 0 && openCount === 0) engineHealth = 'NOT_EVALUATED';
  else if (Number(frozen.n) > 0) engineHealth = 'DEGRADED';
  return { engineHealth, openCount, projects: openRows.map((row) => ({ projectId: row.projectId, openCount: Number(row.openCount) })) };
}

/**
 * 获取当前生效的规则判定策略配置
 */
export function insightPolicy(): { rules: typeof DEFAULT_RULE_POLICY } {
  return { rules: DEFAULT_RULE_POLICY };
}
