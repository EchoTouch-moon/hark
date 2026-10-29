/**
 * @fileoverview 项目洞察规则评估与事件流处理引擎
 *
 * 职责：
 * 1. 增量拉取项目收件箱（inbox）未处理的信号流，按 appendSeq 批量顺序评估；
 * 2. 状态机与历史基准线管理（BaselineMode），区分历史回填与实时新发生的洞察；
 * 3. 冲突消解与降噪（如当检测到仓库不可访问时，压制观察健康报警）；
 * 4. 连续性（streak）跟踪与规则匹配，产生 Candidate（触发开启洞察）与 Recovery（触发自动恢复闭环）；
 * 5. 跨表事务原子性写入：创建/关闭 Episode、更新消费进度与修订版本号（revision）。
 */

import { SignalSchema, type Signal } from '../contracts.js';
import { InsightError } from '../errors.js';
import { pickPrimaryCandidate, suppressHealthIfRepoActive } from '../episodes/conflicts.js';
import { issueKeyFor } from '../episodes/identity.js';
import {
  reduceCandidate,
  reduceRecovery,
  type IssueRecord,
  type StoredEpisode,
} from '../episodes/reduce.js';
import { defaultInsightPolicy } from '../rules/policy.js';
import { evaluateSignal } from '../rules/registry.js';
import { RULESET_VERSION, type ActiveIssue, type RuleStateSnapshot, type StreakState } from '../rules/types.js';
import type { InsightStore } from '../store/store.js';

/** 测试用事务故障注入点 */
export type RuleFault = 'after-episodes' | 'after-progress' | 'before-commit';

/** 基准线处理模式：none 为全量评估；existing-inbox 为将现有历史信号作为基准线不产生新通知 */
export type BaselineMode = 'none' | 'existing-inbox';

/** 规则处理输入参数 */
export interface ProcessRulesInput {
  /** 目标项目 ID */
  projectId: string;
  /** 流代际编号（streamEpoch） */
  streamEpoch: number;
  /** 单批次最大处理信号数（默认 50，上限 200） */
  limit?: number;
  /** 基准线模式 */
  baseline?: BaselineMode;
  /** 故障注入（测试用） */
  fault?: RuleFault;
}

/** 规则批次处理结果 */
export interface ProcessRulesResult {
  /** 执行结果状态码：OK（正常且有产出）、NO_INSIGHT（无新洞察）、FROZEN（引擎冻结挂起）、EMPTY（收件箱无新信号） */
  outcome: 'OK' | 'NO_INSIGHT' | 'FROZEN' | 'EMPTY';
  /** 是否向数据库写入了变更 */
  written: boolean;
  /** 本批次新开启的 Episode 数 */
  episodesOpened: number;
  /** 本批次自动恢复闭环的 Episode 数 */
  episodesResolved: number;
  /** 本批次读取并评估的信号数 */
  signalsRead: number;
  /** 最后处理成功的 appendSeq */
  lastAppendSeq: number;
  /** 最后处理成功的 signalId */
  lastSignalId: string;
  /** 当前项目的进度修订版本号 */
  revision: number;
}

type Row = Record<string, unknown>;

/**
 * 驱动单个项目的规则评估流程
 *
 * @param store 洞察持久化存储接口
 * @param input 项目 ID 与处理批次参数
 * @returns 批次评估产出与最新消费游标
 */
