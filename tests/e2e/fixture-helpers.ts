import { expect, type Page, type Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../packages/hearth-contract/fixtures');

export type HearthFixtureName = 'ok' | 'empty' | 'error' | 'permission-denied' | 'stale';

function httpStatusFor(body: { status?: string }): number {
  if (body.status === 'permission_denied') return 403;
  if (body.status === 'error') return 503;
  return 200;
}

export function readHearthFixture(name: HearthFixtureName): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8')) as Record<string, unknown>;
}

/** Route-mock GET /api/v1/hearth with a contract fixture body (I1: no FIXTURE_MODE). */
export async function mockHearth(page: Page, name: HearthFixtureName | Record<string, unknown>): Promise<void> {
  const body = typeof name === 'string' ? readHearthFixture(name) : name;
  const status = httpStatusFor(body as { status?: string });
  await page.route('**/api/v1/hearth', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

export async function dismissWelcome(page: Page): Promise<void> {
  const skip = page.getByRole('button', { name: /跳过欢迎/ });
  try {
    await skip.waitFor({ state: 'visible', timeout: 5_000 });
    await skip.click();
  } catch {
    /* welcome already dismissed */
  }
}

/**
 * Open the shell with a mocked hearth ViewModel.
 * Health / threads hit the real e2e server; hearth is intercepted.
 */
export async function openHearth(page: Page, fixture: HearthFixtureName): Promise<{ apiPaths: string[] }> {
  const apiPaths: string[] = [];
  page.on('request', (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith('/api/')) apiPaths.push(`${request.method()} ${pathname}`);
  });
  await mockHearth(page, fixture);
  await page.goto('/');
  await dismissWelcome(page);
  await expect(page.locator('.ember-seed')).toBeVisible({ timeout: 15_000 });
  return { apiPaths };
}

/** @deprecated name kept for older specs — now uses route mocks, not ?fixture=. */
export async function openFixture(page: Page, fixture: HearthFixtureName): Promise<{ apiRequests: string[] }> {
  const { apiPaths } = await openHearth(page, fixture);
  return { apiRequests: apiPaths };
}
