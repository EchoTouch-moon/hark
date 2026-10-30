import { createLivingFlame } from './flame.js';

const canvas = document.getElementById('flame-canvas');
const root = document.getElementById('hearth-flame');
const button = document.getElementById('motion-toggle');
const field = createLivingFlame(canvas);
const media = matchMedia('(prefers-reduced-motion: reduce)');
let manualPause = false;
try { manualPause = localStorage.getItem('hearth.living-motion.v1') === 'paused'; } catch { /* local preview can work without storage */ }
let placement = 0;
let lastScope = location.hash;

function syncPause() {
  const busy = document.documentElement.dataset.hearthBusy === 'true';
  field.setPaused(manualPause || busy);
  const reduced = media.matches;
  button.disabled = reduced || busy;
  button.setAttribute('aria-pressed', String(manualPause || reduced || busy));
  button.setAttribute('aria-label', reduced ? '炉火已按系统偏好静止' : busy ? '忙碌演示中，炉火已静止' : manualPause ? '继续炉火动效' : '暂停炉火动效');
  button.title = reduced ? '系统已启用减少动态效果' : busy ? '切回空闲演示后恢复动效' : manualPause ? '继续炉火动效' : '暂停炉火动效';
  button.innerHTML = manualPause || reduced || busy
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 10 7-10 7Z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>';
}
function place() {
  placement = 0;
  const seat = document.querySelector('.hearth-seat');
  const opening = ['discover','conversation'].includes(document.documentElement.dataset.hearthView) && document.documentElement.dataset.hearthActive === 'false';
  const anchor = opening && seat ? seat : document.getElementById('hearth-dock');
  const r = anchor.getBoundingClientRect();
  const scale = opening ? innerWidth <= 620 ? 0.78 : 1 : 0.24;
  root.style.setProperty('--fire-x', `${r.left + r.width / 2 - 150}px`);
  root.style.setProperty('--fire-y', `${r.top + r.height / 2 - 120}px`);
  root.style.setProperty('--fire-scale', String(scale));
  root.dataset.placement = opening ? 'gathered' : 'beside';
  root.classList.add('is-ready');
}
function schedulePlace() { if (!placement) placement = requestAnimationFrame(place); }
function refresh() {
  field.setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  syncPause(); schedulePlace();
}
button.addEventListener('click', () => {
  manualPause = !manualPause;
  try { localStorage.setItem('hearth.living-motion.v1', manualPause ? 'paused' : 'running'); } catch { /* ephemeral preference */ }
  syncPause();
});
window.addEventListener('hearth:view', refresh);
window.addEventListener('hearth:theme', refresh);
window.addEventListener('hearth:cue', event => {
  if (['typing','sent','project'].includes(event.detail)) field.cue(event.detail);
});
window.addEventListener('hashchange', () => {
  if (location.hash !== lastScope) field.cue('project');
  lastScope = location.hash;
  refresh();
});
document.addEventListener('focusin', event => { if (event.target.id === 'conversation-input') field.setFocus(true); });
document.addEventListener('focusout', event => { if (event.target.id === 'conversation-input') field.setFocus(false); });
document.addEventListener('input', event => { if (event.target.id === 'conversation-input') field.cue('typing'); });
document.addEventListener('toggle', schedulePlace, true);
media.addEventListener('change', () => { syncPause(); schedulePlace(); });
window.addEventListener('resize', schedulePlace);
window.addEventListener('pagehide', () => { if (placement) cancelAnimationFrame(placement); field.dispose(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
// Read-only motion telemetry for deterministic prototype verification; no project data.
window.getHearthFlameState = () => field.snapshot();
refresh();