export function processProjectRules(store: InsightStore, input: ProcessRulesInput): ProcessRulesResult {
  const consumer = store.getCheckpoint(input.projectId, input.streamEpoch);
  if (consumer?.status === 'FROZEN') {
    freezeProgress(store, input);
    return empty('FROZEN', input);
  }
  const interruptions = store.listInterruptions(input.projectId);
  if (interruptions.some((item) => item.resolutionStatus === 'OPEN' && isResetType(item.interruptionType))) {
    freezeProgress(store, input);
    return empty('FROZEN', input);
  }

  const progress = getProgress(store, input.projectId, input.streamEpoch);
  if (progress?.state === 'FROZEN') return empty('FROZEN', input, progress);

  const afterSeq = progress?.lastAppendSeq ?? 0;
  const afterId = progress?.lastSignalId ?? '';
  const rows = store.listInboxAfter({
    projectId: input.projectId,
    streamEpoch: input.streamEpoch,
    afterSeq,
    afterSignalId: afterId,
    limit: Math.min(Math.max(input.limit ?? 50, 1), 200),
  });
  if (rows.length === 0) {
    return empty('EMPTY', input, progress);
  }

  const baselineUntil =
    progress?.baselineUntilSeq ??
    (input.baseline === 'existing-inbox' ? store.maxInboxSeq(input.projectId, input.streamEpoch) : 0);

  const policy = defaultInsightPolicy();
  const clockNow = store.nowIso();
  const mutations: Array<{ type: 'open' | 'resolve'; episode?: StoredEpisode; episodeKey?: string; recoveryId?: string; refs?: ReturnType<typeof evidenceRows> }> =
    [];
  const issueCache = new Map<string, IssueRecord>();
  const episodeCache = loadEpisodes(store, input.projectId);

  let lastSeq = afterSeq;
  let lastId = afterId;
  const grouped = new Map<number, typeof rows>();
  for (const row of rows) {
    const list = grouped.get(row.appendSeq) ?? [];
    list.push(row);
    grouped.set(row.appendSeq, list);
  }
  for (const seq of [...grouped.keys()].sort((a, b) => a - b)) {
    const group = grouped.get(seq) ?? [];
    const signals = group.map((row) => SignalSchema.parse(JSON.parse(row.payloadJson)));
    const historical = seq <= baselineUntil;
    const decisions = signals.flatMap((signal) =>
      evaluateSignal({
        signal,
        state: buildState(store, input, signal, episodeCache),
        policy,
        clock: { now: clockNow },
      }),
    );
    const sample = signals[0];
    const repoActive = Object.values(buildState(store, input, sample ?? signals[0]!, episodeCache).activeByFamily).some(
      (item) => item.primaryRuleId === 'R-REPOSITORY-UNAVAILABLE',
    );
    const candidates = suppressHealthIfRepoActive(pickPrimaryCandidate(decisions), repoActive);
    const recoveries = decisions.filter((item) => item.kind === 'RECOVERY');
    if (!historical) {
      for (const cand of candidates) {
        const issueKey = issueKeyFor(cand);
        const issue = issueCache.get(issueKey) ?? loadIssue(store, issueKey);
        const mutation = reduceCandidate(cand, issue, episodeCache, sample?.observedAt ?? clockNow);
        if (mutation.kind === 'open') {
          mutations.push({ type: 'open', episode: mutation.episode, refs: evidenceRows(mutation.episode.insightId, cand.evidenceRefs) });
          episodeCache.set(mutation.episode.episodeKey, mutation.episode);
          issueCache.set(issueKey, {
            issueKey,
            activeEpisodeKey: mutation.episode.episodeKey,
            lastVerifiedRecoverySignalId: issue?.lastVerifiedRecoverySignalId ?? null,
            dismissedEpisodeKeys: issue?.dismissedEpisodeKeys ?? [],
          });
        }
      }
      for (const rec of recoveries) {
        if (rec.kind !== 'RECOVERY') continue;
        const issueKey = issueKeyFor({
          projectId: input.projectId,
          streamEpoch: input.streamEpoch,
          issueFamily: rec.recovery.issueFamily,
          subjectKey: rec.recovery.subjectKey,
        });
        const issue = issueCache.get(issueKey) ?? loadIssue(store, issueKey);
        const mutation = reduceRecovery(rec.recovery, issue, episodeCache);
        if (mutation.kind === 'resolve') {
          mutations.push({
            type: 'resolve',
            episodeKey: mutation.episodeKey,
            recoveryId: rec.recovery.signalId,
            refs: evidenceRows(episodeCache.get(mutation.episodeKey)?.insightId ?? '', rec.recovery.evidenceRefs),
          });
          const ep = episodeCache.get(mutation.episodeKey);
          if (ep) episodeCache.set(mutation.episodeKey, { ...ep, status: 'RESOLVED' });
          issueCache.set(issueKey, {
            issueKey,
            activeEpisodeKey: null,
            lastVerifiedRecoverySignalId: rec.recovery.signalId,
            dismissedEpisodeKeys: issue?.dismissedEpisodeKeys ?? [],
          });
        }
      }
    }
    lastSeq = seq;
    lastId = group[group.length - 1]?.signalId ?? lastId;
  }

  const opened = mutations.filter((item) => item.type === 'open').length;
  const resolved = mutations.filter((item) => item.type === 'resolve').length;

  return store.transaction(() => {
    for (const mutation of mutations) {
      if (mutation.type === 'open' && mutation.episode) insertEpisode(store, mutation.episode, input, clockNow, mutation.refs ?? []);
      if (mutation.type === 'resolve' && mutation.episodeKey) resolveEpisode(store, mutation.episodeKey, mutation.recoveryId ?? '', clockNow, mutation.refs ?? []);
    }
    injectFault(input.fault, 'after-episodes');
    upsertProgress(store, input, lastSeq, lastId, baselineUntil, clockNow, progress?.revision ?? 0);
    injectFault(input.fault, 'after-progress');
    injectFault(input.fault, 'before-commit');
    const next = getProgress(store, input.projectId, input.streamEpoch);
    return {
      outcome: opened === 0 && resolved === 0 ? 'NO_INSIGHT' : 'OK',
      written: true,
      episodesOpened: opened,
      episodesResolved: resolved,
      signalsRead: rows.length,
      lastAppendSeq: lastSeq,
      lastSignalId: lastId,
      revision: next?.revision ?? 1,
    };
  });
}

