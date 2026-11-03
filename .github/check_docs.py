from pathlib import Path
import json
import re
import sys

root = Path(__file__).resolve().parent.parent
required = [
    'AGENTS.md', 'README.md', '00-START-HERE.md', 'tasks/REBUILD-PLAN.md',
    'docs/01-PRD.md', 'docs/04-CONTRACTS.md', 'docs/05-SECURITY.md',
    'docs/mvp/01-PRODUCT-CONTRACT.md', 'docs/mvp/03-ACCEPTANCE-SCENARIOS.md',
    'docs/mvp/04-PROJECT-REDISCOVERY.md', 'handoff/STATUS.md',
    'handoff/DECISIONS.md', 'handoff/BLOCKERS.md', 'handoff/MORNING-REPORT.md',
    'handoff/EVIDENCE',
]
entries = ['README.md', '00-START-HERE.md', 'tasks/REBUILD-PLAN.md', 'docs/01-PRD.md', 'docs/mvp/00-START-HERE.md']
errors = []
for name in required:
    if not (root / name).exists():
        errors.append(f'Missing required path: {name}')
for name in entries:
    path = root / name
    if not path.is_file():
        continue
    for target in re.findall(r'\]\(([^)]+)\)', path.read_text(encoding='utf-8')):
        if target.startswith(('https://', 'http://', 'mailto:', '#')):
            continue
        target = target.split('#', 1)[0]
        if not (path.parent / target).exists():
            errors.append(f'Broken link in {name}: {target}')
try:
    manifest = json.loads((root / 'tasks/manifest.json').read_text(encoding='utf-8'))
    tasks = manifest['tasks']
    ids = [task['id'] for task in tasks]
    if len(ids) != len(set(ids)):
        errors.append('Duplicate task IDs in manifest')
    seen = set()
    for task in tasks:
        if not set(task['depends_on']).issubset(seen):
            errors.append(f"Invalid or out-of-order task dependencies: {task['id']}")
        seen.add(task['id'])
except (ValueError, KeyError, TypeError, OSError) as exc:
    errors.append(f'Invalid task manifest: {exc}')
if errors:
    print('\n'.join(errors), file=sys.stderr)
    sys.exit(1)
print('Documentation entry links, required references and task ordering: PASS')
