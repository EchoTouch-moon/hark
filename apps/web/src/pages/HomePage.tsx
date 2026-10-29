import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EmptyState, ErrorState, PageHeader } from '../components';
import {
  fetchOverview,
  type OverviewResponse,
  OVERVIEW_STATUS_LABELS,
  OVERVIEW_STATUS_TONE,
  TEST_STATUS_LABELS,
  TEST_STATUS_TONE,
} from '../features/overview';
import { SEVERITY_LABEL, SEVERITY_TONE } from '../features/insights';
import { EVENT_TYPE_LABELS, type ObserverEventType } from '../features/observer';
import { formatDateTime } from '../features/runs';
import './HomePage.css';

const REFRESH_INTERVAL_MS = 3000;

export function HomePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const projectId = searchParams.get('projectId') ?? undefined;

  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isFetchingRef = useRef(false);

  const loadData = useCallback(
    async (isBackground = false) => {
      if (isFetchingRef.current) return;
      isFetchingRef.current = true;
      if (!isBackground) setLoading(true);

      try {
        const res = await fetchOverview(projectId);
        setData(res);
        setError(null);
      } catch (err) {
        if (!isBackground) {
          setError(err instanceof Error ? err.message : '获取今日概览失败');
        }
      } finally {
        isFetchingRef.current = false;
        if (!isBackground) setLoading(false);
      }
    },
    [projectId],
  );

  // 初次加载与参数变化加载
  useEffect(() => {
    loadData(false);
  }, [loadData]);

  // 3 秒只读不重叠静默轮询 + 后台暂停 + 切回前台立即刷新
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadData(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadData(true);
      }
    }, REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadData]);

  const handleProjectFilterChange = (selectedId: string) => {
    const next = new URLSearchParams(searchParams);
    if (!selectedId) {
      next.delete('projectId');
    } else {
      next.set('projectId', selectedId);
    }
    setSearchParams(next, { replace: true });
  };

  if (loading && !data) {
    return (
      <section className="page home-page">
        <PageHeader title="今日概览" subtitle="基于真实本地事实聚合 · 零未授权模型调用" />
        <div className="home-loading" role="status">正在加载今日工作台概览…</div>
      </section>
    );
  }

  if (error && !data) {
    return (
      <section className="page home-page">
        <PageHeader title="今日概览" subtitle="基于真实本地事实聚合 · 零未授权模型调用" />
        <ErrorState message={error} onRetry={() => loadData(false)} />
      </section>
    );
  }

  const summary = data?.summary;
  const sectionsAvailability = data?.sectionsAvailability;
  const hasDegradedSection =
    sectionsAvailability &&
    (sectionsAvailability.projects !== 'AVAILABLE' ||
      sectionsAvailability.insights !== 'AVAILABLE' ||
      sectionsAvailability.observations !== 'AVAILABLE');

  const prioritized = data?.prioritizedInsights;
  const projects = data?.projects ?? [];
  const recentObservations = data?.recentObservations;

  return (
    <section className="page home-page">
      <PageHeader
        title="今日概览"
        subtitle={`本地事实聚合 · ${summary?.date ?? '今日'}`}
        actions={
          <div className="home-filter-bar">
            <label htmlFor="home-project-select" className="home-filter-label">
              项目范围：
            </label>
            <select
              id="home-project-select"
              className="home-filter-select"
              value={projectId ?? ''}
              onChange={(e) => handleProjectFilterChange(e.target.value)}
            >
              <option value="">全部项目 ({projects.length})</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        }
      />

      {/* 降级警示横幅：不吞噬正常区块 */}
      {hasDegradedSection ? (
        <div className="home-degraded-banner" role="alert">
          <span className="home-banner-badge tone-warning">部分数据源降级</span>
          <span>
            {sectionsAvailability?.projects !== 'AVAILABLE' ? '项目状态不可用；' : ''}
            {sectionsAvailability?.insights !== 'AVAILABLE' ? '洞察引擎状态不可用；' : ''}
            {sectionsAvailability?.observations !== 'AVAILABLE' ? '观察事件流不可用；' : ''}
            未受影响的数据区域正常展示。
          </span>
        </div>
      ) : null}

      {/* 第 1 区：今日概览叙事与指标 */}
      {summary ? (
        <article className="home-section home-summary-card">
          <div className="home-summary-header">
            <div className="home-summary-title-wrap">
              <span className={`home-status-badge tone-${OVERVIEW_STATUS_TONE[summary.status]}`}>
                {OVERVIEW_STATUS_LABELS[summary.status]}
              </span>
              <h2 className="home-summary-headline">{summary.headline}</h2>
            </div>
            <time className="home-summary-time">{summary.date}</time>
          </div>
          <p className="home-summary-detail">{summary.detail}</p>
          <div className="home-metrics-strip">
            <div className="home-metric-pill">
              <span className="metric-label">登记项目</span>
              <span className="metric-value">
                {summary.counts.enabledProjects}
                <span className="metric-total"> / {summary.counts.totalProjects}</span>
              </span>
            </div>
            <div className="home-metric-pill">
              <span className="metric-label">待关注发现</span>
              <span className="metric-value">
                {summary.counts.openInsights}
                {summary.counts.importantInsights > 0 ? (
                  <span className="metric-highlight"> ({summary.counts.importantInsights} 重要)</span>
                ) : null}
              </span>
            </div>
            <div className="home-metric-pill">
              <span className="metric-label">今日观察事件</span>
              <span className="metric-value">{summary.counts.todayObservationsCount}</span>
            </div>
          </div>
        </article>
      ) : null}

      {/* 第 2 区：值得关注（最多 3 条，优先排序） */}
      <section className="home-section" aria-labelledby="section-prioritized-title">
        <div className="home-section-header">
          <div className="home-section-title-wrap">
            <h2 id="section-prioritized-title" className="home-section-title">
              值得关注
            </h2>
            {prioritized && prioritized.totalOpenCount > 0 ? (
              <span className="home-count-tag">{prioritized.totalOpenCount}</span>
            ) : null}
          </div>
          {prioritized && (prioritized.hasMore || prioritized.totalOpenCount > 3) ? (
            <Link
              to={projectId ? `/insights?projectId=${encodeURIComponent(projectId)}` : '/insights'}
              className="home-section-link"
            >
              查看全部发现 (共 {prioritized.totalOpenCount} 条) →
            </Link>
          ) : null}
        </div>

        {prioritized && prioritized.items.length > 0 ? (
          <div className="home-insights-list">
            {prioritized.items.map((item) => (
              <article key={item.id} className="home-insight-card">
                <div className="home-insight-meta-top">
                  <span className={`home-tag tone-${SEVERITY_TONE[item.severity]}`}>
                    {SEVERITY_LABEL[item.severity]}
                  </span>
                  <span className="home-project-badge">{item.projectName}</span>
                  <span className="home-rule-tag">{item.primaryRuleId}</span>
                  <time className="home-meta-time">{formatDateTime(item.observedAt)}</time>
                </div>
                <h3 className="home-insight-title">
                  <Link to={`/insights/${item.id}`}>{item.title}</Link>
                </h3>
                <p className="home-insight-summary">{item.summary}</p>
                <div className="home-insight-footer">
                  <span className="home-evidence-count">
                    {item.evidenceCount} 条事实证据
                  </span>
                  <Link to={`/insights/${item.id}`} className="home-card-action-btn">
                    查看详情与建议 →
                  </Link>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="home-empty-box">
            {summary?.status === 'NO_PROJECTS' ? (
              <EmptyState
                title="暂无登记项目"
                hint="目前尚未登记任何本地项目。请先在“项目”中添加项目根目录。"
                action={
                  <Link to="/projects" className="home-btn-primary">
                    登记本地项目
                  </Link>
                }
              />
            ) : summary?.status === 'NO_SIGNALS' ? (
              <EmptyState
                title="尚无可评估信号"
                hint="项目已登记，但尚未观测到测试报告更新或 Git 提交信号。"
              />
            ) : summary?.status === 'ALL_CLEAR' ? (
              <EmptyState
                title="目前全部正常"
                hint="当前未发现需要重点关注的异常或待办事项。"
              />
            ) : (
              <EmptyState
                title="暂无未处理发现"
                hint="所有历史发现均已处理或忽略。"
              />
            )}
          </div>
        )}
      </section>

      {/* 第 3 区：项目概况 */}
      <section className="home-section" aria-labelledby="section-projects-title">
        <div className="home-section-header">
          <div className="home-section-title-wrap">
            <h2 id="section-projects-title" className="home-section-title">
              项目概况
            </h2>
            <span className="home-count-tag">{projects.length}</span>
          </div>
          <Link to="/projects" className="home-section-link">
            管理项目 →
          </Link>
        </div>

        {projects.length > 0 ? (
          <div className="home-projects-grid">
            {projects.map((proj) => {
              const isFiltered = projectId === proj.id;
              return (
                <div
                  key={proj.id}
                  className={`home-project-card ${isFiltered ? 'is-selected' : ''}`}
                >
                  <div className="home-project-top">
                    <div className="home-project-title-group">
                      <h3 className="home-project-name">{proj.name}</h3>
                      <span className={`home-status-dot ${proj.enabled ? 'is-active' : 'is-paused'}`} />
                      <span className="home-project-state-text">
                        {proj.enabled ? '运行中' : '已暂停'}
                      </span>
                    </div>
                    <span className={`home-tag tone-${TEST_STATUS_TONE[proj.testStatus]}`}>
                      {TEST_STATUS_LABELS[proj.testStatus]}
                    </span>
                  </div>

                  <div className="home-project-meta">
                    <span className="home-project-branch">
                      分支: {proj.branch ?? 'HEAD'}
                      {proj.headOid ? ` (${proj.headOid.slice(0, 7)})` : ''}
                    </span>
                    <span className="home-project-obs-time">
                      最近观察: {formatDateTime(proj.lastObservedAt ?? undefined)}
                    </span>
                  </div>

                  <div className="home-project-bottom">
                    <span className="home-project-open-count">
                      {proj.openInsightCount > 0 ? (
                        <strong className="text-warning">{proj.openInsightCount} 条待关注</strong>
                      ) : (
                        <span className="text-muted">0 条待关注</span>
                      )}
                    </span>
                    <div className="home-project-actions">
                      <button
                        type="button"
                        className="home-btn-ghost-sm"
                        onClick={() => handleProjectFilterChange(isFiltered ? '' : proj.id)}
                      >
                        {isFiltered ? '取消筛选' : '仅看此项目'}
                      </button>
                      <Link to={`/observe/${proj.id}`} className="home-btn-ghost-sm">
                        详情
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="home-empty-box">
            <EmptyState
              title="尚未登记本地项目"
              hint="添加本地 Git 仓库路径即可开始自动化观察与代码洞察。"
              action={
                <Link to="/projects" className="home-btn-primary">
                  添加第一个项目
                </Link>
              }
            />
          </div>
        )}
      </section>

      {/* 第 4 区：最近观察 */}
      <section className="home-section" aria-labelledby="section-observations-title">
        <div className="home-section-header">
          <div className="home-section-title-wrap">
            <h2 id="section-observations-title" className="home-section-title">
              最近观察
            </h2>
            {recentObservations && recentObservations.events.length > 0 ? (
              <span className="home-count-tag">{recentObservations.events.length}</span>
            ) : null}
          </div>
          <Link
            to={projectId ? `/observations?projectId=${encodeURIComponent(projectId)}` : '/observations'}
            className="home-section-link"
          >
            查看完整时间线 →
          </Link>
        </div>

        {recentObservations && recentObservations.events.length > 0 ? (
          <ul className="home-observations-list">
            {recentObservations.events.map((evt) => {
              const label =
                EVENT_TYPE_LABELS[evt.type as ObserverEventType] ?? evt.type;
              return (
                <li key={evt.id} className="home-observation-item">
                  <div className="obs-header">
                    <time className="obs-time">{formatDateTime(evt.timestamp)}</time>
                    <span className="obs-project">{evt.projectName}</span>
                    <span className="obs-type-tag">{label}</span>
                    <span className="obs-source-tag">{evt.source}</span>
                  </div>
                  <p className="obs-summary">{evt.payloadSummary}</p>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="home-empty-box">
            <EmptyState
              title="暂无观察记录"
              hint="当本地仓库发生提交、分支切换或测试运行后，客观事件将记录于此。"
            />
          </div>
        )}
      </section>
    </section>
  );
}
