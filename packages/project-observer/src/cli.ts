import path from 'node:path';
import { ProjectObserver } from './observer.js';
import { isObserverError } from './errors.js';

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index >= 0) return process.argv[index + 1];
  return fallback;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const dbPath = arg('--db') ?? path.resolve('data/observer.sqlite');
  const observer = new ProjectObserver({ dbPath, watchEnabled: false });
  try {
    switch (command) {
      case 'register': {
        const localPath = process.argv[3];
        if (localPath === undefined) throw new Error('usage: observer register <path> [--name NAME] [--report REL]');
        const reports = arg('--report') === undefined ? undefined : [{ format: 'junit-xml' as const, relativePath: arg('--report')! }];
        const project = await observer.registerProject(localPath, { name: arg('--name'), reports });
        console.log(JSON.stringify(project, null, 2));
        break;
      }
      case 'list': {
        console.log(JSON.stringify(observer.listProjects(), null, 2));
        break;
      }
      case 'scan': {
        const id = process.argv[3];
        if (id === undefined) throw new Error('usage: observer scan <projectId>');
        const run = await observer.scanProject(id, 'manual');
        console.log(JSON.stringify({ run, snapshot: observer.getLatestSnapshot(id), health: observer.getObserverHealth(id) }, null, 2));
        break;
      }
      case 'events': {
        const id = process.argv[3];
        if (id === undefined) throw new Error('usage: observer events <projectId>');
        console.log(JSON.stringify(observer.listEvents(id, { limit: 100 }), null, 2));
        break;
      }
      case 'enable':
      case 'disable': {
        const id = process.argv[3];
        if (id === undefined) throw new Error(`usage: observer ${command} <projectId>`);
        await observer.setProjectEnabled(id, command === 'enable');
        console.log(JSON.stringify(observer.getProject(id), null, 2));
        break;
      }
      case 'remove': {
        const id = process.argv[3];
        if (id === undefined) throw new Error('usage: observer remove <projectId>');
        await observer.removeProject(id);
        console.log(JSON.stringify({ removed: id }));
        break;
      }
      default:
        console.log(`Hearth Project Observer CLI
usage:
  observer --db data/observer.sqlite register <path> [--name NAME] [--report REL]
  observer list
  observer scan <projectId>
  observer events <projectId>
  observer enable|disable <projectId>
  observer remove <projectId>`);
    }
  } catch (cause) {
    const message = isObserverError(cause) ? `${cause.code}: ${cause.message}` : cause instanceof Error ? cause.message : String(cause);
    console.error(message);
    process.exitCode = 1;
  } finally {
    observer.close();
  }
}

await main();
