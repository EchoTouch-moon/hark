import type { FastifyReply } from 'fastify';
import type { AppDeps } from './app.js';

/** The app does not enable legacy execution in production; isolated tests opt in. */
export function legacyDemoAllowed(deps: AppDeps): boolean {
  return deps.config.demoMode === true && deps.services.orchestrator.legacyExecutionEnabled;
}

export function rejectLegacyDemo(reply: FastifyReply): FastifyReply {
  return reply.status(403).send({ error: { code: 'LEGACY_ACTIONS_DISABLED', message: '旧演示操作当前不可用。' } });
}
