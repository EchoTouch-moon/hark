#!/usr/bin/env python3
"""Deterministic overnight queue helper. Only task records, never runs code.

It cannot verify test truth; audit actual evidence independently.
"""
from pathlib import Path
import argparse,datetime,json,os,sys,tempfile
ROOT=Path(__file__).resolve().parents[1]
MF=ROOT/'tasks/manifest.json'; PR=ROOT/'tasks/progress.json'

def read(p):return json.loads(p.read_text(encoding='utf-8'))

def atomic_write(path,obj):
 path.parent.mkdir(parents=True,exist_ok=True)
 with tempfile.NamedTemporaryFile('w',encoding='utf-8',dir=path.parent,delete=False) as f:
  json.dump(obj,f,indent=2,ensure_ascii=False);f.write('\n');name=f.name
 os.replace(name,path)

m=read(MF);tasks=m['tasks'];byid={t['id']:t for t in tasks}
state=read(PR) if PR.exists() else {'schemaVersion':'1','states':{t['id']:{'status':'NOT_STARTED'} for t in tasks}}
for t in tasks:state['states'].setdefault(t['id'],{'status':'NOT_STARTED'})

p=argparse.ArgumentParser()
g=p.add_mutually_exclusive_group(required=True)
g.add_argument('--next',action='store_true',help='Print first actionable task whose prerequisites are DONE')
g.add_argument('--summary',action='store_true')
g.add_argument('--mark',metavar='TASK_ID')
p.add_argument('status',nargs='?',choices=['NOT_STARTED','IN_PROGRESS','DONE','PARTIAL','BLOCKED'])
p.add_argument('--evidence',help='Existing relative path in this repo containing outcome proof')
p.add_argument('--note',help='Reason/error for status update; do not include secrets')
a=p.parse_args()

if a.mark:
 t=byid.get(a.mark)
 if not t:sys.exit('Unknown task: '+a.mark)
 if not a.status:sys.exit('Status required after --mark TASK_ID')
 if a.status=='DONE':
  missing=[dep for dep in t['depends_on'] if state['states'][dep]['status']!='DONE']
  if missing:sys.exit('Cannot mark DONE before dependencies: '+', '.join(missing))
  if not a.evidence:sys.exit('DONE requires --evidence path')
  target=(ROOT/a.evidence).resolve()
  if ROOT.resolve() not in target.parents or not target.is_file() or target.stat().st_size==0:
   sys.exit('Evidence file must exist nonempty inside repo')
 state['states'][a.mark]={'status':a.status,'updatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
  'evidence':a.evidence,'note':a.note}
 atomic_write(PR,state)
 print(f'UPDATED {a.mark}: {a.status} (self-reported; still requires independent verification)')
elif a.summary:
 for t in tasks:
  print(f'{t["id"]:<10} {state["states"][t["id"]]["status"]:<13} {t["title"]}')
else:
 priority={'P0':0,'P1':1,'P2':2}
 ready=[t for t in tasks if t['overnight'] and state['states'][t['id']]['status']=='NOT_STARTED' and
        all(state['states'][dep]['status']=='DONE' for dep in t['depends_on'])]
 ready.sort(key=lambda t:(priority[t['priority']],tasks.index(t)))
 if ready:
  t=ready[0]
  print(json.dumps({'nextTask':t,'instructions':'Implement + test + record evidence + use --mark TASK_ID DONE/PARTIAL/BLOCKED'},ensure_ascii=False,indent=2))
 else:
  unresolved=[t['id'] for t in tasks if t['overnight'] and state['states'][t['id']]['status']!='DONE']
  print(json.dumps({'nextTask':None,'remainingOvernightTasks':unresolved,'hint':'No ready tasks; resolve blockers or finish in-progress tasks, do not skip dependencies.'},ensure_ascii=False,indent=2))
