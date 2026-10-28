# @hearth/project-observer

Local, read-only Git and JUnit fact collector. No evaluation, planning, notification, or execution.

```ts
import { ProjectObserver } from '@hearth/project-observer';

const observer = new ProjectObserver({ dbPath: 'data/observer.sqlite' });
await observer.registerProject('/absolute/path/to/repo', {
  name: 'pindou',
  reports: [{ format: 'junit-xml', relativePath: 'reports/junit.xml' }],
});
await observer.start();
```

See `docs/14-PROJECT-OBSERVER.md` in the Hearth repo.
