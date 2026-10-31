import { deriveFlame } from './flame.js';
/**
 * @fileoverview M1 只读观察视图（纯函数）。
 * 输入只有观察者读数 + 授权；不触达研究、模型、卡片或任何写入。
 * real 模式下任何失败都返回 status:'error'，不回退到 Mock / fixture。
 */
import type { HearthViewModel, Permissions, Scope, StoryBeat } from '@hearth/hearth-contract';
import type { ObserverHealth, ProjectSummary } from '@hearth/project-observer';

/** 视图所需的最小只读端口（ProjectObserver 的子集，仅读方法） */
export interface ObserveReadPort {
  listProjects(): ProjectSummary[];
  getObserverHealth(projectId: string): ObserverHealth;
}

export type ObserveScopeQuery = { kind: 'global' } | { kind: 'project'; projectId: string };

export interface ObserveInput {
  permissions: { observe: boolean; research: boolean; model: boolean };
  scope: ObserveScopeQuery;
  port: ObserveReadPort | undefined;
  now: Date;
  staleMs: number;
}

export interface ObserveResult {
  httpStatus: number;
  view: HearthViewModel;
}

const NO_JUDGEMENT = '暂无法判断';

function viewBase(perms: Permissions, scope: Scope) {
  return { mode: 'real' as const, scope, featuredOpinion: null, permissions: perms };
}

function failure(perms: Permissions, scope: Scope, httpStatus: number, code: string, message: string): ObserveResult {
  return {
    httpStatus,
    view: {
      ...viewBase(perms, scope),
      status: 'error',
      error: { code, message },
      narrative: { flame: { level: 'neutral', reason: NO_JUDGEMENT, milestoneGold: false }, story: [] },
      observationFreshness: 'unavailable',
    },
  };
}

function birthBeat(p: ProjectSummary): StoryBeat {
  const where = [p.shortSha, p.branch].filter((x): x is string => x !== null).join(' ') || p.name;
  return {
    kind: '诞生',
    at: p.createdAt,
    summary: `开始观察 ${p.name}。`,
    evidence: [{ id: `obs_${p.id}`, kind: 'observer', label: where }],
  };
}

function isStale(p: ProjectSummary, health: ObserverHealth, now: Date, staleMs: number): boolean {
  if (health.collectionStatus !== 'OK') return true;
  const last = health.lastObservedAt ?? p.lastObservedAt;
  if (last === null) return true;
  return now.getTime() - Date.parse(last) > staleMs;
}

export function buildObserveView(input: ObserveInput): ObserveResult {
  const perms: Permissions = { ...input.permissions, execute: false };
  const globalScope: Scope = { kind: 'global' };

  if (!perms.observe) {
    return {
      httpStatus: 403,
      view: {
        // 未授权时不回显请求里的 scope。
        ...viewBase(perms, globalScope),
        status: 'permission_denied',
        narrative: { flame: { level: 'neutral', reason: '未授权观察，无法判断火势。', milestoneGold: false }, story: [] },
        observationFreshness: 'disabled',
      },
    };
  }

  const fallbackScope: Scope =
    input.scope.kind === 'global' ? globalScope : { kind: 'project', projectId: input.scope.projectId, title: input.scope.projectId };
  if (input.port === undefined) return failure(perms, fallbackScope, 503, 'observer_unavailable', '观察服务未配置');

  try {
    const all = input.port.listProjects().filter((p) => p.enabled);
    let projects: ProjectSummary[];
    let scope: Scope;
    if (input.scope.kind === 'project') {
      const { projectId } = input.scope;
      const found = all.find((p) => p.id === projectId);
      if (found === undefined) return failure(perms, globalScope, 404, 'project_not_found', '项目不存在或未启用观察');
      projects = [found];
      scope = { kind: 'project', projectId: found.id, title: found.name };
    } else {
      projects = all;
      scope = globalScope;
    }

    if (projects.length === 0) {
      return {
        httpStatus: 200,
        view: {
          ...viewBase(perms, scope),
          status: 'empty',
          narrative: { flame: { level: 'neutral', reason: '还没有登记要观察的项目。', milestoneGold: false }, story: [] },
          observationFreshness: 'unknown',
        },
      };
    }

    const staleNames = projects.filter((p) => isStale(p, input.port!.getObserverHealth(p.id), input.now, input.staleMs)).map((p) => p.name);
    const stale = staleNames.length > 0;
    const story = projects.map(birthBeat).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    return {
      httpStatus: 200,
      view: {
        ...viewBase(perms, scope),
        status: 'ok',
        narrative: {
          flame: (() => {
            const f = deriveFlame(story, input.now);
            return stale ? { ...f, reason: `观察已过期：${staleNames.join('、')}，暂按旧数据显示。` } : f;
          })(),
          story,
        },
        observationFreshness: stale ? 'stale' : 'fresh',
      },
    };
  } catch {
    return failure(perms, fallbackScope, 503, 'observer_unavailable', '读取观察数据失败');
  }
}
