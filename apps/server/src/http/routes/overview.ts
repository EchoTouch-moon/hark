/**
 * @fileoverview 工作台今日概览（Overview）聚合路由
 * 
 * 只读 GET /api/v1/overview?projectId=…
 * 聚合项目摘要、优先最多 3 条 Insight、状态计数与最近 10 条真实观察事件。
 * 有界查询、分区可用状态；零模型调用。
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  OverviewResponseSchema,
  type OverviewHeadlineStatus,
  type OverviewInsightItem,
  type OverviewObservationItem,
  type OverviewResponse,
  type ProjectOverviewItem,
  type SectionAvailability,
  type TestStatusIndicator,
} from '@hearth/contracts';
import { listInsights, summarizeInsights } from '@hearth/project-insight';
import type { AppDeps } from '../app.js';

const OverviewQuerySchema = z
  .object({
    projectId: z.string().min(1).max(128).optional(),
  })
  .strict();

const SEVERITY_WEIGHT: Record<string, number> = {
  important: 3,
  attention: 2,
  info: 1,
};

function formatEventSummary(type: string, payload: Record<string, unknown> | null | undefined): string {
  if (!payload) return type;
  switch (type) {
    case 'REPOSITORY_HEAD_CHANGED': {
      const toOid = typeof payload['toOid'] === 'string' ? payload['toOid'].slice(0, 7) : 'HEAD';
      return `Git HEAD 提交变更为 ${toOid}`;
    }
    case 'REPOSITORY_BRANCH_CHANGED': {
      const branch = typeof payload['toBranch'] === 'string' ? payload['toBranch'] : '未知';
      return `Git 分支切换至 ${branch}`;
    }
    case 'WORKTREE_STATE_CHANGED': {
      const staged = typeof payload['stagedCount'] === 'number' ? payload['stagedCount'] : 0;
      const unstaged = typeof payload['unstagedCount'] === 'number' ? payload['unstagedCount'] : 0;
      const untracked = typeof payload['untrackedCount'] === 'number' ? payload['untrackedCount'] : 0;
      return `工作区变更：${staged} 暂存，${unstaged} 未暂存，${untracked} 未跟踪`;
    }
    case 'TEST_REPORT_UPDATED': {
      const result = typeof payload['result'] === 'string' ? payload['result'] : 'UNKNOWN';
      const tests = typeof payload['tests'] === 'number' ? payload['tests'] : null;
      const failed = typeof payload['failed'] === 'number' ? payload['failed'] : null;
      if (result === 'PASS') return tests !== null ? `测试全部通过（${tests} 项）` : '测试全部通过';
      if (result === 'FAIL') return failed !== null ? `测试未通过（${failed} 项失败）` : '测试未通过';
      return '测试报告已更新（状态未确定）';
    }
    case 'PROJECT_REGISTERED':
      return '项目已注册至只读观察';
    case 'REPOSITORY_UNAVAILABLE':
      return '项目仓库路径暂时不可访问';
    case 'REPOSITORY_RECOVERED':
      return '项目仓库路径访问已恢复';
    case 'OBSERVATION_GAP':
      return '检测到观察断层并完成状态对账';
    case 'ADAPTER_ERROR':
      return '适配器执行报告或工具异常';
    default:
      return type;
  }
}

export function registerOverviewRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/overview', async (req, reply) => {
    const q = OverviewQuerySchema.parse(req.query);
    const collectedAt = new Date().toISOString();

    let projectsAvailability: SectionAvailability = 'AVAILABLE';
    let projectsError: string | null = null;
    let projectsList: ProjectOverviewItem[] = [];
    const projectNames: Record<string, string> = {};

    // 1. 采集项目区块
    try {
      if (deps.observer === undefined) {
        projectsAvailability = 'UNAVAILABLE';
        projectsError = 'observer is not configured';
      } else {
        const allSummaries = deps.observer.listProjects();
        for (const s of allSummaries) {
          projectNames[s.id] = s.name;
        }
        for (const p of allSummaries) {
          let testStatus: TestStatusIndicator = 'UNKNOWN';
          const reports = deps.observer.listReportSources(p.id);
          if (reports.length === 0) {
            testStatus = 'NOT_CONFIGURED';
          } else if (p.test?.stale === true) {
            testStatus = 'STALE';
          } else if (p.test?.result === 'FAIL' || p.test?.result === 'MIXED') {
            testStatus = 'FAILED';
          } else if (p.test?.result === 'PASS') {
            testStatus = 'PASSED';
          } else {
            testStatus = 'UNKNOWN';
          }

          projectsList.push({
            id: p.id,
            name: p.name,
            localPath: p.canonicalPath,
            enabled: p.enabled,
            lastObservedAt: (p.lastObservedAt ?? p.lastSuccessAt) ?? null,
            openInsightCount: 0, // 稍后在 Insight 步骤回填
            testStatus,
            branch: p.branch ?? null,
            headOid: p.headSha ?? null,
          });
        }
      }
    } catch (cause) {
      projectsAvailability = 'DEGRADED';
      projectsError = cause instanceof Error ? cause.message : String(cause);
    }

    // 2. 采集洞察区块
    let insightsAvailability: SectionAvailability = 'AVAILABLE';
    let insightsError: string | null = null;
    let prioritizedInsights: OverviewInsightItem[] = [];
    let totalOpenCount = 0;
    let engineHealth: 'NOT_EVALUATED' | 'OK' | 'DEGRADED' = 'NOT_EVALUATED';

    try {
      if (deps.insight === undefined) {
        insightsAvailability = 'UNAVAILABLE';
        insightsError = 'insight store is not configured';
      } else {
        const summary = summarizeInsights(deps.insight);
        engineHealth = summary.engineHealth;
        // 回填项目未解决洞察计数
        for (const p of projectsList) {
          const match = summary.projects.find((item) => item.projectId === p.id);
          p.openInsightCount = match ? match.openCount : 0;
        }

        if (q.projectId) {
          const match = summary.projects.find((item) => item.projectId === q.projectId);
          totalOpenCount = match ? match.openCount : 0;
        } else {
          totalOpenCount = summary.openCount;
        }

        const { items } = listInsights(deps.insight, {
          projectId: q.projectId,
          statuses: ['OPEN', 'ACKNOWLEDGED'],
          limit: 50,
        });

        // 严重程度优先，观察时间最新优先，ID 升序决胜
        const sorted = [...items].sort((a, b) => {
          const wa = SEVERITY_WEIGHT[a.severity] ?? 0;
          const wb = SEVERITY_WEIGHT[b.severity] ?? 0;
          if (wa !== wb) return wb - wa;
          const timeA = new Date(a.observedAt).getTime();
          const timeB = new Date(b.observedAt).getTime();
          if (timeA !== timeB) return timeB - timeA;
          return a.id.localeCompare(b.id);
        });

        prioritizedInsights = sorted.slice(0, 3).map((item) => ({
          id: item.id,
          projectId: item.projectId,
          projectName: projectNames[item.projectId] ?? item.projectId.slice(0, 8),
          title: item.title,
          summary: item.summary,
          severity: item.severity,
          status: item.status,
          observedAt: item.observedAt,
          primaryRuleId: item.primaryRuleId,
          evidenceCount: item.evidenceCount,
          historical: item.historical,
        }));
      }
    } catch (cause) {
      insightsAvailability = 'DEGRADED';
      insightsError = cause instanceof Error ? cause.message : String(cause);
    }

    // 3. 采集最新观察记录（有界 10 条）
    let observationsAvailability: SectionAvailability = 'AVAILABLE';
    let observationsError: string | null = null;
    let recentObservations: OverviewObservationItem[] = [];

    try {
      if (deps.observer === undefined) {
        observationsAvailability = 'UNAVAILABLE';
        observationsError = 'observer is not configured';
      } else {
        const events = deps.observer.listRecentEvents(10, q.projectId);
        recentObservations = events.map((event) => ({
          id: event.eventId,
          projectId: event.projectId,
          projectName: projectNames[event.projectId] ?? event.projectId.slice(0, 8),
          type: event.type,
          timestamp: event.observedAt,
          source: event.evidence?.source ?? 'system',
          quality: event.evidence?.quality ?? 'OBSERVED',
          payloadSummary: formatEventSummary(event.type, event.payload as Record<string, unknown> | undefined),
        }));
      }
    } catch (cause) {
      observationsAvailability = 'DEGRADED';
      observationsError = cause instanceof Error ? cause.message : String(cause);
    }

    // 4. 确定性模板概览摘要生成
    const totalProjects = projectsList.length;
    const enabledProjects = projectsList.filter((p) => p.enabled).length;
    const importantInsights = prioritizedInsights.filter((i) => i.severity === 'important').length;
    const todayObservationsCount = recentObservations.length;

    let headlineStatus: OverviewHeadlineStatus;
    let headline: string;
    let detail: string;

    if (
      projectsAvailability === 'DEGRADED' ||
      insightsAvailability === 'DEGRADED' ||
      observationsAvailability === 'DEGRADED' ||
      engineHealth === 'DEGRADED'
    ) {
      headlineStatus = 'DEGRADED';
      headline = '数据来源部分降级';
      detail = '部分来源状态不可用或读取失败，已保留成功获取的事实区块。';
    } else if (totalProjects === 0) {
      headlineStatus = 'NO_PROJECTS';
      headline = '未登记项目';
      detail = '当前尚未登记本地项目，登记后将只读监听 Git 变化与测试报告。';
    } else if (enabledProjects === 0) {
      headlineStatus = 'PAUSED';
      headline = '项目观察已暂停';
      detail = '已登记项目的观察均处于暂停状态，未在后台监听变更。';
    } else if (totalOpenCount > 0) {
      headlineStatus = 'ATTENTION_NEEDED';
      headline = `有 ${totalOpenCount} 条需要关注的发现`;
      detail =
        importantInsights > 0
          ? `其中 ${importantInsights} 项为重要级别，已按严重程度置顶。`
          : '已按严重程度与观察时间稳定排序。';
    } else if (engineHealth === 'NOT_EVALUATED') {
      headlineStatus = 'NO_SIGNALS';
      headline = '尚无可评估信号';
      detail = '已登记项目尚未捕获到足够的 Git 或测试事件。';
    } else {
      headlineStatus = 'ALL_CLEAR';
      headline = '已完成评估，暂无待关注发现';
      detail = '当前没有未处理的待关注洞察，项目运行平稳。';
    }

    const todayDate = collectedAt.slice(0, 10);

    const response: OverviewResponse = {
      collectedAt,
      sectionsAvailability: {
        projects: projectsAvailability,
        insights: insightsAvailability,
        observations: observationsAvailability,
      },
      sectionErrors: {
        projects: projectsError,
        insights: insightsError,
        observations: observationsError,
      },
      summary: {
        date: todayDate,
        status: headlineStatus,
        headline,
        detail,
        counts: {
          totalProjects,
          enabledProjects,
          openInsights: totalOpenCount,
          importantInsights,
          todayObservationsCount,
        },
      },
      prioritizedInsights: {
        items: prioritizedInsights,
        totalOpenCount,
        hasMore: totalOpenCount > prioritizedInsights.length,
      },
      projects: projectsList,
      recentObservations: {
        events: recentObservations,
        totalCount: recentObservations.length,
      },
    };

    return reply.send(OverviewResponseSchema.parse(response));
  });
}
