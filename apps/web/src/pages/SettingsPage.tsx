import { useCallback, useEffect, useId, useState } from 'react';
import { ErrorState, PageHeader } from '../components';
import { apiFetch } from '../features/api/client';
import './SettingsPage.css';

/** GET/PUT /api/v1/settings 的完整形状（含 timezone） */
interface SettingsPayload {
  quietHours: { start: string; end: string };
  maxCardsPerDay: number;
  demoMode: boolean;
  timezone: string;
}

/** GET /api/v1/health 的完整形状（含 contractVersion） */
interface HealthPayload {
  status: string;
  db: string;
  demoMode: boolean;
  provider: string;
  version: string;
  contractVersion: string;
}

interface SettingsForm {
  quietStart: string;
  quietEnd: string;
  maxCards: string;
  timezone: string;
}

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_TIMEZONE = 'Asia/Shanghai';

/** 数据源清单：fixture 已启用；真实 connector 一律 OFF 且未接入 */
const DATA_SOURCES: ReadonlyArray<{
  key: 'fixture' | 'github' | 'calendar' | 'mail' | 'vault';
  label: string;
  note: string;
  enabled: boolean;
}> = [
  { key: 'fixture', label: '合成事件源（fixture）', note: '仅合成演示数据', enabled: true },
  { key: 'github', label: 'GitHub', note: '未接入', enabled: false },
  { key: 'calendar', label: '日历', note: '未接入', enabled: false },
  { key: 'mail', label: '邮件', note: '未接入', enabled: false },
  { key: 'vault', label: '个人知识库', note: '未接入，绝不自动触碰', enabled: false },
];

async function fetchSettings(signal?: AbortSignal): Promise<SettingsPayload> {
  const dto = await apiFetch<SettingsPayload>('/api/v1/settings', { signal });
  // 兼容历史写入中缺失 timezone 的情况
  return {
    ...dto,
    quietHours: dto.quietHours ?? { start: '22:00', end: '08:00' },
    maxCardsPerDay: dto.maxCardsPerDay,
    demoMode: dto.demoMode,
    timezone: typeof dto.timezone === 'string' && dto.timezone !== '' ? dto.timezone : DEFAULT_TIMEZONE,
  };
}

async function fetchHealth(signal?: AbortSignal): Promise<HealthPayload> {
  return apiFetch<HealthPayload>('/api/v1/health', { signal });
}

/**
 * U05 Settings（M1-T08）：
 * 环境状态 / 数据源 / 安静时段 / 每日卡片预算 / Demo 数据保护状态。
 */
