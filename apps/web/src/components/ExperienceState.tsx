import type { EvidenceLabel, HearthViewModel, Permissions, StoryBeat } from '@hearth/hearth-contract';
import type { ViewModelSource } from '../features/hearthViewModel';
import './ExperienceState.css';

/** Style Bible v7 §6 state matrix, screen A (conversation / Seed). */
const PERMISSION_LABELS: Record<Exclude<keyof Permissions, 'execute'>, string> = { observe: '观察', research: '研究', model: '模型' };
const EVIDENCE_PREFIX: Record<EvidenceLabel['kind'], string> = { observer: '观察', research: '研究', decision: '决定' };

export function ErrorBar({ message, code }: { message: string; code?: string }) {
  return (
    <div className="xp-error" role="alert">
      <p className="xp-error__message">{message}</p>
      <div className="xp-error__row">
        {code ? <span className="xp-error__code mono">{code}</span> : null}
      </div>
    </div>
  );
}

export function deniedPermissions(p: Permissions): string[] {
  return (Object.keys(PERMISSION_LABELS) as (keyof typeof PERMISSION_LABELS)[]).filter((k) => !p[k]).map((k) => PERMISSION_LABELS[k]);
}

export function StateNotices({ vm, only }: { vm: HearthViewModel; only?: 'permission' | 'stale' }) {
  const denied = deniedPermissions(vm.permissions);
  return (
    <>
      {only !== 'stale' && vm.status === 'permission_denied' ? (
        <p className="xp-notice xp-notice--permission" role="status">
          未授权{denied.join('/') || '观察'}，部分内容不可用。<a href="/settings">去设置</a>
        </p>
      ) : null}
      {only !== 'permission' && vm.observationFreshness === 'stale' ? (
        <p className="xp-notice xp-notice--stale" role="status">观察已过期，火势和依据按最近一次观察显示。</p>
      ) : null}
    </>
  );
}

export function EvidenceList({ items }: { items: readonly EvidenceLabel[] }) {
  if (items.length === 0) return <p className="xp-evidence-empty">无事实来源</p>;
  return (
    <ul className="xp-evidence">
      {items.map((e) => (
        <li key={e.id} className="xp-evidence__item" data-kind={e.kind} title={e.label}>
          <span className="xp-evidence__mark" aria-hidden="true" />
          <span className="xp-evidence__prefix">{EVIDENCE_PREFIX[e.kind]}</span>
          <span className="xp-evidence__label">{e.label}</span>
        </li>
      ))}
    </ul>
  );
}

export function OpinionCard({ vm }: { vm: HearthViewModel }) {
  const op = vm.featuredOpinion;
  if (!op) return null;
  return (
    <article className="xp-opinion" data-revision={op.revisionId} aria-label="观点">
      <p className="xp-opinion__judgement">{op.opinion}</p>
      <p className="xp-opinion__why">{op.whyNow}</p>
      <EvidenceList items={op.evidence} />
      <p className="xp-opinion__meta">
        {op.evidence.length} 条依据
        {op.uncertainties.length ? ` · 有 ${op.uncertainties.length} 处不确定` : ''}
        {vm.observationFreshness === 'stale' ? ' · 依据可能过期' : ''}
      </p>
      <div className="xp-opinion__actions">
        {op.actions.map((a, i) => (
          <button key={a} type="button" className={`xp-opinion__action${i === 0 ? ' is-primary' : i === 2 ? ' is-quiet' : ''}`} aria-disabled="true" title="E1 静态界面，动作尚未接入">
            {a}
          </button>
        ))}
      </div>
    </article>
  );
}

const BEAT_MARK: Record<StoryBeat['kind'], string> = { 诞生: '○', 探索: '◌', 推进: '●', 沉淀: '■' };
const TIME = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function StoryBeats({ story }: { story: readonly StoryBeat[] }) {
  if (story.length === 0) return null;
  return (
    <ol className="xp-story" aria-label="项目故事">
      {story.map((b) => (
        <li key={`${b.kind}-${b.at}`} className="xp-story__beat">
          <span className="xp-story__mark" aria-hidden="true" data-mark={BEAT_MARK[b.kind] === '●' ? 'filled' : 'hollow'} />
          <div>
            <p className="xp-story__head"><span>{b.kind}</span> <time dateTime={b.at}>{TIME.format(new Date(b.at))}（UTC+8）</time></p>
            <p className="xp-story__summary">{b.summary}</p>
            <EvidenceList items={b.evidence} />
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Blocking states: invalid fixture or status error. Never shows mock or stale data. */
export function blockingError(source: ViewModelSource): { message: string; code?: string } | null {
  if (source.kind === 'invalid') return { message: source.message, code: 'viewmodel_invalid' };
  if (source.vm.status === 'error') return { message: source.vm.error.message, code: source.vm.error.code };
  return null;
}
