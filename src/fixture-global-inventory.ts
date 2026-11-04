import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { readSyntheticUnderstanding } from './fixture-understanding.js';
import { listSyntheticCatalog } from './synthetic-catalog.js';

// Scopes must be assembled by the trusted server, never accepted from a client.
const Id = z.string().trim().min(1).max(256);
const Scope = z.object({ principalId: Id, projectId: z.enum(['project-a', 'project-b']), grantId: Id, rootId: Id }).strict();
const Scopes = z.array(Scope).max(2).superRefine((scopes, ctx) => {
  if (new Set(scopes.map(scope => scope.projectId)).size !== scopes.length)
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Duplicate project scope' });
});

export function readSyntheticInventory(db: DatabaseSync, rawScopes: unknown) {
  const scopes = Scopes.parse(rawScopes), catalog = listSyntheticCatalog();
  const projects = catalog.projects.flatMap(project => {
    const scope = scopes.find(item => item.projectId === project.id);
    const understanding = scope ? readSyntheticUnderstanding(db, scope) : null;
    if (!understanding) return [];
    const complete = Boolean(understanding.goal && understanding.result && understanding.todo);
    return [{ ...project, coverage: complete ? 'available' as const : 'incomplete' as const, understanding }];
  });
  return { synthetic: true as const, projects, unavailableCount: catalog.projects.length - projects.length, unassigned: catalog.unassigned };
}
