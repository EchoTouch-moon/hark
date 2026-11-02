import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { projectEventForResponse } from '../event-projection.js';

function projectSnapshot(deps: AppDeps, projectId: string) {
  return {
    project: deps.storage.listProjects().find((p) => p.id === projectId) ?? null,
    events: deps.storage.listEvents({ projectId, limit: 30 }).map(projectEventForResponse),
    cards: deps.storage.listCards({ projectId, limit: 50 }),
    runs: deps.storage.listRuns({ projectId, limit: 50 }),
  };
}

export function registerProjectRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/api/v1/projects', async (_req, reply) => {
    return reply.send({ projects: deps.storage.listProjects() });
  });

  app.get('/api/v1/projects/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!deps.storage.projectExists(id)) {
      return reply.status(404).send({ error: { code: 'PROJECT_NOT_FOUND', message: `project ${id} not found` } });
    }
    return reply.send(projectSnapshot(deps, id));
  });

  app.get('/api/v1/events', async (req, reply) => {
    const q = req.query as { projectId?: string; limit?: string };
    const limit = Math.min(Number(q.limit ?? 30) || 30, 100);
    const events = deps.storage
      .listEvents({ projectId: q.projectId, limit })
      .map(projectEventForResponse);
    return reply.send({ events });
  });
}
