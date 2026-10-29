import { useCallback, useEffect, useMemo, useState } from 'react';
import { isTerminalRunState } from '@hearth/contracts';
import type { ActionCard as HearthCard, TaskRun } from '@hearth/contracts';
import { ConfirmDialog, EmptyState, ErrorState, PageHeader } from '../components';
import { ActionCard, type CardPendingAction } from '../components/ActionCard';
import { EvidenceDrawer } from '../components/EvidenceDrawer';
import {
  CARD_POLL_INTERVAL_MS,
  POLLING_CARD_STATUSES,
  RUNGED_TERMINAL_STATUSES,
  SNOOZE_2H_MS,
  fetchCardDetail,
  friendlyCardError,
  isProactiveCard,
  toSecondPrecisionIso,
  useCardActions,
  useCards,
  useProjects,
} from '../features/cards';
import './HomePage.css';

/** 主动建议区最多展示的卡片数（docs/02-UX U01） */
const PRIMARY_LIMIT = 3;

/** 相对时间 / TTL / 到期判断的心跳间隔 */
const NOW_TICK_MS = 30_000;

/** 页面顶部提示的自动消失时间 */
const NOTICE_TTL_MS = 8_000;

interface HomeNotice {
  tone: 'info' | 'error';
  text: string;
}

/**
 * U01 Home：今天值得处理的事。
 *
 * - 主动建议区最多 3 张（proposed / snoozed 到期 / 审批与执行进行中），
 *   其余折叠在「查看全部」；
 * - 操作：查看证据（页面内 EvidenceDrawer）/ 开始处理（L2 显示为请求批准）/
 *   忽略（二次确认）/ 稍后（2 小时）；
 * - 执行后轮询 GET /cards/:id（900ms），run 终态即停；刷新后状态全部
 *   来自 API，不用 localStorage 存业务状态。
 */
