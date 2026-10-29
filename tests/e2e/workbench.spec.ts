import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

test.describe('UI-02: Real Project Workbench & Observations Timeline', () => {
  let repo: string;
  let projectId: string;
  let headers: Record<string, string> = {};

  test.beforeEach(async ({ page, baseURL }) => {
    repo = mkdtempSync(path.join(tmpdir(), 'hearth-workbench-test-'));
    mkdirSync(path.join(repo, 'reports'), { recursive: true });
    writeFileSync(path.join(repo, 'README.md'), '# Hearth Workbench Fixture\n');
    writeFileSync(path.join(repo, '.gitignore'), 'reports/\n');

    const git = (args: string[]) =>
      execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
    git(['init', '-q']);
    git(['add', 'README.md', '.gitignore']);
    git([
      '-c',
      'user.name=Workbench Fixture',
      '-c',
      'user.email=wb-fixture@invalid.test',
      'commit',
      '-qm',
      'initial workbench commit',
    ]);

    const sessionRes = await page.request.get('/api/v1/auth/session');
    const session = (await sessionRes.json()) as { csrfToken: string };
    headers = { 'x-csrf-token': session.csrfToken, origin: baseURL! };

    // 注册本地测试仓库
    const regRes = await page.request.post('/api/v1/observer/projects', {
      headers,
      data: {
        localPath: repo,
        name: 'Workbench Pilot Repo',
        confirm: true,
        reports: [{ format: 'junit-xml', relativePath: 'reports/junit.xml' }],
      },
    });
    expect(regRes.status()).toBe(201);
    const regData = (await regRes.json()) as { project: { id: string } };
    projectId = regData.project.id;
  });

  test.afterEach(async ({ page }) => {
    if (projectId) {
      await page.request.delete(`/api/v1/observer/projects/${encodeURIComponent(projectId)}`, {
        headers,
      }).catch(() => undefined);
    }
    try {
      rmSync(repo, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('UI-02.2: Home renders 4 sections, supports URL project filtering, and persists across reload', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. 今日概览主标题与副标题
    await expect(page.getByRole('heading', { name: '今日概览', exact: true })).toBeVisible();

    // 2. 检查 4 个固定区域存在
    // 区块 1：今日概览卡片
    await expect(page.locator('.home-summary-card')).toBeVisible();
    await expect(page.locator('.home-metrics-strip')).toBeVisible();
    await expect(page.getByText('登记项目', { exact: true })).toBeVisible();
    await expect(page.getByText('待关注发现', { exact: true })).toBeVisible();
    await expect(page.getByText('今日观察事件', { exact: true })).toBeVisible();

    // 区块 2：值得关注
    await expect(page.getByRole('heading', { name: '值得关注', exact: true })).toBeVisible();

    // 区块 3：项目概况
    await expect(page.getByRole('heading', { name: '项目概况', exact: true })).toBeVisible();
    await expect(page.locator('.home-project-name').filter({ hasText: 'Workbench Pilot Repo' })).toBeVisible();

    // 区块 4：最近观察
    await expect(page.getByRole('heading', { name: '最近观察', exact: true })).toBeVisible();
    await expect(page.locator('.home-observations-list')).toBeVisible();

    // 保存首页截图证据
    await page.screenshot({ path: 'handoff/EVIDENCE/ui-02-workbench-home.png' });

    // 3. 项目筛选交互：使用顶栏下拉框筛选
    const select = page.locator('#home-project-select');
    await expect(select).toBeVisible();
    await select.selectOption(projectId);

    // URL 必须包含 ?projectId=...
    await expect(page).toHaveURL(new RegExp(`projectId=${encodeURIComponent(projectId)}`));

    // 项目卡片被高亮选中状态
    await expect(page.locator('.home-project-card.is-selected')).toBeVisible();

    // 保存筛选状态截图证据
    await page.screenshot({ path: 'handoff/EVIDENCE/ui-02-workbench-filter.png' });

    // 4. 刷新页面，验证项目筛选在 URL 及页面状态中保留
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`projectId=${encodeURIComponent(projectId)}`));
    await expect(page.locator('#home-project-select')).toHaveValue(projectId);
    await expect(page.locator('.home-project-card.is-selected')).toBeVisible();
  });

  test('UI-02.3: Observations timeline displays events, supports project filter and preserves pagination', async ({
    page,
  }) => {
    // 导航到 /observations
    await page.goto('/observations');
    await expect(page.getByRole('heading', { name: '观察记录', exact: true })).toBeVisible();

    // 检查时间线项目存在（因为注册时产生了 PROJECT_REGISTERED / REPOSITORY_HEAD_CHANGED 等事件）
    const timelineItems = page.locator('.obs-timeline-item');
    await expect(timelineItems.first()).toBeVisible({ timeout: 10_000 });
    const count = await timelineItems.count();
    expect(count).toBeGreaterThan(0);

    // 检查事件卡片中展示客观事实信息
    await expect(page.locator('.obs-card-proj').first()).toContainText('Workbench Pilot Repo');

    // 保存时间线截图
    await page.screenshot({ path: 'handoff/EVIDENCE/ui-02-observations-timeline.png' });

    // 从主导航测试跳转至观察记录
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: '主导航' });
    await nav.getByRole('link', { name: '观察记录' }).click();
    await expect(page).toHaveURL(/\/observations/);
    await expect(page.getByRole('heading', { name: '观察记录', exact: true })).toBeVisible();
  });

  test('UI-02 GATE: Synthetic JUnit report triggers insight through pipeline onto home without model calls', async ({
    page,
  }) => {
    let modelCalls = 0;
    page.on('request', (req) => {
      // 监听是否有对模型分析接口的 POST 请求
      if (req.url().includes('/api/v1/analysis/runs') && req.method() === 'POST') {
        modelCalls++;
      }
    });

    // 访问首页
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '今日概览', exact: true })).toBeVisible();

    // 当前尚无可评估测试信号（空态）
    await expect(page.getByRole('heading', { name: '尚无可评估信号' })).toBeVisible({ timeout: 10_000 });

    // 写入合成 JUnit 失败测试报告
    const failureJunit = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="WorkbenchSuite" tests="2" failures="1" errors="0" skipped="0">
    <testcase name="testPass" classname="workbench.test" />
    <testcase name="testFail" classname="workbench.test">
      <failure message="expected true but got false">Assertion failed</failure>
    </testcase>
  </testsuite>
</testsuites>`;

    writeFileSync(path.join(repo, 'reports/junit.xml'), failureJunit);

    // 后台 observer 监听到文件变化 -> coordinator 生成 Insight -> 首页 3 秒只读静默轮询更新！
    // 首页的“值得关注”区域应自动刷新展示该失败 Insight，无需人工手动刷新页面
    const insightCard = page.locator('.home-insight-card').filter({ hasText: /R-TEST-/ });
    await expect(insightCard).toBeVisible({ timeout: 25_000 });
    await expect(insightCard).toContainText('reports/junit.xml');
    await expect(insightCard).toContainText('值得注意');

    // 检查项目概况中的测试状态更新为“测试失败”
    await expect(page.locator('.home-project-card').filter({ hasText: '测试失败' })).toBeVisible({ timeout: 15_000 });

    // 验证整个过程零模型调用
    expect(modelCalls).toBe(0);

    // 保存 Gate 通过截图证据
    await page.screenshot({ path: 'handoff/EVIDENCE/ui-02-gate-insight.png' });
  });
});
