import { chromium } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const BASE_DIR = process.cwd();
const PROTOTYPES_DIR = path.join(BASE_DIR, 'prototypes');
const OUTPUT_DIR = path.join(BASE_DIR, 'docs', 'design', 'screenshots');

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

interface PageDef {
  conceptDir: string;
  conceptPrefix: string;
  fileName: string;
  pageName: string;
}

const PAGES: PageDef[] = [
  // 01-quiet-observatory
  { conceptDir: '01-quiet-observatory', conceptPrefix: '01-quiet-observatory', fileName: 'home.html', pageName: 'home' },
  { conceptDir: '01-quiet-observatory', conceptPrefix: '01-quiet-observatory', fileName: 'home-empty.html', pageName: 'home-empty' },
  { conceptDir: '01-quiet-observatory', conceptPrefix: '01-quiet-observatory', fileName: 'project-detail.html', pageName: 'project-detail' },
  { conceptDir: '01-quiet-observatory', conceptPrefix: '01-quiet-observatory', fileName: 'project-detail-empty.html', pageName: 'project-detail-empty' },

  // 02-editorial-workspace
  { conceptDir: '02-editorial-workspace', conceptPrefix: '02-editorial-workspace', fileName: 'home.html', pageName: 'home' },
  { conceptDir: '02-editorial-workspace', conceptPrefix: '02-editorial-workspace', fileName: 'home-empty.html', pageName: 'home-empty' },
  { conceptDir: '02-editorial-workspace', conceptPrefix: '02-editorial-workspace', fileName: 'project-detail.html', pageName: 'project-detail' },
  { conceptDir: '02-editorial-workspace', conceptPrefix: '02-editorial-workspace', fileName: 'project-detail-empty.html', pageName: 'project-detail-empty' },

  // 03-instrument-studio
  { conceptDir: '03-instrument-studio', conceptPrefix: '03-instrument-studio', fileName: 'home.html', pageName: 'home' },
  { conceptDir: '03-instrument-studio', conceptPrefix: '03-instrument-studio', fileName: 'home-empty.html', pageName: 'home-empty' },
  { conceptDir: '03-instrument-studio', conceptPrefix: '03-instrument-studio', fileName: 'project-detail.html', pageName: 'project-detail' },
  { conceptDir: '03-instrument-studio', conceptPrefix: '03-instrument-studio', fileName: 'project-detail-empty.html', pageName: 'project-detail-empty' },

  // 04-monolith-architect
  { conceptDir: '04-monolith-architect', conceptPrefix: '04-monolith-architect', fileName: 'home.html', pageName: 'home' },
  { conceptDir: '04-monolith-architect', conceptPrefix: '04-monolith-architect', fileName: 'home-empty.html', pageName: 'home-empty' },
  { conceptDir: '04-monolith-architect', conceptPrefix: '04-monolith-architect', fileName: 'project-detail.html', pageName: 'project-detail' },
  { conceptDir: '04-monolith-architect', conceptPrefix: '04-monolith-architect', fileName: 'project-detail-empty.html', pageName: 'project-detail-empty' },

  // 05-kinetic-cartography
  { conceptDir: '05-kinetic-cartography', conceptPrefix: '05-kinetic-cartography', fileName: 'home.html', pageName: 'home' },
  { conceptDir: '05-kinetic-cartography', conceptPrefix: '05-kinetic-cartography', fileName: 'home-empty.html', pageName: 'home-empty' },
  { conceptDir: '05-kinetic-cartography', conceptPrefix: '05-kinetic-cartography', fileName: 'project-detail.html', pageName: 'project-detail' },
  { conceptDir: '05-kinetic-cartography', conceptPrefix: '05-kinetic-cartography', fileName: 'project-detail-empty.html', pageName: 'project-detail-empty' },

  // 06-luminescent-gallery
  { conceptDir: '06-luminescent-gallery', conceptPrefix: '06-luminescent-gallery', fileName: 'home.html', pageName: 'home' },
  { conceptDir: '06-luminescent-gallery', conceptPrefix: '06-luminescent-gallery', fileName: 'home-empty.html', pageName: 'home-empty' },
  { conceptDir: '06-luminescent-gallery', conceptPrefix: '06-luminescent-gallery', fileName: 'project-detail.html', pageName: 'project-detail' },
  { conceptDir: '06-luminescent-gallery', conceptPrefix: '06-luminescent-gallery', fileName: 'project-detail-empty.html', pageName: 'project-detail-empty' },
];

async function main() {
  console.log('[capture-prototypes] Launching Chromium browser...');
  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 2, // High-DPI crisp screenshot
  });

  const page = await context.newPage();

  for (const item of PAGES) {
    const filePath = path.join(PROTOTYPES_DIR, item.conceptDir, item.fileName);
    const fileUrl = `file://${filePath}`;

    console.log(`[capture-prototypes] Loading ${item.conceptDir}/${item.fileName}...`);
    await page.goto(fileUrl, { waitUntil: 'load' });

    // 1. Light Theme
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
      const btn = document.querySelector(
        '.obs-theme-toggle, .gazette-theme-toggle, .rack-theme-toggle, .mono-theme-btn, .carto-theme-toggle, .gallery-theme-btn'
      );
      if (btn) {
        if (btn.classList.contains('obs-theme-toggle')) btn.textContent = 'THEME: LIGHT';
        if (btn.classList.contains('gazette-theme-toggle')) btn.textContent = 'PAPER: LIGHT';
        if (btn.classList.contains('rack-theme-toggle')) btn.textContent = 'CHASSIS: LIGHT';
        if (btn.classList.contains('mono-theme-btn')) btn.textContent = 'THEME: LIGHT';
        if (btn.classList.contains('carto-theme-toggle')) btn.textContent = 'THEME: LIGHT';
        if (btn.classList.contains('gallery-theme-btn')) btn.textContent = 'ROOM: LIGHT';
      }
    });
    await page.waitForTimeout(200);

    const lightOutPath = path.join(OUTPUT_DIR, `${item.conceptPrefix}-${item.pageName}-light.png`);
    await page.screenshot({ path: lightOutPath, fullPage: true });
    console.log(`  -> Saved: ${path.basename(lightOutPath)}`);

    // 2. Dark Theme
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
      const btn = document.querySelector(
        '.obs-theme-toggle, .gazette-theme-toggle, .rack-theme-toggle, .mono-theme-btn, .carto-theme-toggle, .gallery-theme-btn'
      );
      if (btn) {
        if (btn.classList.contains('obs-theme-toggle')) btn.textContent = 'THEME: DARK';
        if (btn.classList.contains('gazette-theme-toggle')) btn.textContent = 'PAPER: DARK';
        if (btn.classList.contains('rack-theme-toggle')) btn.textContent = 'CHASSIS: DARK';
        if (btn.classList.contains('mono-theme-btn')) btn.textContent = 'THEME: DARK';
        if (btn.classList.contains('carto-theme-toggle')) btn.textContent = 'THEME: DARK';
        if (btn.classList.contains('gallery-theme-btn')) btn.textContent = 'ROOM: DARK';
      }
    });
    await page.waitForTimeout(200);

    const darkOutPath = path.join(OUTPUT_DIR, `${item.conceptPrefix}-${item.pageName}-dark.png`);
    await page.screenshot({ path: darkOutPath, fullPage: true });
    console.log(`  -> Saved: ${path.basename(darkOutPath)}`);
  }

  await browser.close();
  console.log(`[capture-prototypes] Successfully generated all screenshots in ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error('[capture-prototypes] Error:', err);
  process.exit(1);
});