export function dismissEpisode(store: InsightStore, episodeKey: string): void {
  store.transaction(() => {
    store.db.prepare(`UPDATE insight_episodes SET status = 'DISMISSED', updated_at = ? WHERE episode_key = ? AND status IN ('OPEN','ACKNOWLEDGED')`).run(store.nowIso(), episodeKey);
    const row = store.db.prepare('SELECT issue_key AS k FROM insight_episodes WHERE episode_key = ?').get(episodeKey) as { k: string } | undefined;
    if (row === undefined) return;
    const issue = loadIssue(store, row.k);
    const dismissed = [...(issue?.dismissedEpisodeKeys ?? []), episodeKey];
    store.db.prepare(
      `INSERT INTO insight_issue_state (issue_key, active_episode_key, last_verified_recovery_signal_id, dismissed_json, state_json)
       VALUES (?, ?, ?, ?, '{}')
       ON CONFLICT(issue_key) DO UPDATE SET active_episode_key = excluded.active_episode_key, dismissed_json = excluded.dismissed_json`,
    ).run(row.k, episodeKey, issue?.lastVerifiedRecoverySignalId ?? null, JSON.stringify(dismissed));
  });
}

export function acknowledgeEpisode(store: InsightStore, episodeKey: string): void {
  store.db.prepare(`UPDATE insight_episodes SET status = 'ACKNOWLEDGED', updated_at = ? WHERE episode_key = ? AND status = 'OPEN'`).run(store.nowIso(), episodeKey);
}

function isResetType(type: string): boolean {
  return type === 'PROJECT_REMOVED' || type === 'STREAM_EPOCH_MISMATCH' || type === 'CURSOR_AHEAD_OF_STREAM';
}

function empty(
  outcome: ProcessRulesResult['outcome'],
  input: ProcessRulesInput,
  progress?: Progress | null,
): ProcessRulesResult {
  return {
    outcome,
    written: false,
    episodesOpened: 0,
    episodesResolved: 0,
    signalsRead: 0,
    lastAppendSeq: progress?.lastAppendSeq ?? 0,
    lastSignalId: progress?.lastSignalId ?? '',
    revision: progress?.revision ?? 0,
  };
}

interface Progress {
  lastAppendSeq: number;
  lastSignalId: string;
  revision: number;
  state: string;
  baselineUntilSeq: number;
}

function getProgress(store: InsightStore, projectId: string, streamEpoch: number): Progress | null {
  const row = store.db
    .prepare(
      `SELECT last_append_seq AS lastAppendSeq, last_signal_id AS lastSignalId, revision, state, baseline_until_seq AS baselineUntilSeq
       FROM insight_rule_progress WHERE project_id = ? AND stream_epoch = ? AND ruleset_version = ?`,
    )
    .get(projectId, streamEpoch, RULESET_VERSION) as Progress | undefined;
  return row ?? null;
}

function freezeProgress(store: InsightStore, input: ProcessRulesInput): void {
  const now = store.nowIso();
  store.db.prepare(
    `INSERT INTO insight_rule_progress
     (project_id, stream_epoch, ruleset_version, last_append_seq, last_signal_id, revision, state, baseline_until_seq, activated_at, updated_at)
     VALUES (?, ?, ?, 0, '', 0, 'FROZEN', 0, ?, ?)
     ON CONFLICT(project_id, stream_epoch, ruleset_version) DO UPDATE SET state = 'FROZEN', updated_at = excluded.updated_at`,
  ).run(input.projectId, input.streamEpoch, RULESET_VERSION, now, now);
}

