/**
 * @fileoverview 仓库观察详情页（ObserverDetailPage）
 * 
 * 职责：
 * 1. 展示单个本地仓库的实时 Git 快照（分支、HEAD OID、暂存/未暂存文件统计）；
 * 2. 展示测试报告聚合指标（套件通过率、执行耗时、失败用例计数）；
 * 3. 观察器状态管理：手动立即扫描、暂停/恢复观察、关联测试报告源；
 * 4. 事件时间线：按 Git、测试、系统事件分类筛选，展示变更详情与差异负载（diff payload）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader } from '../components';
import { ApiError } from '../features/api/client';
import {
  addObserverReport,
  collectionTone,
  COLLECTION_LABELS,
  EVENT_TYPE_LABELS,
  fetchObserverDetail,
  fetchObserverEvents,
  scanObserverProject,
  setObserverEnabled,
  testLabel,
  worktreeLabel,
  type ObserverDetail,
  type ObserverEvent,
  type ObserverEventType,
} from '../features/observer';
import { formatDateTime } from '../features/runs';
import { fetchInsightSummary } from '../features/insights';
import { fetchAnalysisRuns, type AnalysisRun } from '../features/analysis';
import { AnalysisLaunch } from '../components/AnalysisLaunch';
import { RecommendationCard } from '../components/RecommendationCard';
import './ObserverDetailPage.css';
import './InsightsPage.css';

const FILTERS: Array<{ id: 'all' | 'git' | 'test' | 'system'; label: string; types?: ObserverEventType[] }> = [
  { id: 'all', label: '全部' },
  {
    id: 'git',
    label: 'Git',
    types: ['REPOSITORY_HEAD_CHANGED', 'REPOSITORY_BRANCH_CHANGED', 'WORKTREE_STATE_CHANGED'],
  },
  { id: 'test', label: '测试', types: ['TEST_REPORT_UPDATED', 'ADAPTER_ERROR'] },
  {
    id: 'system',
    label: '系统',
    types: ['PROJECT_REGISTERED', 'REPOSITORY_UNAVAILABLE', 'REPOSITORY_RECOVERED', 'OBSERVATION_GAP'],
  },
];

export function ObserverDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<ObserverDetail | null>(null);
  const [events, setEvents] = useState<ObserverEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reportPath, setReportPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmPause, setConfirmPause] = useState(false);
  const [openInsights, setOpenInsights] = useState(0);
  const [analysisRuns, setAnalysisRuns] = useState<AnalysisRun[]>([]);

  const load = useCallback(async (projectId: string, signal?: AbortSignal) => {
    const next = await fetchObserverDetail(projectId, signal);
    const selected = FILTERS.find((item) => item.id === filter);
    const page = await fetchObserverEvents(
      projectId,
      { types: selected?.types?.join(',') },
      signal,
    );
    setDetail(next);
    setEvents(page.events);
    setError(null);
    try {
      const summary = await fetchInsightSummary(signal);
      setOpenInsights(summary.projects.find((item) => item.projectId === projectId)?.openCount ?? 0);
    } catch {
      setOpenInsights(0);
    }
    try {
      const runs = await fetchAnalysisRuns(projectId, signal);
      setAnalysisRuns(runs);
    } catch {
      setAnalysisRuns([]);
    }
  }, [filter]);

  useEffect(() => {
    if (id === undefined) return undefined;
    const controller = new AbortController();
    void load(id, controller.signal).catch((cause) => {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      setDetail(null);
      setError(
        cause instanceof ApiError && cause.status === 404
          ? `观察项目 ${id} 不存在`
          : cause instanceof Error
            ? cause.message
            : '加载失败',
      );
    });
    return () => controller.abort();
  }, [id, load, reloadKey]);

  const selected = useMemo(
    () => events.find((event) => event.eventId === selectedId) ?? events[0] ?? null,
    [events, selectedId],
  );

  if (id === undefined) {
    return (
      <section className="page">
        <PageHeader title="仓库观察" />
        <ErrorState message="缺少项目 ID" />
      </section>
    );
  }

  const projectId = id;
  const snapshot = detail?.snapshot ?? null;
  const test = testLabel(snapshot?.test ?? null);

  async function onScan(): Promise<void> {
    setBusy(true);
    try {
      await scanObserverProject(projectId);
      setReloadKey((key) => key + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '扫描失败');
    } finally {
      setBusy(false);
    }
  }

  async function onToggle(enabled: boolean): Promise<void> {
    setBusy(true);
    try {
      await setObserverEnabled(projectId, enabled);
      setReloadKey((key) => key + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '更新失败');
    } finally {
      setBusy(false);
      setConfirmPause(false);
    }
  }

  async function onAddReport(): Promise<void> {
    if (reportPath.trim() === '') return;
    setBusy(true);
    try {
      await addObserverReport(projectId, reportPath.trim());
      setReportPath('');
      setReloadKey((key) => key + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '添加报告失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="page">
      <PageHeader
        title={detail?.project.name ?? '仓库观察'}
        subtitle="只读事实：Git 状态、工作区摘要、已声明测试报告。缺失数据显示 UNKNOWN / STALE / UNAVAILABLE。"
        actions={
          <Link className="btn btn-ghost" to="/projects">
            返回列表
          </Link>
        }
      />

      {error !== null && detail === null ? (
        <ErrorState message={error} onRetry={() => setReloadKey((key) => key + 1)} />
      ) : detail === null ? (
        <div className="pd-skeleton-stack" aria-hidden="true">
          <div className="skeleton skeleton-block" />
        </div>
      ) : (
        <>
          {error !== null ? <ErrorState message={error} onRetry={() => setReloadKey((key) => key + 1)} /> : null}

          <div className="page-section" aria-label="概览">
            <p className="page-section-title">概览</p>
            <div className="obs-overview">
              <article className="card obs-stat">
                <p className="obs-stat-label">仓库身份</p>
                <p className="mono">{detail.project.canonicalPath}</p>
                <p className="obs-stat-sub">git identity {detail.project.gitIdentity ?? '—'}</p>
              </article>
              <article className="card obs-stat">
                <p className="obs-stat-label">HEAD</p>
                <p className="mono">
                  {snapshot?.unborn
                    ? 'UNBORN'
                    : snapshot?.detached
                      ? `detached ${snapshot.headSha?.slice(0, 12) ?? ''}`
                      : `${snapshot?.branch ?? '—'} @ ${snapshot?.headSha?.slice(0, 12) ?? '—'}`}
                </p>
                <p className="obs-stat-sub">{worktreeLabel(snapshot?.worktree ?? null, snapshot?.unborn ?? false)}</p>
              </article>
              <article className="card obs-stat">
                <p className="obs-stat-label">测试证据</p>
                <p>
                  <span className={`status-badge is-${test.tone}`}>{test.text}</span>
                </p>
                <p className="obs-stat-sub">
                  生成于 {formatDateTime(snapshot?.test.generatedAt)} · 采集于 {formatDateTime(snapshot?.test.observedAt)}
                </p>
              </article>
              <article className="card obs-stat">
                <p className="obs-stat-label">洞察</p>
                <p>待关注 {openInsights}</p>
                <p className="obs-stat-sub">
                  <Link to={`/insights?projectId=${encodeURIComponent(detail.project.id)}`}>查看该项目的洞察</Link>
                </p>
              </article>
              <article className="card obs-stat">
                <p className="obs-stat-label">采集健康</p>
                <p>
                  <span className={`status-badge is-${collectionTone(detail.health.collectionStatus)}`}>
                    {COLLECTION_LABELS[detail.health.collectionStatus]}
                  </span>
                </p>
                <p className="obs-stat-sub">
                  最近成功 {formatDateTime(detail.health.lastSuccessAt ?? undefined)} · 监听 {detail.health.watchStatus}
                </p>
              </article>
            </div>
          </div>

          <div className="page-section" aria-label="事件线">
            <div className="obs-section-head">
              <p className="page-section-title">事件线</p>
              <div className="obs-filters" role="tablist" aria-label="事件类型">
                {FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`btn ${filter === item.id ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setFilter(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            {events.length === 0 ? (
              <EmptyState title="还没有已证实的状态变化" hint="重复扫描同一状态不会向时间线追加事件。" />
            ) : (
              <div className="obs-timeline">
                <ul className="obs-event-list">
                  {events.map((event) => (
                    <li key={event.eventId}>
                      <button
                        type="button"
                        className={`card obs-event ${selected?.eventId === event.eventId ? 'is-active' : ''}`}
                        onClick={() => setSelectedId(event.eventId)}
                      >
                        <span className="obs-event-time">{formatDateTime(event.observedAt)}</span>
                        <span className="obs-event-type">{EVENT_TYPE_LABELS[event.type]}</span>
                        <span className="mono obs-event-id">{event.type}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {selected ? (
                  <aside className="card obs-evidence" aria-label="事件证据">
                    <h2>证据</h2>
                    <dl>
                      <div>
                        <dt>来源</dt>
                        <dd>{selected.evidence.source}</dd>
                      </div>
                      <div>
                        <dt>质量</dt>
                        <dd>{selected.evidence.quality}</dd>
                      </div>
                      <div>
                        <dt>扫描批次</dt>
                        <dd className="mono">{selected.evidence.observationRunId}</dd>
                      </div>
                      <div>
                        <dt>前快照</dt>
                        <dd className="mono">{selected.fromSnapshotId ?? '—'}</dd>
                      </div>
                      <div>
                        <dt>后快照</dt>
                        <dd className="mono">{selected.toSnapshotId ?? '—'}</dd>
                      </div>
                    </dl>
                    <pre className="obs-payload">{JSON.stringify(selected.payload, null, 2)}</pre>
                  </aside>
                ) : null}
              </div>
            )}
          </div>

          {analysisRuns.length > 0 ? (
            <div className="page-section" aria-label="项目分析">
              <p className="page-section-title">项目分析</p>
              <RecommendationCard run={analysisRuns[0]!} observeHref={`/observe/${encodeURIComponent(projectId)}`} />
            </div>
          ) : null}

          <div className="page-section" aria-label="配置">
            <p className="page-section-title">配置</p>
            <div className="card obs-config">
              <p>扫描间隔 {Math.round(detail.project.scanIntervalMs / 1000)} 秒 · 防抖 {detail.project.debounceMs} ms</p>
              <p>已声明报告：{detail.reports.length === 0 ? '无（测试状态 UNKNOWN）' : detail.reports.map((item) => item.relativePath).join('，')}</p>
              <div className="obs-config-row">
                <input
                  value={reportPath}
                  onChange={(event) => setReportPath(event.target.value)}
                  placeholder="reports/junit.xml"
                  aria-label="JUnit 报告相对路径"
                />
                <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void onAddReport()}>
                  声明 JUnit 报告
                </button>
                <button className="btn btn-primary" type="button" disabled={busy} onClick={() => void onScan()}>
                  立即只读重扫
                </button>
                <AnalysisLaunch
                  input={{ projectId, trigger: 'observe' }}
                  label="分析当前项目"
                  disabled={busy}
                  onComplete={(run) => setAnalysisRuns((current) => [run, ...current.filter((item) => item.id !== run.id)])}
                />
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={busy}
                  onClick={() => (detail.project.enabled ? setConfirmPause(true) : void onToggle(true))}
                >
                  {detail.project.enabled ? '暂停观察' : '恢复观察'}
                </button>
              </div>
            </div>
          </div>

          <ConfirmDialog
            open={confirmPause}
            title="暂停观察？"
            description="暂停后不再监听该仓库。恢复时会重新对账，不会补造暂停期间的中间事件。"
            confirmText="暂停"
            onCancel={() => setConfirmPause(false)}
            onConfirm={() => void onToggle(false)}
          />
        </>
      )}
    </section>
  );
}
