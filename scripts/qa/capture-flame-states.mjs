import { chromium, expect } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const base = process.env.HEARTH_QA_URL ?? 'http://127.0.0.1:4404';
const out = process.env.HEARTH_FLAME_CAPTURE_OUT ?? 'handoff/EVIDENCE/flame-shapes-refined';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader'] });
const stages = [
  { key: 'spark', name: '初火星', shape: [0.26, 0.23], count: 0, project: null, cards: [], events: [] },
  { key: 'sprout', name: '初生火苗', shape: [0.54, 0.52], count: 1, project: null, cards: [], events: [] },
  { key: 'blaze', name: '繁盛之火', shape: [1, 1], count: 3, project: null, cards: [], events: [] },
  { key: 'golden', name: '常明金火', shape: [0.88, 0.82], count: 0, project: 'fixture-project', cards: [{ status: 'completed' }], events: [] },
  { key: 'dormant', name: '静卧余烬', shape: [0.48, 0.25], count: 0, project: 'fixture-project', cards: [], events: [{ occurredAt: '2026-10-01T10:00:00+08:00', source: { observedAt: '2026-10-01T10:00:00+08:00' } }] },
];
const lines = [];
try {
  for (const [period, stamp] of [['day', '2026-10-30T10:00:00+08:00'], ['night', '2026-10-30T21:00:00+08:00']]) {
    for (const stage of stages) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'Asia/Shanghai', reducedMotion: 'reduce' });
      await context.addInitScript(stamp => {
        localStorage.setItem('hearth.welcome.v1', JSON.stringify({ version: 1, completed: true, name: '' }));
        localStorage.setItem('hearth.flame.size', '1');
        const NativeDate = Date;
        const offset = NativeDate.parse(stamp) - NativeDate.now();
        window.Date = class extends NativeDate {
          constructor(...args) { if (args.length) super(...args); else super(NativeDate.now() + offset); }
          static now() { return NativeDate.now() + offset; }
        };
      }, stamp);
      await context.addInitScript(() => {
        const names = new WeakMap();
        const location = WebGLRenderingContext.prototype.getUniformLocation;
        const uniform = WebGLRenderingContext.prototype.uniform1f;
        window.__flameCaptureUniforms = {};
        WebGLRenderingContext.prototype.getUniformLocation = function (program, name) {
          const result = location.call(this, program, name);
          if (result) names.set(result, name);
          return result;
        };
        WebGLRenderingContext.prototype.uniform1f = function (where, value) {
          const name = where && names.get(where);
          if (name) window.__flameCaptureUniforms[name] = value;
          return uniform.call(this, where, value);
        };
      });
      await context.route('**/api/v1/**', route => {
        const url = new URL(route.request().url());
        if (route.request().method() !== 'GET') return route.continue();
        if (url.pathname === '/api/v1/threads') return route.fulfill({ json: { threads: [{ id: 'compare', title: '合成话题', projectId: stage.project, updatedAt: stamp }] } });
        if (url.pathname === '/api/v1/chat/history') {
          const messages = Array.from({ length: stage.count }, (_, i) => ({ id: `synthetic-${i}`, threadId: 'compare', role: 'user', content: `合成交流 ${i + 1}`, createdAt: '2026-10-30T00:00:00+08:00', adapter: 'mock' }));
          return route.fulfill({ json: { messages } });
        }
        if (url.pathname === '/api/v1/projects/fixture-project') return route.fulfill({ json: { project: { id: 'fixture-project', name: '合成项目' }, events: stage.events, cards: stage.cards, runs: [] } });
        if (url.pathname === '/api/v1/threads/compare/proactive') return route.fulfill({ json: { suggestion: null } });
        return route.continue();
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(`${base}/t/compare`);
      const room = page.locator('.ember-atmosphere');
      await expect(room).toHaveAttribute('data-flame-stage', stage.key, { timeout: 15000 });
      await expect(room).toHaveAttribute('data-renderer', 'webgl', { timeout: 15000 });
      await expect(room).toHaveAttribute('data-texture', 'ready', { timeout: 15000 });
      await expect(room).toHaveAttribute('data-period', period);
      await expect(room).toHaveAttribute('data-size', '1.00');
      if (stage.key === 'spark' && period === 'day') {
        await expect(page.getByRole('textbox', { name: '输入消息', exact: true })).toBeVisible();
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${out}/day-spark-full.png` });
      }
      await page.addStyleTag({ content: '.canvas-body,.thread-rail,.detail-drawer { visibility:hidden !important; }' });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${out}/${period}-${stage.key}.png` });
      if (errors.length) throw Error(errors.join('\n'));
      const actual = await page.evaluate(() => window.__flameCaptureUniforms);
      expect(actual.u_heat).toBeCloseTo(Number(await room.getAttribute('data-heat')), 2);
      expect(actual.u_size).toBeCloseTo(1, 2);
      expect(actual.u_shapeWidth).toBeCloseTo(stage.shape[0], 2);
      expect(actual.u_shapeHeight).toBeCloseTo(stage.shape[1], 2);
      expect(actual.u_golden).toBeCloseTo(Number(await room.getAttribute('data-golden')), 2);
      expect(actual.u_dormant).toBeCloseTo(Number(await room.getAttribute('data-dormant')), 2);
      const info = `${period} ${stage.key}: heat=${await room.getAttribute('data-heat')} size=${await room.getAttribute('data-size')} golden=${await room.getAttribute('data-golden')} dormant=${await room.getAttribute('data-dormant')} rendered=${JSON.stringify(actual)}`;
      console.log(info); lines.push(info);
      await context.close();
    }
    const montage = await browser.newPage({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 1 });
    const cards = stages.map(stage => {
      const image = readFileSync(`${out}/${period}-${stage.key}.png`).toString('base64');
      return `<article><p>${stage.name}</p><img alt="${stage.name}" src="data:image/png;base64,${image}"></article>`;
    }).join('');
    await montage.setContent(`<html><head><style>*{box-sizing:border-box}body{margin:0;background:#eee9e1;color:#332c25;font:18px -apple-system,'PingFang SC',sans-serif;padding:32px}h1{font-size:22px;font-weight:600;margin:0 0 8px}small{color:#756a60}main{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:20px}article{background:#fff;border-radius:12px;overflow:hidden;border:1px solid #ddd4ca}p{margin:0;padding:12px 16px;font-size:16px}img{display:block;width:100%;height:auto}</style></head><body><h1>${period === 'day' ? '白天' : '夜间'} · 火焰状态对照</h1><small>相同视口与火焰大小 · 页面文字隐藏，显示真实火影 · 合成输入</small><main>${cards}</main></body></html>`);
    await montage.screenshot({ path: `${out}/${period}-comparison.png`, fullPage: true });
    await montage.close();
  }
  writeFileSync(`${out}/comparison.txt`, lines.join('\n') + '\n');
} finally { await browser.close(); }