function upsertProgress(
  store: InsightStore,
  input: ProcessRulesInput,
  lastSeq: number,
  lastId: string,
  baselineUntil: number,
  now: string,
  expectedRevision: number,
): void {
  const existing = getProgress(store, input.projectId, input.streamEpoch);
  if (existing === null) {
    store.db.prepare(
      `INSERT INTO insight_rule_progress
       (project_id, stream_epoch, ruleset_version, last_append_seq, last_signal_id, revision, state, baseline_until_seq, activated_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 'ACTIVE', ?, ?, ?)`,
    ).run(input.projectId, input.streamEpoch, RULESET_VERSION, lastSeq, lastId, baselineUntil, now, now);
    return;
  }
  const updated = store.db.prepare(
    `UPDATE insight_rule_progress
     SET last_append_seq = ?, last_signal_id = ?, revision = revision + 1, updated_at = ?
     WHERE project_id = ? AND stream_epoch = ? AND ruleset_version = ? AND revision = ? AND state = 'ACTIVE'`,
  ).run(lastSeq, lastId, now, input.projectId, input.streamEpoch, RULESET_VERSION, expectedRevision);
  if (Number(updated.changes) !== 1) throw new InsightError('CAS_CONFLICT', 'rule progress revision moved');
}

function loadIssue(store: InsightStore, issueKey: string): IssueRecord | null {
  const row = store.db.prepare('SELECT * FROM insight_issue_state WHERE issue_key = ?').get(issueKey) as Row | undefined;
  if (row === undefined) return null;
  const dismissed = JSON.parse(String(row['dismissed_json'] ?? '[]')) as string[];
  return {
    issueKey,
    activeEpisodeKey: row['active_episode_key'] == null ? null : String(row['active_episode_key']),
    lastVerifiedRecoverySignalId:
      row['last_verified_recovery_signal_id'] == null ? null : String(row['last_verified_recovery_signal_id']),
    dismissedEpisodeKeys: dismissed,
  };
}

function loadEpisodes(store: InsightStore, projectId: string): Map<string, StoredEpisode> {
  const rows = store.db.prepare('SELECT * FROM insight_episodes WHERE project_id = ?').all(projectId) as Row[];
  const map = new Map<string, StoredEpisode>();
  for (const row of rows) {
    const episode: StoredEpisode = {
      insightId: String(row['insight_id']),
      issueKey: String(row['issue_key']),
      episodeKey: String(row['episode_key']),
      status: String(row['status']) as StoredEpisode['status'],
      subjectKey: String(row['subject_key']),
      issueFamily: String(row['issue_family']),
      openingSignalId: String(row['opening_signal_id']),
      primaryRuleId: String(row['primary_rule_id']),
      severity: String(row['severity']) as StoredEpisode['severity'],
      confidence: String(row['confidence']) as StoredEpisode['confidence'],
      titleKey: String(row['title_key']),
      detailKey: String(row['detail_key']),
      templateData: JSON.parse(String(row['template_data_json'])) as StoredEpisode['templateData'],
      firstObservedAt: String(row['first_observed_at']),
      lastMaterialObservedAt: String(row['last_material_observed_at']),
      historical: Number(row['historical']) === 1,
    };
    map.set(episode.episodeKey, episode);
  }
  return map;
}

function insertEpisode(
  store: InsightStore,
  episode: StoredEpisode,
  input: ProcessRulesInput,
  now: string,
  refs: Array<{ insightId: string; key: string; role: string; sourceId: string; kind: string; quality: string }>,
): void {
  store.db.prepare(
    `INSERT INTO insight_episodes (
       insight_id, project_id, stream_epoch, issue_key, episode_key, subject_key, issue_family,
       opening_signal_id, primary_rule_id, primary_rule_version, status, severity, confidence,
       title_key, detail_key, template_data_json, first_observed_at, last_material_observed_at,
       created_at, updated_at, historical
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    episode.insightId,
    input.projectId,
    input.streamEpoch,
    episode.issueKey,
    episode.episodeKey,
    episode.subjectKey,
    episode.issueFamily,
    episode.openingSignalId,
    episode.primaryRuleId,
    '1',
    episode.status,
    episode.severity,
    episode.confidence,
    episode.titleKey,
    episode.detailKey,
    JSON.stringify(episode.templateData),
    episode.firstObservedAt,
    episode.lastMaterialObservedAt,
    now,
    now,
    episode.historical ? 1 : 0,
  );
  store.db.prepare(
    `INSERT INTO insight_issue_state (issue_key, active_episode_key, last_verified_recovery_signal_id, dismissed_json, state_json)
     VALUES (?, ?, NULL, '[]', '{}')
     ON CONFLICT(issue_key) DO UPDATE SET active_episode_key = excluded.active_episode_key`,
  ).run(episode.issueKey, episode.episodeKey);
  for (const ref of refs) {
    store.db.prepare(
      `INSERT OR IGNORE INTO insight_evidence_refs (insight_id, evidence_key, role, source_id, source_kind, quality)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(ref.insightId, ref.key, ref.role, ref.sourceId, ref.kind, ref.quality);
  }
}

