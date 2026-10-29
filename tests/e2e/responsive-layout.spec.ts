import { expect, test } from '@playwright/test';

test.describe('UI-01.3: Responsive layout, navigation and detail drawer', () => {
  test('navigation collapses to 72px icon-only at 1024px with accessible names and no horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto('/');

    const nav = page.getByRole('navigation', { name: '主导航' });
    await expect(nav).toBeVisible();

    // Check nav rail width is 72px
    const navBox = await nav.boundingBox();
    expect(navBox).not.toBeNull();
    expect(Math.round(navBox!.width)).toBe(72);

    // Brand name is hidden from display, but accessible label exists
    await expect(page.locator('.nav-brand-name')).toBeHidden();

    // All nav items retain accessible names
    for (const name of ['今日概览', '项目', '发现与建议', '设置']) {
      const link = nav.getByRole('link', { name });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute('aria-label', name);
    }

    // Secondary navigation retains accessible name
    const moreSummary = nav.locator('.nav-secondary summary');
    await expect(moreSummary).toHaveAttribute('aria-label', '更多入口');

    // No horizontal scroll
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.screenshot({ path: 'handoff/EVIDENCE/ui-01-layout-1024.png', fullPage: true });
  });

  test('navigation is 200px at 1440px and 1920px, and content is centered with max 1200px', async ({ page }) => {
    for (const width of [1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/projects');

      const nav = page.getByRole('navigation', { name: '主导航' });
      const navBox = await nav.boundingBox();
      expect(navBox).not.toBeNull();
      expect(Math.round(navBox!.width)).toBe(200);

      await expect(page.locator('.nav-brand-name')).toBeVisible();
      await expect(nav.getByRole('link', { name: '项目' })).toBeVisible();

      const main = page.locator('.app-content');
      const mainBox = await main.boundingBox();
      expect(mainBox).not.toBeNull();
      expect(mainBox!.width).toBeLessThanOrEqual(1200);

      // Centered: left and right margins should be balanced
      if (width === 1920) {
        const bodyBox = await page.locator('.app-body').boundingBox();
        expect(bodyBox).not.toBeNull();
        const leftMargin = mainBox!.x - bodyBox!.x;
        const rightMargin = bodyBox!.x + bodyBox!.width - (mainBox!.x + mainBox!.width);
        expect(Math.abs(leftMargin - rightMargin)).toBeLessThanOrEqual(4);
      }

      // No horizontal scroll
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: 'handoff/EVIDENCE/ui-01-layout-1440.png', fullPage: true });

    await page.setViewportSize({ width: 1920, height: 900 });
    await page.screenshot({ path: 'handoff/EVIDENCE/ui-01-layout-1920.png', fullPage: true });
  });

  test('detail drawer renders on-demand, adapts across breakpoints, and restores focus on close/Esc', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/projects');

    // Drawer is unmounted when empty
    await expect(page.getByRole('complementary', { name: '详情面板' })).toHaveCount(0);
    await expect(page.locator('.detail-drawer-backdrop')).toHaveCount(0);

    const helpBtn = page.getByRole('button', { name: '查看工作区说明与详情' });
    await expect(helpBtn).toBeVisible();

    // 1. Open drawer at 1440px -> overlay mode with backdrop
    await helpBtn.focus();
    await helpBtn.click();

    const drawer = page.getByRole('complementary', { name: '详情面板' });
    await expect(drawer).toBeVisible();
    await expect(page.locator('.detail-drawer-backdrop')).toBeVisible();

    const closeBtn = drawer.getByRole('button', { name: '关闭详情面板' });
    await expect(closeBtn).toBeVisible();
    await expect(closeBtn).toBeFocused();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'handoff/EVIDENCE/ui-01-layout-1440-overlay.png' });

    // 2. Press Esc -> closes drawer and restores focus to trigger button
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(page.locator('.detail-drawer-backdrop')).toHaveCount(0);
    await expect(helpBtn).toBeFocused();

    // 3. Open drawer again, close via Close button -> restores focus
    await helpBtn.click();
    await expect(drawer).toBeVisible();
    await closeBtn.click();
    await expect(drawer).toHaveCount(0);
    await expect(helpBtn).toBeFocused();

    // 4. Open drawer again, close via backdrop click -> restores focus
    await helpBtn.click();
    await expect(drawer).toBeVisible();
    await page.locator('.detail-drawer-backdrop').click({ position: { x: 50, y: 50 } });
    await expect(drawer).toHaveCount(0);
    await expect(helpBtn).toBeFocused();

    // 5. Breakpoint ≥1600px (1920px) -> in-flow 360px drawer, no backdrop visible
    await page.setViewportSize({ width: 1920, height: 900 });
    await helpBtn.click();
    await expect(drawer).toBeVisible();
    await expect(page.locator('.detail-drawer-backdrop')).toBeHidden();

    const drawerBox = await drawer.boundingBox();
    expect(drawerBox).not.toBeNull();
    expect(Math.round(drawerBox!.width)).toBe(360);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'handoff/EVIDENCE/ui-01-layout-1920-drawer.png' });

    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);

    // 6. Breakpoint <768px (600px mobile) -> modal panel
    await page.setViewportSize({ width: 600, height: 800 });
    await helpBtn.click();
    await expect(drawer).toBeVisible();
    await expect(page.locator('.detail-drawer-backdrop')).toBeVisible();

    const mobileDrawerBox = await drawer.boundingBox();
    expect(mobileDrawerBox).not.toBeNull();
    // Modal panel spans full width
    expect(Math.round(mobileDrawerBox!.width)).toBe(600);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: 'handoff/EVIDENCE/ui-01-layout-600-modal.png' });

    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(helpBtn).toBeFocused();
  });
});
