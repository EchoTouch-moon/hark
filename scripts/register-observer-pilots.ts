import { existsSync } from 'node:fs';
import path from 'node:path';
import { ProjectObserver } from '../packages/project-observer/src/observer.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const PILOTS: Array<{ name: string; env: string; report?: string }> = [
  { name: 'pindou', env: 'HEARTH_PILOT_PINDOU' },
  { name: 'prototype-skill-lab', env: 'HEARTH_PILOT_SKILL_LAB' },
  { name: 'agent-internet-lab', env: 'HEARTH_PILOT_AGENT_INTERNET' },
];

const observer = new ProjectObserver({
  dbPath: process.env['HEARTH_OBSERVER_DB'] ?? path.join(ROOT, 'data', 'observer.sqlite'),
  watchEnabled: false,
});

try {
  for (const pilot of PILOTS) {
    const localPath = process.env[pilot.env];
    if (localPath === undefined || localPath.trim() === '') {
      console.log(`SKIP ${pilot.name}: set ${pilot.env} to an absolute git path`);
      continue;
    }
    if (!existsSync(localPath)) {
      console.log(`SKIP ${pilot.name}: path not found`);
      continue;
    }
    try {
      const project = await observer.registerProject(localPath, {
        name: pilot.name,
        reports: pilot.report === undefined ? undefined : [{ format: 'junit-xml', relativePath: pilot.report }],
      });
      console.log(`REGISTERED ${pilot.name} -> ${project.id}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.log(`KEEP ${pilot.name}: ${message}`);
    }
  }
  console.log(JSON.stringify(observer.listProjects().map(({ canonicalPath, ...rest }) => rest), null, 2));
} finally {
  observer.close();
}
