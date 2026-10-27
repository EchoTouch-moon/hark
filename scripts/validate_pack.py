#!/usr/bin/env python3
"""Offline consistency check for the Hearth planning pack (stdlib only).

This checks the *planning artifact*, not whether the product code is complete.
"""
from pathlib import Path
from collections import Counter
import json, sys

ROOT=Path(__file__).resolve().parents[1]
REQUIRED=[
 'README.md','00-START-HERE.md','AGENTS.md','RESEARCH-BASELINE.md',
 *[f'docs/{i:02d}-{name}.md' for i,name in enumerate([
  'RESEARCH','PRD','UX','ARCHITECTURE','CONTRACTS','SECURITY',
  'QA-BENCHMARK','DELIVERY-PLAN','NIGHT-RUN','ACCEPTANCE',
  'INTEGRATIONS','ADR','DEV-HANDBOOK','PANELS-AND-SKILLS'])],
 'tasks/manifest.json','tasks/NIGHT-QUEUE.md','tasks/progress.json','scripts/next_task.py',
 'prompts/01-NIGHT-LEAD.md','prompts/02-IMPLEMENTER.md',
 'prompts/03-SECURITY-REVIEWER.md','prompts/04-MORNING-AUDIT.md',
 'prompts/05-UX-IMPLEMENTER.md','prompts/06-DEBUG-RECOVERY.md',
 'fixtures/events.json','fixtures/projects.json','fixtures/adversarial.json',
 'fixtures/demo-walkthrough.json','handoff/STATUS.md',
 'handoff/MORNING-REPORT.md','handoff/DECISIONS.md',
 'handoff/BLOCKERS.md','handoff/EVIDENCE/README.md',
 'scripts/morning_audit.py',
]
errors=[]
for p in REQUIRED:
 if not (ROOT/p).is_file(): errors.append(f'MISSING {p}')

def obj(name):
 try: return json.loads((ROOT/name).read_text(encoding='utf-8'))
 except Exception as e: errors.append(f'JSON {name}: {e}'); return {}

progress=obj('tasks/progress.json')
manifest=obj('tasks/manifest.json')
tasks=manifest.get('tasks',[])
ids=[t.get('id') for t in tasks]
if not tasks: errors.append('NO TASKS')
if len(set(ids))!=len(ids): errors.append('DUP TASK ID '+str([x for x,n in Counter(ids).items() if n>1]))
byid={t['id']:t for t in tasks if t.get('id')}
if set(progress.get('states',{}))!=set(byid): errors.append('PROGRESS TASK IDS DO NOT MATCH MANIFEST')
for t in tasks:
 for k in ['title','depends_on','priority','overnight','deliverables','acceptance_tests','implementation_notes']:
  if k not in t: errors.append(f'{t.get("id")}: MISSING {k}')
 for dep in t.get('depends_on',[]):
  if dep not in byid: errors.append(f'{t.get("id")}: UNKNOWN DEP {dep}')
  if dep==t.get('id'): errors.append(f'{dep}: SELF DEP')
  if t.get('overnight') and dep in byid and not byid[dep].get('overnight'):
   errors.append(f'{t.get("id")}: night task depends on day-only {dep}')
 if not t.get('acceptance_tests'): errors.append(f'{t.get("id")}: NO ACCEPTANCE TESTS')

visited={}
def visit(n,stack):
 if visited.get(n)==2: return
 if visited.get(n)==1: errors.append('DEPENDENCY CYCLE '+' -> '.join(stack+[n]));return
 visited[n]=1
 for d in byid[n].get('depends_on',[]):
  if d in byid: visit(d,stack+[n])
 visited[n]=2
for k in byid: visit(k,[])

fixtures=obj('fixtures/events.json')
events=fixtures.get('events',[])
projects=obj('fixtures/projects.json')
project_ids={p.get('id') for p in projects.get('projects',[])}
for e in events:
 for f in ('id','source','occurredAt','observedAt','summary','dedupeKey','sensitivity','provenance','projectId'):
  if f not in e: errors.append(f'FIXTURE EVENT {e.get("id")}: MISSING {f}')
 if e.get('projectId') not in project_ids:
  errors.append(f'EVENT {e.get("id")}: UNKNOWN PROJECT')
 src=e.get('source',{})
 if src.get('sourceType')!='fixture' or not src.get('uri','').startswith('fixture://'):
  errors.append(f'EVENT {e.get("id")}: NON-DEMO SOURCE')
# Intentional duplicate dedupeKey must exist to test suppress.
keys=[e.get('dedupeKey') for e in events]
if len(keys)==len(set(keys)): errors.append('FIXTURES MISSING DUPLICATE DEDUPE CASE')
if sum(1 for e in events if e.get('goldenUseful'))<3:
 errors.append('FIXTURES MISSING 3 GOLDEN CASES')
attack=obj('fixtures/adversarial.json')
if len(attack.get('cases',[]))<12: errors.append('MISSING 12 ADVERSARIAL CASES')
walk=obj('fixtures/demo-walkthrough.json')
for case in walk.get('scenarios',[]):
 if case.get('eventId') not in {e.get('id') for e in events}:
  errors.append(f'UNKNOWN WALKTHROUGH EVENT {case.get("eventId")}')
if len(walk.get('scenarios',[]))<3: errors.append('MISSING 3 DEMO SCENARIOS')

print('HEARTH PACK VALIDATOR — planning artifacts only')
print(f'Files: {len(list(ROOT.rglob("*")))} entries; tasks: {len(tasks)} ({sum(bool(t.get("overnight")) for t in tasks)} night-enabled)')
print(f'Projects: {len(project_ids)}; events: {len(events)}; attack cases: {len(attack.get("cases",[]))}; demos: {len(walk.get("scenarios",[]))}')
if errors:
 for e in errors: print('FAIL',e)
 print(f'PLAN VALIDATION FAILED: {len(errors)} errors')
 sys.exit(1)
print('PLAN VALIDATION PASS — does NOT imply application implementation or tests passed')
