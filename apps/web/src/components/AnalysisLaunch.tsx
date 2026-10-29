import { useEffect, useId, useRef, useState } from 'react';
import {
  previewAnalysis,
  saveAnalysisPrivacy,
  startAnalysis,
  type AnalysisInput,
  type AnalysisPreview,
  type AnalysisRun,
} from '../features/analysis';
import './AnalysisLaunch.css';

function pathsFromText(value: string): string[] {
  return [...new Set(value.split('\n').map((line) => line.trim()).filter(Boolean))];
}

/** All analysis entry points share this explicit preview/consent boundary. */
export function AnalysisLaunch({
  input,
  label,
  disabled = false,
  onComplete,
}: {
  input: AnalysisInput;
  label: string;
  disabled?: boolean;
  onComplete: (run: AnalysisRun) => void;
}) {
  const [preview, setPreview] = useState<AnalysisPreview | null>(null);
  const [excludedText, setExcludedText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<InstanceType<typeof window.HTMLDialogElement>>(null);
  const titleId = useId();
  const excludedId = useId();
  const privacyDirty = preview !== null && JSON.stringify(pathsFromText(excludedText)) !== JSON.stringify(preview.excludedPaths);

  useEffect(() => {
    setPreview(null);
    setError(null);
  }, [input.projectId, input.insightId, input.trigger]);

  useEffect(() => {
    if (preview && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [preview]);

  async function execute(consentFingerprint?: string): Promise<void> {
    setPreview(null);
    setBusy(true);
    setError(null);
    try {
      const run = await startAnalysis({ ...input, ...(consentFingerprint ? { consentFingerprint } : {}) });
      onComplete(run);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '分析失败，请重新查看预览后重试');
    } finally {
      setBusy(false);
    }
  }

  async function begin(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const next = await previewAnalysis(input);
      if (next.provider === 'mock') {
        await execute();
      } else {
        setExcludedText(next.excludedPaths.join('\n'));
        setPreview(next);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法读取分析预览');
    } finally {
      setBusy(false);
    }
  }

  async function updatePrivacy(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await saveAnalysisPrivacy(input.projectId, pathsFromText(excludedText));
      const next = await previewAnalysis(input);
      setExcludedText(next.excludedPaths.join('\n'));
      setPreview(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存排除路径或刷新预览');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="analysis-launch">
      <button type="button" className="btn btn-ghost" disabled={disabled || busy} onClick={() => void begin()}>
        {busy ? '处理中…' : label}
      </button>
      {error && !preview ? <p className="insight-warn" role="alert">{error}</p> : null}
      {preview ? (
        <dialog
          className="analysis-preview-dialog"
          ref={dialog}
          aria-labelledby={titleId}
          onCancel={(event) => { event.preventDefault(); if (!busy) setPreview(null); }}
        >
          <div className="analysis-preview-content">
            <h2 id={titleId}>确认向外部模型发送分析上下文</h2>
            <p>接收方：<strong>{preview.provider}</strong> · 模型：<strong>{preview.model ?? '未指定'}</strong></p>
            <p>
              本次会发送项目元数据、Git/测试观察事实、相关洞察，以及下列允许文档的有限摘录，用于生成只读建议。
              这不是项目代码审计。后台规则不会调用模型；只有确认本次发送后才会发起真实请求，并可能产生费用。
            </p>
            <p className="insight-warn">
              自动脱敏不能保证识别所有秘密。请检查完整预览，排除敏感文档；保密项目可直接取消。
              取消或关闭此窗口不会调用模型。
            </p>
            <section aria-label="本次文档摘录">
              <h3>本次文档</h3>
              {preview.context.files.length === 0 ? <p>未包含文档摘录。</p> : (
                <ul className="analysis-preview-files">
                  {preview.context.files.map((file) => (
                    <li key={file.relativePath}>
                      <span className="mono">{file.relativePath}</span>
                      {' · '}{file.bytes} 字节{file.truncated ? ' · 仅发送截取前缀' : ''}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <label htmlFor={excludedId}>该项目的排除路径</label>
              <p className="insight-card-meta">每行一个项目相对文件或目录路径。保存后会重新生成预览，再确认发送。</p>
              <textarea id={excludedId} rows={3} value={excludedText} disabled={busy} onChange={(event) => setExcludedText(event.target.value)} placeholder={'docs/private.md\ndocs/confidential/'} />
              <button type="button" className="btn btn-ghost" disabled={busy || !privacyDirty} onClick={() => void updatePrivacy()}>
                保存排除路径并刷新预览
              </button>
            </section>
            <details className="analysis-preview-json">
              <summary>查看完整发送上下文</summary>
              <pre>{JSON.stringify(preview.context, null, 2)}</pre>
            </details>
            {privacyDirty ? <p className="insight-warn">排除路径尚未保存。请刷新预览后再确认。</p> : null}
            {error ? <p className="insight-warn" role="alert">{error}</p> : null}
            <div className="analysis-preview-actions">
              <button type="button" className="btn btn-ghost" autoFocus disabled={busy} onClick={() => setPreview(null)}>取消</button>
              <button type="button" className="btn btn-primary" disabled={busy || privacyDirty} onClick={() => void execute(preview.context.contextFingerprint)}>
                确认发送并分析
              </button>
            </div>
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
