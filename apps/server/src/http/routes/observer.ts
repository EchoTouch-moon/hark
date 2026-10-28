import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isObserverError, redactText, type EventType } from '@hearth/project-observer';
import type { AppDeps } from '../app.js';

const RegisterBody = z
  .object({
    localPath: z.string().min(1).max(4096),
    name: z.string().min(1).max(200).optional(),
    confirm: z.literal(true),
    reports: z
      .array(z.object({ format: z.literal('junit-xml'), relativePath: z.string().min(1).max(1024) }).strict())
      .max(16)
      .optional(),
  })
  .strict();

const EnabledBody = z.object({ enabled: z.boolean() }).strict();
const ReportBody = z.object({ format: z.literal('junit-xml'), relativePath: z.string().min(1).max(1024) }).strict();
const EVENT_TYPES = [
  'PROJECT_REGISTERED',
  'REPOSITORY_HEAD_CHANGED',
  'REPOSITORY_BRANCH_CHANGED',
  'WORKTREE_STATE_CHANGED',
  'TEST_REPORT_UPDATED',
  'REPOSITORY_UNAVAILABLE',
  'REPOSITORY_RECOVERED',
  'OBSERVATION_GAP',
  'ADAPTER_ERROR',
] as const;

function sendObserverError(reply: { status: (code: number) => { send: (body: unknown) => unknown } }, cause: unknown) {
  if (isObserverError(cause)) {
    const status =
      cause.code === 'PROJECT_NOT_FOUND'
        ? 404
        : cause.code === 'DUPLICATE_PATH'
          ? 409
          : 400;
    const httpStatus = cause.code === 'WRITER_LOCKED' ? 503 : status;
    return reply.status(httpStatus).send({ error: { code: cause.code, message: redactText(cause.message) } });
  }
  throw cause;
}

function requireObserver(deps: AppDeps) {
  if (deps.observer === undefined) {
    const error = new Error('observer is not configured');
    (error as { statusCode?: number }).statusCode = 503;
    throw error;
  }
  return deps.observer;
}

export function registerObserverRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/observer/projects', async (_req, reply) => {
    const observer = requireObserver(deps);
    return reply.send({ projects: observer.listProjects() });
  });

  app.post('/api/v1/observer/projects', async (req, reply) => {
    const observer = requireObserver(deps);
    try {
      const body = RegisterBody.parse(req.body);
      const project = await observer.registerProject(body.localPath, {
        name: body.name,
        reports: body.reports,
      });
      return reply.status(201).send({
        project,
        snapshot: observer.getLatestSnapshot(project.id),
        health: observer.getObserverHealth(project.id),
      });
    } catch (cause) {
      return sendObserverError(reply, cause);
    }
  });

  app.get('/api/v1/observer/projects/:id', async (req, reply) => {
    const observer = requireObserver(deps);
    const { id } = req.params as { id: string };
    try {
      return reply.send({
        project: observer.getProject(id),
        snapshot: observer.getLatestSnapshot(id),
        health: observer.getObserverHealth(id),
        reports: observer.listReportSources(id),
      });
    } catch (cause) {
      return sendObserverError(reply, cause);
    }
  });

  app.get('/api/v1/observer/projects/:id/snapshot', async (req, reply) => {
    const observer = requireObserver(deps);
    const { id } = req.params as { id: string };
    try {
      return reply.send({ snapshot: observer.getLatestSnapshot(id) });
    } catch (cause) {
      return sendObserverError(reply, cause);
    }
  });

  app.get('/api/v1/observer/projects/:id/events', async (req, reply) => {
    const observer = requireObserver(deps);
    const { id } = req.params as { id: string };
    const q = req.query as { cursor?: string; limit?: string; types?: string };
    const types = (q.types ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item): item is EventType => (EVENT_TYPES as readonly string[]).includes(item));
    const parsedLimit = q.limit === undefined ? undefined : Number.parseInt(q.limit, 10);
    const limit = parsedLimit === undefined || Number.isNaN(parsedLimit) ? undefined : parsedLimit;
    try {
      return reply.send(
        observer.listEvents(id, {
          cursor: q.cursor,
          limit,
          types: types.length > 0 ? types : undefined,
        }),
      );
    } catch (cause) {
      return sendObserverError(reply, cause);
    }
  });

  app.get('/api/v1/observer/projects/:id/health', async (req, reply) => {
    const observer = requireObserver(deps);
    const { id } = req.params as { id: string };
    try {
      return reply.send({ health: observer.getObserverHealth(id) });
    } catch (cause) {
      return sendObserverError(reply, cause);
    }
  });

  app.post('/api/v1/observer/projects/:id/scan', async (req, reply) => {
    const observer = requireObserver(deps);
    const { id } = req.params as { id: string };
    try {
      const run = await observer.scanProject(id, 'manual');
      return reply.send({
        run,
        snapshot: observer.getLatestSnapshot(id),
        health: observer.getObserverHealth(id),
      });
    } catch (cause) {
      return sendObserverError(reply, cause);
    }
  });

  app.post('/api/v1/observer/projects/:id/enabled', async (req, reply) => {
    const observer = requireObserver(deps);
    const { id } = req.params as { id: string };
    try {
      const body = EnabledBody.parse(req.body);
      await observer.setProjectEnabled(id, body.enabled);
      return reply.send({ project: observer.getProject(id), health: observer.getObserverHealth(id) });
    } catch (cause) {
      return sendObserverError(reply, cause);
    }
  });

  app.post('/api/v1/observer/projects/:id/reports', async (req, reply) => {
    const observer = requireObserver(deps);
    const { id } = req.params as { id: string };
    try {
      const body = ReportBody.parse(req.body);
      const source = observer.addReportSource(id, body.relativePath, body.format);
      await observer.scanProject(id, 'manual');
      return reply.status(201).send({ report: source, snapshot: observer.getLatestSnapshot(id) });
    } catch (cause) {
      return sendObserverError(reply, cause);
    }
  });

  app.delete('/api/v1/observer/projects/:id', async (req, reply) => {
    const observer = requireObserver(deps);
    const { id } = req.params as { id: string };
    try {
      await observer.removeProject(id);
      return reply.status(204).send();
    } catch (cause) {
      return sendObserverError(reply, cause);
    }
  });
}
