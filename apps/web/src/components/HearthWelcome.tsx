import { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { saveWelcomePreference } from '../features/welcome';
import type { HearthPeriod } from '../features/hearthPeriod';
import './HearthWelcome.css';

gsap.registerPlugin(useGSAP);

interface Props {
  initialName: string;
  paused: boolean;
  period: HearthPeriod;
  onExitStart: (name: string) => void;
  onComplete: () => void;
}

/** A local welcome, not a fictional account-registration flow. */
export function HearthWelcome({ initialName, paused, period, onExitStart, onComplete }: Props) {
  const [step, setStep] = useState<'arrival' | 'introduce' | 'leaving'>('arrival');
  const [exitFrom, setExitFrom] = useState<'arrival' | 'introduce'>('arrival');
  const visibleStep = step === 'leaving' ? exitFrom : step;
  const [name, setName] = useState(initialName);
  const [storageError, setStorageError] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const leaving = useRef(false);

  useEffect(() => {
    if (step === 'introduce') nameRef.current?.focus();
    if (step === 'arrival') firstRef.current?.focus();
  }, [step]);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add({ full: '(prefers-reduced-motion: no-preference)', reduced: '(prefers-reduced-motion: reduce)' }, context => {
      const still = paused || context.conditions?.reduced;
      let active = true;
      let completed = false;
      // Pure React callbacks must not re-enter the parent GSAP context from this
      // matchMedia child: that creates a parent/child context cycle on teardown.
      const complete = () => {
        if (!active || completed) return;
        completed = true;
        onComplete();
      };
      const timeline = gsap.timeline({ paused: true, defaults: { duration: .45, ease: 'power3.out' } });
      if (step === 'leaving') {
        timeline.addLabel('leave', 0)
          .to('.welcome-story', { opacity: 0, y: -16, duration: .24 }, 'leave')
          .to('.welcome-header, .welcome-footer', { opacity: 0, duration: .32 }, 'leave');
        timeline.to(rootRef.current, { opacity: 0, duration: .38 }, 'leave+=0.5');
        timeline.eventCallback('onComplete', complete);
      } else if (step === 'arrival') {
        timeline.addLabel('first-light', 0)
          .fromTo('.welcome-wordmark', { opacity: 0, y: 7 }, { opacity: 1, y: 0 }, 'first-light')
          .fromTo('.welcome-chapter, .welcome-story h1, .welcome-description', { opacity: 0, y: 12 }, { opacity: 1, y: 0, stagger: .075 }, 'first-light+=0.18')
          .fromTo('.welcome-actions', { opacity: 0, y: 10 }, { opacity: 1, y: 0 }, 'first-light+=0.38')
          .fromTo('.welcome-footer', { opacity: 0 }, { opacity: 1, stagger: .06 }, 'first-light+=0.3');
      } else {
        timeline.fromTo('.welcome-story > *', { opacity: 0, y: 10 }, { opacity: 1, y: 0, stagger: .065, duration: .32 });
      }
      // Reduced motion and manual pause reveal a stable end state; hidden tabs retain their place.
      const visibility = () => {
        if (document.hidden) timeline.pause();
        else if (!still) timeline.resume();
      };
      document.addEventListener('visibilitychange', visibility);
      if (still) timeline.progress(1);
      else if (!document.hidden) timeline.play();
      return () => {
        active = false;
        timeline.eventCallback('onComplete', null);
        document.removeEventListener('visibilitychange', visibility);
      };
    }, rootRef);
    return () => media.revert();
  }, { scope: rootRef, dependencies: [step, paused, onComplete], revertOnUpdate: true });

  function enter(temporary = false) {
    if (leaving.current) return;
    if (!temporary && !saveWelcomePreference(name)) { setStorageError(true); setStep('introduce'); return; }
    leaving.current = true;
    setExitFrom(step === 'arrival' ? 'arrival' : 'introduce');
    setStep('leaving');
    onExitStart(name.trim());
  }

  return <div className="hearth-welcome" ref={rootRef} data-testid="hearth-welcome" data-motion-engine="gsap" data-step={step} data-motion-paused={paused} data-period={period} role={step === 'leaving' ? undefined : 'dialog'} aria-modal={step === 'leaving' ? undefined : true} aria-labelledby="welcome-title" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); enter(); }
    if (event.key !== 'Tab' || step === 'leaving') return;
    const nodes = rootRef.current?.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button:not(:disabled),input:not(:disabled)');
    if (!nodes?.length) return;
    const first = nodes[0]; const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <header className="welcome-header">
      <span className="welcome-wordmark">Hearth<span>私人炉边</span></span>
      <span className="hearth-mode-label welcome-mode-badge" role="status" aria-label="当前对话为 Mock · 离线演示 · 不连接真实模型" title="对话回复由本机模拟生成，不连接真实模型">当前对话为 Mock · 离线演示</span>
      <button type="button" className="welcome-skip" disabled={step === 'leaving'} onClick={() => enter()}>跳过欢迎 <span aria-hidden="true">↗</span></button>
    </header>
    <div className="welcome-stage" aria-hidden={step === 'leaving' || undefined}>
      <div className="welcome-story" key={visibleStep}>
        <p className="welcome-chapter"><span /> {visibleStep === 'arrival' ? '01 — 初见' : '02 — 相识'}</p>
        <h1 id="welcome-title">{visibleStep === 'arrival' ? <>为重要的事，<br />留一点空间。</> : <>先认识一下，<br />再慢慢聊。</>}</h1>
        <p className="welcome-description">{visibleStep === 'arrival' ? <>先带入一个正在做的项目。<br />让真实的变化，成为谈话的起点。</> : <>不必介绍完整的人生。<br />一个称呼，就够我们开始。</>}</p>
        {visibleStep === 'arrival' ? <div className="welcome-actions"><button ref={firstRef} type="button" className="welcome-primary" disabled={step === 'leaving'} onClick={() => enter()}>带入我的项目 <span aria-hidden="true">→</span></button><p>只读观察，由你决定范围。</p><button type="button" className="welcome-back" disabled={step === 'leaving'} onClick={() => setStep('introduce')}>留下称呼（可选）</button></div> : <form className="welcome-form" onSubmit={event => { event.preventDefault(); enter(); }}>
          <label htmlFor="welcome-name">希望我怎么称呼你 <span>可选</span></label>
          <div className="welcome-name-field"><input ref={nameRef} id="welcome-name" name="nickname" autoComplete="nickname" maxLength={40} disabled={step === 'leaving'} value={name} onChange={event => setName(event.target.value)} placeholder="留下一个称呼" /><span aria-hidden="true">↳</span></div>
          <p className="welcome-local-note">只保存在这个浏览器，不创建账号。</p>
          {storageError && <p role="alert" className="welcome-storage-error">浏览器暂时无法保存设置。你仍可临时进入，下次打开可能再次看到欢迎。</p>}
          <div className="welcome-form-actions"><button type="button" className="welcome-back" disabled={step === 'leaving'} onClick={() => { setStep('arrival'); setStorageError(false); }}>返回</button><button disabled={step === 'leaving'} type={storageError ? 'button' : 'submit'} onClick={storageError ? () => enter(true) : undefined} className="welcome-primary">{storageError ? '临时进入' : '带入我的项目'} <span aria-hidden="true">→</span></button></div>
        </form>}
      </div>
    </div>
    <footer className="welcome-footer"><p><span aria-hidden="true">◌</span> 本地优先，按需开口。</p><p>当前为离线演示 · 不连接真实模型</p><span className="welcome-page-index">{visibleStep === 'arrival' ? '01' : '02'} <i /> 02</span></footer>
  </div>;
}
