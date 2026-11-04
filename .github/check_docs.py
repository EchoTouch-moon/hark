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
ids = []
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
try:
    items = json.loads((root / 'tasks/m1-work-items.json').read_text(encoding='utf-8'))['items']
    progress = (root / 'tasks/DEVELOPMENT-PROGRESS.md').read_text(encoding='utf-8')
    task_pack = (root / 'tasks/M1-AGENT-WORK-PACKAGES.md').read_text(encoding='utf-8')
    seen_items = set()
    done_items = set()
    for item in items:
        item_id = item['id']
        if item_id in seen_items or not set(item['depends_on']).issubset(seen_items):
            errors.append(f'Invalid M1 item ID or dependency order: {item_id}')
        if item['parent'] not in ids or item['status'] not in ('TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED'):
            errors.append(f'Invalid M1 parent or status: {item_id}')
        if item['status'] == 'IN_PROGRESS' and not item['owner']:
            errors.append(f'M1 item in progress without owner: {item_id}')
        if item['status'] == 'DONE' and (not item['owner'] or not item['evidence']):
            errors.append(f'Completed M1 item lacks owner or evidence: {item_id}')
        if item['status'] == 'DONE' and not set(item['depends_on']).issubset(done_items):
            errors.append(f'Completed M1 item has incomplete dependencies: {item_id}')
        for evidence in item['evidence']:
            if not (root / evidence).is_file():
                errors.append(f'Missing M1 evidence for {item_id}: {evidence}')
        mark = 'x' if item['status'] == 'DONE' else ' '
        if not re.search(rf'^\s*- \[{mark}\] {re.escape(item_id)}（', progress, re.MULTILINE):
            errors.append(f'M1 progress checkbox disagrees with state: {item_id}')
        if f'**{item_id} ' not in task_pack:
            errors.append(f'M1 task description missing: {item_id}')
        seen_items.add(item_id)
        if item['status'] == 'DONE':
            done_items.add(item_id)
except (ValueError, KeyError, TypeError, OSError) as exc:
    errors.append(f'Invalid M1 work items: {exc}')
if errors:
    print('\n'.join(errors), file=sys.stderr)
    sys.exit(1)
print('Documentation entry links, required references and task ordering: PASS')