export function HomePage() {
  const { cards, loading, error, refetch, mergeCard } = useCards();
  const { projects, loading: projectsLoading, error: projectsError } = useProjects();
  const actions = useCardActions();

  const [runsByCard, setRunsByCard] = useState<Record<string, TaskRun | null>>({});
  /** 本会话内执行过的卡片：终态后仍钉在主动建议区，避免执行完就消失 */
  const [pinned, setPinned] = useState<ReadonlySet<string>>(() => new Set());
  const [expandedAll, setExpandedAll] = useState(false);
  const [evidenceId, setEvidenceId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, CardPendingAction>>({});
  const [actionErrors, setActionErrors] = useState<Record<string, string | null>>({});
  const [notice, setNotice] = useState<HomeNotice | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  /* ---------- 心跳与提示自动消失 ---------- */

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), NOW_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (notice === null) return undefined;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  /* ---------- 列表划分 ---------- */

  const visibleCards = useMemo(
    () => cards.filter((c) => c.status !== 'dismissed'),
    [cards],
  );

  const primaryCards = useMemo(() => {
    const active = visibleCards.filter(
      (c) => isProactiveCard(c, nowMs) || pinned.has(c.id),
    );
    return active
      .slice()
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, PRIMARY_LIMIT);
  }, [visibleCards, nowMs, pinned]);

  const primaryIds = useMemo(() => new Set(primaryCards.map((c) => c.id)), [primaryCards]);

  const restCards = useMemo(
    () => visibleCards.filter((c) => !primaryIds.has(c.id)),
    [visibleCards, primaryIds],
  );

  /* ---------- 终态卡片回填 run（刷新后仍能给出「查看 Run」链接） ---------- */

  const missingRunKey = useMemo(
    () =>
      visibleCards
        .filter((c) => RUNGED_TERMINAL_STATUSES.has(c.status) && !(c.id in runsByCard))
        .map((c) => c.id)
        .join(','),
    [visibleCards, runsByCard],
  );

  useEffect(() => {
    if (missingRunKey === '') return undefined;
    let cancelled = false;
    const ids = missingRunKey.split(',');
    void (async () => {
      for (const id of ids) {
        try {
          const detail = await fetchCardDetail(id);
          if (cancelled) return;
          setRunsByCard((prev) => ({ ...prev, [id]: detail.run }));
        } catch {
          // 回填失败不重试：打开证据面板时会再次拉取
          if (!cancelled) setRunsByCard((prev) => ({ ...prev, [id]: null }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [missingRunKey]);

  /* ---------- 进行中的卡每 900ms 轮询（run 终态即停） ---------- */

  const activeKey = useMemo(
    () =>
      visibleCards
        .filter(
          (c) =>
            POLLING_CARD_STATUSES.has(c.status) ||
            // execute 刚返回时 card 可能仍是 proposed，但已有关联的非终态 run
            (runsByCard[c.id] !== undefined && !isTerminalRunState(runsByCard[c.id]!.state)),
        )
        .map((c) => c.id)
        .join(','),
    [visibleCards, runsByCard],
  );

  useEffect(() => {
    if (activeKey === '') return undefined;
    let cancelled = false;
    const ids = activeKey.split(',');
    const tick = async (): Promise<void> => {
      for (const id of ids) {
        try {
          const detail = await fetchCardDetail(id);
          if (cancelled) return;
          mergeCard(detail.card);
          setRunsByCard((prev) => ({ ...prev, [id]: detail.run }));
        } catch {
          // 单轮网络抖动忽略，下一轮继续
        }
      }
    };
    // 变化时立即跑一轮：刷新页面后马上恢复 run 状态
    void tick();
    const timer = window.setInterval(() => void tick(), CARD_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeKey, mergeCard]);

  /* ---------- 项目 badge 名称映射（project-atlas → Atlas） ---------- */

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) {
      map.set(project.id, project.name.replace(/^Project\s+/, ''));
    }
    return map;
  }, [projects]);

  const firstRun = !projectsLoading && projectsError === null && projects.length === 0;

  /* ---------- 操作 ---------- */

  const beginAction = useCallback((cardId: string, action: CardPendingAction): void => {
    setPending((prev) => ({ ...prev, [cardId]: action }));
    setActionErrors((prev) => ({ ...prev, [cardId]: null }));
  }, []);

  const endAction = useCallback(
    (cardId: string, failure: string | null): void => {
      setPending((prev) => ({ ...prev, [cardId]: null }));
      if (failure !== null) setActionErrors((prev) => ({ ...prev, [cardId]: failure }));
    },
    [],
  );

  const handleExecute = useCallback(
    async (cardId: string): Promise<void> => {
      beginAction(cardId, 'execute');
      const result = await actions.execute(cardId);
      if (result.ok) {
        mergeCard(result.data.card);
        setRunsByCard((prev) => ({ ...prev, [cardId]: result.data.run }));
        setPinned((prev) => {
          const next = new Set(prev);
          next.add(cardId);
          return next;
        });
        if (result.data.alreadyRunning) {
          setNotice({ tone: 'info', text: '该建议已有任务在执行，已恢复状态跟踪' });
        }
        endAction(cardId, null);
      } else {
        endAction(cardId, friendlyCardError(result.error));
      }
    },
    [actions, beginAction, endAction, mergeCard],
  );

  const handleSnooze = useCallback(
    async (cardId: string): Promise<void> => {
      beginAction(cardId, 'snooze');
      const until = toSecondPrecisionIso(new Date(Date.now() + SNOOZE_2H_MS));
      const result = await actions.snooze(cardId, until);
      if (result.ok) {
        mergeCard(result.data.card);
        endAction(cardId, null);
      } else {
        endAction(cardId, friendlyCardError(result.error));
      }
    },
    [actions, beginAction, endAction, mergeCard],
  );

  const confirmCard = useMemo(
    () => cards.find((c) => c.id === confirmId) ?? null,
    [cards, confirmId],
  );

  const handleConfirmDismiss = useCallback(async (): Promise<void> => {
    const cardId = confirmId;
    setConfirmId(null);
    if (cardId === null) return;
    beginAction(cardId, 'dismiss');
    const result = await actions.dismiss(cardId, 'not_useful');
    if (result.ok) {
      mergeCard(result.data.card);
      setEvidenceId((cur) => (cur === cardId ? null : cur));
      endAction(cardId, null);
    } else {
      endAction(cardId, friendlyCardError(result.error));
    }
  }, [actions, beginAction, confirmId, endAction, mergeCard]);

  const handleDiscover = useCallback(async (): Promise<void> => {
    setScanBusy(true);
    const result = await actions.discover();
    setScanBusy(false);
    if (result.ok) {
      setNotice({ tone: 'info', text: `扫描完成：新增 ${result.data.cardsCreated} 张建议` });
      refetch();
    } else if (result.error.status === 429) {
      setNotice({ tone: 'error', text: '扫描太频繁，请稍后再试' });
    } else {
      setNotice({ tone: 'error', text: `扫描失败：${result.error.message}` });
    }
  }, [actions, refetch]);

  const handleSeed = useCallback(async (): Promise<void> => {
    setSeedBusy(true);
    const seeded = await actions.seedDemo();
    if (seeded.ok) {
      const discovered = await actions.discover();
      setNotice({
        tone: 'info',
        text: `已初始化 Demo 数据：${seeded.data.projects} 个项目、${seeded.data.eventsIngested} 条事件${
          discovered.ok ? `，新增 ${discovered.data.cardsCreated} 张建议` : ''
        }`,
      });
      refetch();
      setSeedBusy(false);
    } else {
      setNotice({ tone: 'error', text: `初始化失败：${seeded.error.message}` });
      setSeedBusy(false);
    }
  }, [actions, refetch]);

  /* ---------- 渲染 ---------- */

  const renderCard = (card: HearthCard) => (
    <ActionCard
      key={card.id}
      card={card}
      projectName={projectNameById.get(card.projectId) ?? null}
      run={runsByCard[card.id] ?? null}
      pending={pending[card.id] ?? null}
      evidenceOpen={evidenceId === card.id}
      actionError={actionErrors[card.id] ?? null}
      onToggleEvidence={() =>
        setEvidenceId((cur) => (cur === card.id ? null : card.id))
      }
      onExecute={() => void handleExecute(card.id)}
      onDismissRequest={() => setConfirmId(card.id)}
      onSnooze={() => void handleSnooze(card.id)}
    >
      {evidenceId === card.id ? (
        <EvidenceDrawer card={card} onClose={() => setEvidenceId(null)} />
      ) : null}
    </ActionCard>
  );

  return (
    <section className="page home-page">
      <PageHeader title="建议（次级）" subtitle="旧建议卡流已降权；日常请回到对话主壳" />

      {notice ? (
        <p className={`home-notice home-notice-${notice.tone}`} role="status" aria-live="polite">
          {notice.text}
        </p>
      ) : null}

      {error ? (
        <ErrorState message={error.message} onRetry={refetch} />
      ) : loading ? (
        <p className="home-loading" role="status">
          正在加载建议…
        </p>
      ) : visibleCards.length === 0 ? (
        <EmptyState
          title="目前没有值得打扰你的事情"
          hint="Hearth 会在有把握、且确实值得的时候才打扰你"
          action={
            <div className="home-empty-actions">
              {firstRun ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleSeed()}
                  disabled={seedBusy || scanBusy}
                  title={seedBusy ? '正在初始化合成数据…' : '写入两个合成项目与示例事件，并立即扫描'}
                >
                  {seedBusy ? '初始化中…' : '初始化 Demo 数据'}
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void handleDiscover()}
                disabled={scanBusy || seedBusy}
                title={scanBusy ? '正在扫描…' : '立即扫描事件源，生成新的建议'}
              >
                {scanBusy ? '扫描中…' : '重新扫描'}
              </button>
            </div>
          }
        />
      ) : (
        <div className="page-section" aria-label="主动建议">
          <p className="page-section-title">需要你决定</p>
          {primaryCards.map(renderCard)}
          {restCards.length > 0 ? (
            <button
              type="button"
              className="home-toggle-all"
              aria-expanded={expandedAll}
              onClick={() => setExpandedAll((v) => !v)}
            >
              {expandedAll ? '收起' : `查看全部（${restCards.length}）`}
            </button>
          ) : null}
          {expandedAll && restCards.length > 0 ? (
            <>
              <p className="page-section-title home-rest-title">
                其它建议与历史（{restCards.length}）
              </p>
              {restCards.map(renderCard)}
            </>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={confirmCard !== null}
        title="忽略这条建议？"
        description={
          confirmCard
            ? `将忽略「${confirmCard.title}」，并记录反馈「对我没用」。已忽略的建议不会再打扰你。`
            : undefined
        }
        confirmText="忽略"
        onCancel={() => setConfirmId(null)}
        onConfirm={() => void handleConfirmDismiss()}
      />
    </section>
  );
}
