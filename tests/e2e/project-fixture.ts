import { test as base, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const test = base.extend<{ projectFixture: { id: string; threadId: string; repo: string; title: string } }>({
  projectFixture: async ({ page, baseURL }, use) => {
    const repo = mkdtempSync(path.join(tmpdir(), 'hearth-project-first-'));
    const headers: Record<string, string> = {};
    let id: string | undefined;
    try {
      writeFileSync(path.join(repo, 'README.md'), '# Synthetic project\nA public synthetic fixture for UI tests.\n');
      execFileSync('git', ['-C', repo, 'init', '-q']);
      execFileSync('git', ['-C', repo, 'add', 'README.md']);
      execFileSync('git', ['-C', repo, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@invalid.test', 'commit', '-qm', 'synthetic baseline']);
      const session = await (await page.request.get('/api/v1/auth/session')).json();
      Object.assign(headers, { 'x-csrf-token': session.csrfToken, origin: baseURL! });
      const response = await page.request.post('/api/v1/observer/projects', { headers, data: { localPath: repo, name: '合成项目 · 炉边', confirm: true } });
      expect(response.status()).toBe(201);
      id = (await response.json()).project.id as string;
      const title = `合成项目讨论 ${id}`;
      const created = await page.request.post('/api/v1/threads', { headers, data: { title, projectId: id } });
      expect(created.status()).toBe(201);
      const threadId = (await created.json()).thread.id as string;
      await use({ id, threadId, repo, title });
    } finally {
      if (id) await page.request.delete(`/api/v1/observer/projects/${encodeURIComponent(id)}`, { headers });
      rmSync(repo, { recursive: true, force: true });
    }
  },
});
export { expect };
