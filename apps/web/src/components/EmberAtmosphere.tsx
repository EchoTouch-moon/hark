import { useEffect, useId, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { EMBER_CUE_EVENT, emitEmberCue, isEmberMotionPaused, readEmberCue } from '../features/ember-cues';
import './EmberAtmosphere.css';

gsap.registerPlugin(useGSAP);

export interface EmberAtmosphereProps {
  band?: 'cool' | 'warm' | 'hot';
  paused?: boolean;
}

// Equal command topology permits a small, real change in curvature without MorphSVG.
const tongues = [
  ['M0 230C12 217 31 210 27 185C47 196 45 208 57 216C64 201 60 184 71 169C68 199 95 200 111 230Z', 'M0 230C12 217 34 209 31 182C49 194 46 207 57 216C66 201 64 183 76 168C71 199 95 200 111 230Z'],
  ['M77 230C111 218 129 211 123 190C137 196 140 204 145 213C155 192 145 171 157 149C154 177 180 193 177 208C187 205 190 196 189 187C212 206 211 222 224 230Z', 'M77 230C111 218 132 210 128 187C142 196 142 205 145 213C158 192 152 170 165 148C159 177 182 192 177 208C188 205 193 195 193 185C214 206 211 222 224 230Z'],
  ['M204 230C226 218 249 219 251 198C262 208 260 218 270 221C283 213 280 199 287 191C285 217 309 219 333 230Z', 'M204 230C226 218 251 217 256 196C265 208 260 218 270 221C285 213 284 199 291 190C286 217 309 219 333 230Z'],
  ['M1092 230C1120 219 1140 211 1138 192C1154 203 1153 213 1165 216C1174 200 1168 180 1181 165C1175 190 1194 200 1196 213C1210 209 1217 220 1234 230Z', 'M1092 230C1120 219 1137 211 1133 190C1150 202 1153 213 1165 216C1171 200 1162 180 1174 162C1170 190 1190 200 1196 213C1210 209 1217 220 1234 230Z'],
  ['M1215 230C1242 211 1272 211 1267 181C1285 192 1285 203 1293 211C1305 193 1296 167 1312 141C1306 169 1328 188 1331 205C1345 195 1342 183 1348 173C1357 196 1344 216 1374 230Z', 'M1215 230C1242 211 1268 210 1261 179C1280 191 1285 203 1293 211C1302 193 1289 166 1304 138C1302 169 1324 188 1331 205C1342 195 1339 183 1343 170C1355 196 1344 216 1374 230Z'],
  ['M1351 230C1375 214 1391 214 1393 195C1404 204 1405 216 1415 215C1421 198 1411 184 1423 166C1420 190 1434 201 1440 204L1440 230Z', 'M1351 230C1375 214 1387 213 1388 193C1401 204 1405 216 1415 215C1418 198 1406 183 1417 163C1416 190 1434 201 1440 204L1440 230Z'],
];

function isWritingSurface(target: globalThis.EventTarget | null): target is HTMLElement {
  return target instanceof HTMLElement && (target instanceof HTMLTextAreaElement
    || (target instanceof HTMLInputElement && ['text', 'search', 'email', 'url', 'tel', ''].includes(target.type))
    || target.isContentEditable);
}

/** A content-free room: temporary attention never changes the relationship band. */
export function EmberAtmosphere({ band = 'cool', paused = false }: EmberAtmosphereProps) {
  const root = useRef<HTMLDivElement>(null);
  const unique = useId().replace(/:/g, '');
  const timelines = useRef<gsap.core.Animation[]>([]);
  const [preferencePaused, setPreferencePaused] = useState(isEmberMotionPaused);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const still = paused || preferencePaused || hidden || reduced;
  const stillRef = useRef(still);
  stillRef.current = still;

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReduced(media.matches);
    const visibility = () => setHidden(document.hidden);
    const preference = (event: Event) => {
      const cue = readEmberCue(event);
      if (cue?.kind === 'motion-preference' && cue.paused !== undefined) setPreferencePaused(cue.paused);
    };
    media.addEventListener('change', motion);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener(EMBER_CUE_EVENT, preference);
    return () => {
      media.removeEventListener('change', motion);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener(EMBER_CUE_EVENT, preference);
    };
  }, []);

  // Capture only input intent. Never inspect values, text, identity or project data.
  useEffect(() => {
    let lastTyping = -Infinity;
    const focus = (event: globalThis.FocusEvent) => {
      if (isWritingSurface(event.target)) emitEmberCue('focus');
    };
    const release = (event: globalThis.FocusEvent) => {
      if (isWritingSurface(event.target) && !isWritingSurface(event.relatedTarget)) emitEmberCue('release');
    };
    const typing = (event: Event) => {
      const now = window.performance.now();
      if (!isWritingSurface(event.target) || now - lastTyping < 400) return;
      lastTyping = now;
      emitEmberCue('typing');
    };
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', release);
    document.addEventListener('input', typing);
    return () => {
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', release);
      document.removeEventListener('input', typing);
    };
  }, []);

  useGSAP(() => {
    const node = root.current;
    if (!node || reduced) return;
    const select = gsap.utils.selector(node);
    const ambient = gsap.timeline({ paused: true });
    // Local fire tongues and the room deliberately keep different phases.
    select('.ember-atmosphere__tongue').forEach((path, index) => {
      const contour = tongues[index]?.[1];
      if (!contour) return;
      ambient.to(path, { attr: { d: contour }, duration: 2.2 + index * .23,
        repeat: -1, yoyo: true, ease: 'sine.inOut' }, index * .19);
    });
    ambient.to(select('.ember-atmosphere__breath'), { opacity: .84, scaleX: 1.055, scaleY: 1.06,
      duration: 3.6, repeat: -1, yoyo: true, ease: 'sine.inOut', transformOrigin: '50% 100%' }, 0);
    ambient.to(select('.ember-atmosphere__side--left'), { opacity: .8, yPercent: -3,
      duration: 3.1, repeat: -1, yoyo: true, ease: 'sine.inOut' }, .7);
    ambient.to(select('.ember-atmosphere__side--right'), { opacity: .9, yPercent: 3,
      duration: 3.8, repeat: -1, yoyo: true, ease: 'sine.inOut' }, 1.3);
    ambient.to(select('.ember-atmosphere__fire'), { opacity: .8, duration: 2.7,
      repeat: -1, yoyo: true, ease: 'sine.inOut' }, .6);

    // Reused, bounded envelopes: events restart a response, never stack brightness.
    const focus = gsap.timeline({ paused: true }).to(select('.ember-atmosphere__attention'),
      { opacity: .65, scaleX: .82, duration: .3, ease: 'power2.out' });
    const typing = gsap.timeline({ paused: true })
      .to(select('.ember-atmosphere__reply'), { opacity: .38, scaleX: .9, duration: .2, ease: 'sine.out' })
      .to(select('.ember-atmosphere__reply'), { opacity: 0, scaleX: 1, duration: .45, ease: 'sine.inOut' });
    const answer = gsap.timeline({ paused: true })
      .to(select('.ember-atmosphere__reply'), { opacity: .72, scaleX: 1.06, duration: .34, ease: 'power2.out' })
      .to(select('.ember-atmosphere__reply'), { opacity: 0, scaleX: 1.13, duration: .7, ease: 'sine.inOut' });
    const chapter = gsap.timeline({ paused: true })
      .to(select('.ember-atmosphere__chapter--left'), { opacity: .7, duration: .22, ease: 'sine.out' }, 0)
      .to(select('.ember-atmosphere__chapter--left'), { opacity: 0, duration: .42, ease: 'sine.inOut' }, .22)
      .to(select('.ember-atmosphere__chapter--right'), { opacity: .65, duration: .22, ease: 'sine.out' }, .14)
      .to(select('.ember-atmosphere__chapter--right'), { opacity: 0, duration: .32, ease: 'sine.inOut' }, .36);
    const all = [ambient, focus, typing, answer, chapter];
    timelines.current = all;
    let lastTyping = -Infinity;
    const cue = (event: Event) => {
      const detail = readEmberCue(event);
      if (!detail) return;
      node.dataset.cue = detail.kind;
      if (stillRef.current || document.hidden || detail.kind === 'motion-preference') return;
      if (detail.kind === 'focus') focus.play();
      else if (detail.kind === 'release') focus.reverse();
      else if (detail.kind === 'typing') {
        const now = window.performance.now();
        if (now - lastTyping < 400) return;
        lastTyping = now;
        answer.pause();
        typing.restart();
      } else if (detail.kind === 'acknowledged' || detail.kind === 'project-added') {
        typing.pause();
        answer.restart();
      } else if (detail.kind === 'chapter') chapter.restart();
      else if (detail.kind === 'declined' || detail.kind === 'failed') {
        typing.pause(0); answer.pause(0); chapter.pause(0); focus.reverse();
        // Both envelopes share the same zero-opacity rest pose.
        typing.progress(1).pause(); answer.progress(1).pause(); chapter.progress(1).pause();
      }
    };
    window.addEventListener(EMBER_CUE_EVENT, cue);
    if (!stillRef.current) ambient.play();
    return () => {
      window.removeEventListener(EMBER_CUE_EVENT, cue);
      timelines.current = [];
    };
  }, { scope: root, dependencies: [reduced], revertOnUpdate: true });

  useEffect(() => {
    // Preserve each playhead and direction. Completed one-shot cues stay completed.
    const animations = timelines.current;
    if (still) {
      animations.forEach(animation => {
        animation.data = { resume: !animation.paused() };
        animation.pause();
      });
    } else {
      animations.forEach((animation, index) => {
        if (index === 0 || animation.data?.resume) animation.paused(false);
        animation.data = undefined;
      });
    }
  }, [still, reduced]);

  return (
    <div ref={root} className="ember-atmosphere" data-band={band} data-still={still}
      data-cue="rest" data-motion-engine="gsap" aria-hidden="true">
      <div className="ember-atmosphere__breath" />
      <div className="ember-atmosphere__side ember-atmosphere__side--left" />
      <div className="ember-atmosphere__side ember-atmosphere__side--right" />
      <div className="ember-atmosphere__attention" />
      <div className="ember-atmosphere__reply" />
      <div className="ember-atmosphere__chapter ember-atmosphere__chapter--left" />
      <div className="ember-atmosphere__chapter ember-atmosphere__chapter--right" />
      <svg className="ember-atmosphere__fire" viewBox="0 0 1440 230" preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient id={`${unique}-fire`} x1="0" y1="140" x2="0" y2="230" gradientUnits="userSpaceOnUse">
            <stop stopColor="#E9B576" stopOpacity="0" />
            <stop offset=".28" stopColor="#EAC391" stopOpacity=".28" />
            <stop offset=".67" stopColor="#C9854A" stopOpacity=".34" />
            <stop offset="1" stopColor="#BA6635" stopOpacity=".08" />
          </linearGradient>
        </defs>
        <g fill={`url(#${unique}-fire)`}>
          {tongues.map(([path], index) => <path key={index} className="ember-atmosphere__tongue" d={path} />)}
        </g>
      </svg>
    </div>
  );
}