export function SettingsPage() {
  const settingsFormId = useId();
  const quietStartId = `${settingsFormId}-quiet-start`;
  const quietEndId = `${settingsFormId}-quiet-end`;
  const maxCardsId = `${settingsFormId}-max-cards`;
  const timezoneId = `${settingsFormId}-timezone`;

  const [settings, setSettings] = useState<SettingsPayload | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [form, setForm] = useState<SettingsForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const loaded = await fetchSettings(controller.signal);
        if (cancelled) return;
        setSettings(loaded);
        setSettingsError(null);
        setForm({
          quietStart: loaded.quietHours.start,
          quietEnd: loaded.quietHours.end,
          maxCards: String(loaded.maxCardsPerDay),
          timezone: loaded.timezone,
        });
      } catch (cause) {
        if (cancelled || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        setSettings(null);
        setForm(null);
        setSettingsError(cause instanceof Error ? cause.message : '加载设置失败');
      }
    })();

    (async () => {
      try {
        const loaded = await fetchHealth(controller.signal);
        if (cancelled) return;
        setHealth(loaded);
        setHealthError(null);
      } catch (cause) {
        if (cancelled || (cause instanceof DOMException && cause.name === 'AbortError')) return;
        setHealth(null);
        setHealthError(cause instanceof Error ? cause.message : '加载环境状态失败');
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [reloadKey]);

  const retry = useCallback(() => {
    setSettingsError(null);
    setHealthError(null);
    setReloadKey((key) => key + 1);
  }, []);

  const updateForm = useCallback((patch: Partial<SettingsForm>): void => {
    setForm((prev) => (prev === null ? prev : { ...prev, ...patch }));
    setSaveNotice(null);
  }, []);

  const handleSave = useCallback(async (): Promise<void> => {
    if (settings === null || form === null) return;
    setSaveError(null);
    setSaveNotice(null);

    if (!HH_MM.test(form.quietStart) || !HH_MM.test(form.quietEnd)) {
      setSaveError('安静时段需要是有效的 HH:mm 时间（例如 22:00 与 08:00）。');
      return;
    }
    const maxCards = Number(form.maxCards);
    if (!Number.isInteger(maxCards) || maxCards < 1 || maxCards > 10) {
      setSaveError('每日卡片预算必须是 1 到 10 之间的整数。');
      return;
    }
    const timezone = form.timezone.trim();
    if (timezone === '') {
      setSaveError('时区不能为空（例如 Asia/Shanghai）。');
      return;
    }

    setSaving(true);
    try {
      const saved = await apiFetch<SettingsPayload>('/api/v1/settings', {
        method: 'PUT',
        json: {
          quietHours: { start: form.quietStart, end: form.quietEnd },
          maxCardsPerDay: maxCards,
          demoMode: settings.demoMode,
          timezone,
        },
      });
      setSettings(saved);
      setForm({
        quietStart: saved.quietHours.start,
        quietEnd: saved.quietHours.end,
        maxCards: String(saved.maxCardsPerDay),
        timezone: saved.timezone,
      });
      setSaveNotice('设置已保存。');
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : '保存设置失败');
    } finally {
      setSaving(false);
    }
  }, [settings, form]);

  /* ---------- 渲染 ---------- */

  if (settings === null || settingsError !== null) {
    return (
      <section className="page">
        <PageHeader title="设置" subtitle="运行环境、数据源与打扰边界" />
        <div className="page-section" aria-busy={settingsError === null} aria-label="设置加载">
          {settingsError !== null ? (
            <ErrorState message={settingsError} onRetry={retry} />
          ) : (
            <div className="set-skeleton-stack" aria-hidden="true">
              <div className="skeleton skeleton-block" />
              <div className="skeleton skeleton-block" />
            </div>
          )}
        </div>
      </section>
    );
  }

  const demoBadgeVisible = health?.demoMode === true;

  return (
    <section className="page">
      <PageHeader title="设置" subtitle="运行环境、数据源与打扰边界" />

      <div className="page-section" aria-label="运行环境">
        <p className="page-section-title">运行环境</p>
        <div className="card set-env-card">
          <div className="set-env-head">
            <h2 className="set-env-title">本地服务状态</h2>
            {demoBadgeVisible ? (
              <span className="set-demo-badge" role="status">
                Demo 模式 · 仅本机合成数据
              </span>
            ) : null}
          </div>
          {healthError !== null ? (
            <div className="set-health-error">
              <ErrorState message={healthError} onRetry={retry} />
            </div>
          ) : health === null ? (
            <div className="set-skeleton-stack" aria-hidden="true">
              <div className="skeleton skeleton-block" />
            </div>
          ) : (
            <dl className="set-env-grid">
              <div className="set-env-item">
                <dt>服务状态</dt>
                <dd>
                  <span className="status-badge is-success">{health.status}</span>
                </dd>
              </div>
              <div className="set-env-item">
                <dt>数据库</dt>
                <dd>
                  <span
                    className={`status-badge ${health.db === 'ok' ? 'is-success' : 'is-danger'}`}
                  >
                    {health.db}
                  </span>
                </dd>
              </div>
              <div className="set-env-item">
                <dt>Provider</dt>
                <dd>
                  <code className="mono">{health.provider}</code>
                </dd>
              </div>
              <div className="set-env-item">
                <dt>版本</dt>
                <dd>{health.version}</dd>
              </div>
              <div className="set-env-item">
                <dt>合同版本</dt>
                <dd>{health.contractVersion}</dd>
              </div>
            </dl>
          )}
        </div>
      </div>

      <div className="page-section" aria-label="数据源">
        <p className="page-section-title">数据源</p>
        <ul className="card set-source-list">
          {DATA_SOURCES.map((source) => (
            <li key={source.key} className="set-source-row">
              <span className="set-source-label">{source.label}</span>
              <span className={`status-badge ${source.enabled ? 'is-success' : 'is-neutral'}`}>
                {source.enabled ? '已启用' : 'OFF'}
              </span>
              <span className="set-source-note">{source.note}</span>
            </li>
          ))}
        </ul>
        <p className="set-source-footnote">真实 connector 尚未接入；接入前不会读取任何真实数据。</p>
      </div>

      <div className="page-section" aria-label="打扰边界">
        <p className="page-section-title">打扰边界</p>
        <form
          className="card set-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <fieldset className="set-fieldset">
            <legend className="set-legend">安静时段（此时间段内不打扰你）</legend>
            <div className="set-time-row">
              <div className="set-field">
                <label htmlFor={quietStartId}>开始</label>
                <input
                  id={quietStartId}
                  type="time"
                  required
                  value={form?.quietStart ?? '22:00'}
                  onChange={(event) => updateForm({ quietStart: event.target.value })}
                />
              </div>
              <div className="set-field">
                <label htmlFor={quietEndId}>结束</label>
                <input
                  id={quietEndId}
                  type="time"
                  required
                  value={form?.quietEnd ?? '08:00'}
                  onChange={(event) => updateForm({ quietEnd: event.target.value })}
                />
              </div>
            </div>
          </fieldset>

          <div className="set-field">
            <label htmlFor={maxCardsId}>每日卡片预算（1–10 张）</label>
            <input
              id={maxCardsId}
              type="number"
              min={1}
              max={10}
              step={1}
              required
              value={form?.maxCards ?? '3'}
              onChange={(event) => updateForm({ maxCards: event.target.value })}
            />
            <p className="set-field-hint" id={`${maxCardsId}-hint`}>
              每天最多向你展示的建议卡片数量，超出部分静默留存。
            </p>
          </div>

          <div className="set-field">
            <label htmlFor={timezoneId}>时区</label>
            <input
              id={timezoneId}
              type="text"
              required
              placeholder="Asia/Shanghai"
              value={form?.timezone ?? DEFAULT_TIMEZONE}
              onChange={(event) => updateForm({ timezone: event.target.value })}
            />
            <p className="set-field-hint" id={`${timezoneId}-hint`}>
              IANA 时区名称，用于安静时段与过期时间的计算。
            </p>
          </div>

          {saveError !== null ? (
            <p className="set-inline-error" role="alert">
              {saveError}
            </p>
          ) : null}
          {saveNotice !== null ? (
            <p className="set-notice" role="status">
              {saveNotice}
            </p>
          ) : null}

          <div className="set-form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving || form === null}>
              {saving ? '保存中…' : '保存设置'}
            </button>
          </div>
        </form>
      </div>

      <div className="page-section" aria-label="Demo 数据">
        <p className="page-section-title">Demo 数据</p>
        <div className="card set-danger-zone">
          <div className="set-danger-text">
            <h2 className="set-danger-title">重置 Demo 数据</h2>
            <p className="set-danger-desc">
              暂时无法可靠区分演示数据和真实数据，为保护已有数据，重置功能暂不可用。
            </p>
          </div>
          <button type="button" className="btn btn-danger" disabled>
            重置 Demo 数据
          </button>
        </div>
      </div>

    </section>
  );
}
