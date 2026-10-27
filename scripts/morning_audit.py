#!/usr/bin/env python3
"""Create an honest status snapshot; optionally run existing project QA scripts.

Does not claim implementation is complete or overwrite agent-authored reports.
"""
import argparse,datetime,json,os,subprocess,shutil,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]

def run(args,timeout=15):
 try:
  p=subprocess.run(args,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=timeout,check=False)
  return {'command':' '.join(args),'exit_code':p.returncode,'output_tail':p.stdout[-5000:],'status':'PASS' if p.returncode==0 else 'FAIL'}
 except FileNotFoundError:
  return {'command':' '.join(args),'exit_code':None,'output_tail':'Command not installed','status':'NOT_RUN'}
 except subprocess.TimeoutExpired as e:
  return {'command':' '.join(args),'exit_code':None,'output_tail':'Timeout exceeded','status':'TIMED_OUT'}

p=argparse.ArgumentParser()
p.add_argument('--run-tests',action='store_true',help='Run the actual project typecheck/test/build scripts if a project exists')
a=p.parse_args()
exists={s:(ROOT/s).exists() for s in ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','apps/web','apps/server','packages/contracts','packages/storage','handoff/EVIDENCE','README-dev.md']}
out={'generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'warning':'This is an observational snapshot, NOT a development completion report',
 'files_present':exists,'environment':{},'git':{},'quality_commands':[]}
for tool in ['node','pnpm','git']:
 out['environment'][tool]={'path':shutil.which(tool)}
 if shutil.which(tool): out['environment'][tool]['version']=run([tool,'--version'] if tool!='git' else [tool,'--version'])
if (ROOT/'.git').exists():
 out['git']['head']=run(['git','rev-parse','HEAD'])
 out['git']['status']=run(['git','status','--short'])
 out['git']['last_commits']=run(['git','log','-5','--oneline'])
else:
 out['git']['status']='NO_GIT_REPO'
if a.run_tests:
 if not exists['package.json'] or not shutil.which('pnpm'):
  out['quality_commands'].append({'status':'NOT_RUN','reason':'Missing package.json or pnpm'})
 else:
  try:
   package=json.loads((ROOT/'package.json').read_text(encoding='utf-8'))
   scripts=package.get('scripts',{})
  except Exception as e:
   scripts={};out['quality_commands'].append({'status':'NOT_RUN','reason':f'Invalid package.json: {e}'})
  for name in ['lint','typecheck','test','build','test:e2e']:
   if name in scripts:
    out['quality_commands'].append(run(['pnpm',name],timeout=300))
   else:
    out['quality_commands'].append({'command':'pnpm '+name,'status':'NOT_RUN','reason':'No corresponding script'})
report_dir=ROOT/'handoff'/'EVIDENCE'
report_dir.mkdir(parents=True,exist_ok=True)
path=report_dir/'morning-audit-snapshot.json'
path.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('HEARTH MORNING AUDIT — observational only')
for k,v in exists.items(): print(f'{k:26}', 'PRESENT' if v else 'MISSING')
print('Git:',out['git'].get('status','UNKNOWN'))
for q in out['quality_commands']: print(q.get('command','quality scripts'),q['status'])
print('Report:',path)
if a.run_tests and any(q['status'] in ('FAIL','NOT_RUN','TIMED_OUT') for q in out['quality_commands']):
 print('QUALITY GATES NOT ALL PASS')
 sys.exit(2)