function resolveEpisode(
  store: InsightStore,
  episodeKey: string,
  recoveryId: string,
  now: string,
  refs: Array<{ insightId: string; key: string; role: string; sourceId: string; kind: string; quality: string }>,
): void {
  store.db.prepare(`UPDATE insight_episodes SET status = 'RESOLVED', updated_at = ? WHERE episode_key = ?`).run(now, episodeKey);
  const row = store.db.prepare('SELECT insight_id AS id, issue_key AS k FROM insight_episodes WHERE episode_key = ?').get(episodeKey) as
    | { id: string; k: string }
    | undefined;
  if (row === undefined) return;
  store.db.prepare(
    `UPDATE insight_issue_state SET active_episode_key = NULL, last_verified_recovery_signal_id = ? WHERE issue_key = ?`,
  ).run(recoveryId, row.k);
  for (const ref of refs) {
    store.db.prepare(
      `INSERT OR IGNORE INTO insight_evidence_refs (insight_id, evidence_key, role, source_id, source_kind, quality)
       VALUES (?, ?, 'resolution', ?, ?, ?)`,
    ).run(row.id, ref.key, ref.sourceId, ref.kind, ref.quality);
  }
}

function evidenceRows(
  insightId: string,
  refs: Signal['evidenceRefs'],
): Array<{ insightId: string; key: string; role: string; sourceId: string; kind: string; quality: string }> {
  return (refs ?? []).map((ref) => ({
    insightId,
    key: `${ref.kind}:${ref.id}`,
    role: ref.role,
    sourceId: ref.id,
    kind: ref.kind,
    quality: ref.quality,
  }));
}

function buildState(
  store: InsightStore,
  input: ProcessRulesInput,
  signal: Signal,
  episodes: Map<string, StoredEpisode>,
): RuleStateSnapshot {
  const activeByFamily: Record<string, ActiveIssue> = {};
  for (const episode of episodes.values()) {
    if (episode.status === 'OPEN' || episode.status === 'ACKNOWLEDGED') {
      activeByFamily[`${episode.issueFamily}:${episode.subjectKey}`] = {
        issueKey: episode.issueKey,
        episodeKey: episode.episodeKey,
        status: episode.status,
        subjectKey: episode.subjectKey,
        primaryRuleId: episode.primaryRuleId,
      };
    }
  }
  return {
    streamEpoch: input.streamEpoch,
    sourceFrozen: false,
    legacyOrderReconstructed:
      signal.facts['legacyOrderReconstructed'] === true || signal.facts['orderUncertainty'] === 'reconstructed_rowid',
    adapterStreak: streak(store, input, 'ADAPTER_ERROR_OBSERVED', signal.subject ?? ''),
    unavailableStreak: streak(store, input, 'REPOSITORY_UNAVAILABLE_OBSERVED', signal.subject ?? ''),
    activeByFamily,
  };
}

function streak(
  store: InsightStore,
  input: ProcessRulesInput,
  type: string,
  subject: string,
): StreakState | null {
  const rows = store.db
    .prepare(
      `SELECT subject, payload_json AS payloadJson FROM signal_inbox
       WHERE project_id = ? AND stream_epoch = ? AND signal_type = ? AND subject = ?
       ORDER BY append_seq ASC, signal_id ASC`,
    )
    .all(input.projectId, input.streamEpoch, type, subject) as Array<{ subject: string; payloadJson: string }>;
  if (rows.length === 0) return null;
  const first = SignalSchema.parse(JSON.parse(rows[0]!.payloadJson));
  const last = SignalSchema.parse(JSON.parse(rows[rows.length - 1]!.payloadJson));
  return {
    subject,
    count: rows.length,
    firstObservedAt: first.observedAt,
    lastObservedAt: last.observedAt,
  };
}

function injectFault(fault: RuleFault | undefined, at: RuleFault): void {
  if (fault === at) throw new InsightError('INJECTED_FAULT', at);
}
