from pathlib import Path
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
# This gate validates a documentation-only tree. Reintroducing implementation
# requires replacing this guard with appropriate build and safety checks.
for name in ['apps', 'packages', 'tests', 'scripts', 'prototypes', 'fixtures', 'src', 'package.json']:
    if (root / name).exists():
        errors.append(f'Implementation needs a real verification gate: {name}')
code_extensions = {'.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.swift', '.sh'}
for path in root.rglob('*'):
    if path.is_file() and path.suffix in code_extensions and path != root / '.github/check_docs.py':
        errors.append(f'Implementation needs a real verification gate: {path.relative_to(root)}')
if errors:
    print('\n'.join(errors), file=sys.stderr)
    sys.exit(1)
print('Documentation entry links, required references and documentation-only scope: PASS')
