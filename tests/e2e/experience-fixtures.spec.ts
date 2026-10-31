import { expect, test } from '@playwright/test';
import { dismissWelcome, mockHearth, openHearth, readHearthFixture } from './fixture-helpers';

for (const width of [1024, 1440, 1920]) {
  test(`mocked ok has no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openHearth(page, 'ok');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('timeline nodes render from the ok story; hollow uses inset ring', async ({ page }) => {
  await openHearth(page, 'ok');
  const beats = page.locator('.xp-story__beat');
  await expect(beats).toHaveCount(2);
  await expect(page.locator('.xp-story__mark')).toHaveCount(2);
  const marks = await page.locator('.xp-story__mark').evaluateAll((els) => els.map((e) => e.getAttribute('data-mark')));
  for (const m of marks) expect(['filled', 'hollow']).toContain(m);
  const hollow = page.locator('.xp-story__mark[data-mark="hollow"]').first();
  const beforeShadow = await hollow.evaluate((el) => getComputedStyle(el, '::before').boxShadow);
  expect(beforeShadow).toContain('rgb(168, 80, 28)');
  expect(beforeShadow.toLowerCase()).toMatch(/inset/);
  await expect(beats.nth(0)).toContainText('项目建立，写下第一版叙事。');
  await expect(beats.nth(1)).toContainText('G0 合同冻结，双轨开工。');
});

test('permission_denied: 重新扫描 disabled; 去授权 PUT+refetch; inline error+retry', async ({ page }) => {
  await openHearth(page, 'permission-denied');
  await expect(page.getByRole('button', { name: '重新扫描' })).toHaveAttribute('aria-disabled', 'true');
  const authorize = page.getByRole('button', { name: '去授权' });
  await expect(authorize).toBeVisible();

  // First PUT fails → inline §9 copy + retry (I-18)
  await page.route('**/api/v1/hearth/permissions', async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'origin_rejected', message: '仅接受本机同源请求' } }),
    });
  });
  await authorize.click();
  const inline = page.locator('.xp-auth-error');
  await expect(inline).toContainText('未授权读取');
  await expect(inline.getByRole('button', { name: '重试' })).toBeVisible();
  await expect(inline).toHaveAttribute('aria-describedby', 'xp-auth-error-detail');

  // Retry succeeds → PUT then GET refetch paints ok flame
  let putBody: unknown = null;
  await page.unroute('**/api/v1/hearth/permissions');
  await page.route('**/api/v1/hearth/permissions', async (route) => {
    if (route.request().method() !== 'PUT') {
      await route.fallback();
      return;
    }
    putBody = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ permissions: { observe: true, research: true, model: true, execute: false } }),
    });
  });
  await page.unroute('**/api/v1/hearth');
  await mockHearth(page, 'ok');
  await inline.getByRole('button', { name: '重试' }).click();
  await expect(page.locator('.hearth-flame-pill__label')).toHaveText('温火');
  expect(putBody).toEqual({ observe: true });
});

test('I-14 /observations redirects home (no ObservationsPage)', async ({ page }) => {
  await mockHearth(page, 'ok');
  await page.goto('/observations');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.observations-page')).toHaveCount(0);
});

test('I-19 milestoneGold paints data attr and gold edge; false clears it', async ({ page }) => {
  const gold = readHearthFixture('ok');
  await mockHearth(page, gold);
  await page.goto('/');
  await dismissWelcome(page);
  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-milestone-gold', 'true');
  const edge = await page.locator('.hearth-flame-pill__mark').evaluate((el) => getComputedStyle(el).boxShadow);
  expect(edge).toMatch(/rgba?\(232,\s*178,\s*74/);

  const plain = structuredClone(gold) as Record<string, unknown>;
  const narrative = plain.narrative as { flame: { milestoneGold: boolean } };
  narrative.flame.milestoneGold = false;
  await page.unroute('**/api/v1/hearth');
  await mockHearth(page, plain);
  await page.reload();
  await dismissWelcome(page);
  await expect(page.locator('.canvas-shell')).toHaveAttribute('data-milestone-gold', 'false');
});

test('I-9..I-12 reason caption clamps to 2 lines with title+aria-label', async ({ page }) => {
  const body = readHearthFixture('stale');
  const narrative = body.narrative as { flame: { reason: string } };
  narrative.flame.reason =
    '这是一段故意写得很长的火候说明，用来验证最多两行省略：观察已过期但仍保留上次判断，项目名 Hearth 与其它字段都不拆、不换色，整句维持十三像素与既定色值。';
  await mockHearth(page, body);
  await page.goto('/');
  await dismissWelcome(page);
  const reason = page.locator('.ember-seed__reason');
  await expect(reason).toBeVisible();
  await expect(reason).toHaveAttribute('title', narrative.flame.reason);
  await expect(reason).toHaveAttribute('aria-label', narrative.flame.reason);
  const style = await reason.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      fontSize: cs.fontSize,
      color: cs.color,
      webkitLineClamp: cs.webkitLineClamp || (cs as CSSStyleDeclaration & { lineClamp?: string }).lineClamp,
    };
  });
  expect(style.fontSize).toBe('13px');
  expect(style.color).toBe('rgb(90, 81, 75)');
  expect(String(style.webkitLineClamp)).toBe('2');
});
