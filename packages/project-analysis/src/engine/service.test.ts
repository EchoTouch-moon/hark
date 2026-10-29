import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectObserver } from '@hearth/project-observer';
import { createGitRepo } from '../../../project-observer/src/testkit/git-fixture.js';
import { AnalysisService } from './service.js';
import { MockAnalysisProvider } from '../providers/mock.js';
import { AnalysisStore } from '../store/store.js';
import { AnalysisError } from '../errors.js';
import { bindRecommendation } from './bind.js';
import type { ProjectContext, Recommendation } from '../contracts.js';

let dir: string;
let observer: ProjectObserver;
let store: AnalysisStore;
let service: AnalysisService;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'hearth-p2a-svc-'));
  observer = new ProjectObserver({ dbPath: path.join(dir, 'observer.sqlite'), watchEnabled: false });
  store = new AnalysisStore(path.join(dir, 'analysis.sqlite'));
  service = new AnalysisService({ observer, store, provider: new MockAnalysisProvider() });
});

afterEach(async () => {
  service.close();
  observer.close();
  await rm(dir, { recursive: true, force: true });
});

describe('analysis service', () => {
  it('creates a recommendation card from mock provider without claiming tests passed', async () => {
    const repo = await createGitRepo(dir, 'app', { commit: true, files: { 'README.md': '# App\n' } });
    const project = await observer.registerProject(repo, { name: 'app' });
    const run = await service.start({ projectId: project.id, trigger: 'observe' });
    expect(run.status).toBe('succeeded');
    expect(run.provider).toBe('mock');
    expect(run.recommendation?.statusSummary.includes('不能当作测试通过')).toBe(true);
    expect(run.recommendation?.findings[0]?.verified).toBe(true);
    expect(run.stale).toBe(false);
    expect(service.list(project.id)).toHaveLength(1);
  });

  it('rejects a second in-flight analysis for the same project', async () => {
    const repo = await createGitRepo(dir, 'app', { commit: true, files: { 'README.md': '# App\n' } });
    const project = await observer.registerProject(repo, { name: 'app' });
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: import('../providers/types.js').AnalysisProvider = {
      id: 'mock',
      model: 'slow',
      async analyze(input) {
        await blocked;
        return new MockAnalysisProvider().analyze(input);
      },
    };
    service.close();
    store = new AnalysisStore(path.join(dir, 'analysis2.sqlite'));
    service = new AnalysisService({ observer, store, provider: slow });
    const first = service.start({ projectId: project.id, trigger: 'observe' });
    for (let i = 0; i < 40 && store.runningCount(project.id) === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await expect(service.start({ projectId: project.id, trigger: 'observe' })).rejects.toBeInstanceOf(AnalysisError);
    release();
    await first;
  });

  it('can cancel an in-flight analysis', async () => {
    const repo = await createGitRepo(dir, 'app', { commit: true, files: { 'README.md': '# App\n' } });
    const project = await observer.registerProject(repo, { name: 'app' });
    let release: () => void = () => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: import('../providers/types.js').AnalysisProvider = {
      id: 'mock',
      model: 'slow',
      async analyze(input) {
        await Promise.race([blocked, new Promise((_, reject) => {
          input.signal?.addEventListener('abort', () => reject(new AnalysisError('CANCELLED', 'analysis cancelled')));
        })]);
        return new MockAnalysisProvider().analyze(input);
      },
    };
    service.close();
    store = new AnalysisStore(path.join(dir, 'analysis-cancel.sqlite'));
    service = new AnalysisService({ observer, store, provider: slow });
    const pending = service.start({ projectId: project.id, trigger: 'observe' });
    for (let i = 0; i < 40 && store.runningCount(project.id) === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const active = store.list(project.id).find(run => run.status === 'running');
    expect(service.cancel(active!.id)).toBe(true);
    const run = await pending;
    expect(run.status).toBe('cancelled');
    release();
  });

  it('marks fabricated evidence as unverified', () => {
    const context = {
      availableEvidence: [{ kind: 'file', id: 'README.md', label: 'README.md', verified: true }],
    } as ProjectContext;
    const rec = bindRecommendation(context, {
      target: 't',
      scope: 's',
      statusSummary: 'sum',
      findings: [
        {
          title: 'invented',
          detail: 'no source',
          evidenceRefs: [{ kind: 'file', id: '/etc/passwd', label: 'passwd', verified: true }],
          verified: true,
        },
      ],
      confidence: 'high',
      uncertainties: [],
      nextActions: [{ title: 'x', detail: 'y', requiresConfirmation: true }],
      risks: [],
    } satisfies Recommendation);
    expect(rec.findings[0]?.verified).toBe(false);
    expect(rec.findings[0]?.evidenceRefs[0]?.verified).toBe(false);
    expect(rec.confidence).toBe('medium');
  });
});
