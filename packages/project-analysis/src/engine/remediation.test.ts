import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ProjectObserver } from '@hearth/project-observer';
import { InsightStore, processProjectRules, listInsights } from '@hearth/project-insight';
import { createGitRepo } from '../../../project-observer/src/testkit/git-fixture.js';
import { AnalysisStore } from '../store/store.js';
import { AnalysisService } from './service.js';
import { MockAnalysisProvider } from '../providers/mock.js';
import { assembleProjectContext } from '../context/assemble.js';
import type { AnalysisProvider } from '../providers/types.js';
import { testFailSignal } from '../../../project-insight/src/insights/fixtures.js';
import { loadConfig } from '../../../../apps/server/src/config.js';
let dir: string, observer: ProjectObserver, store: AnalysisStore, insight: InsightStore, service: AnalysisService;
beforeEach(async () => {
 dir=await mkdtemp(path.join(tmpdir(),'hearth-r0-'));
 observer=new ProjectObserver({dbPath:path.join(dir,'o.sqlite'),watchEnabled:false});
 store=new AnalysisStore(path.join(dir,'a.sqlite'));
 insight=new InsightStore(path.join(dir,'i.sqlite'));
 service=new AnalysisService({observer,store,insight,provider:new MockAnalysisProvider()});
});
afterEach(async()=>{service.close();observer.close();insight.close();await rm(dir,{recursive:true,force:true});});
async function project(name='app') { return observer.registerProject(await createGitRepo(dir,name,{commit:true,files:{'README.md':'# App\n'}})); }
it('recovers persisted interrupted runs without calling provider and permits retry',async()=>{
 const p=await project();const c=assembleProjectContext(observer,insight,p.id,new Date().toISOString());
 store.insertRunning({id:'interrupted',projectId:p.id,insightId:null,trigger:'observe',provider:'pi',model:'m',snapshotId:c.snapshotId,headSha:c.headSha,streamEpoch:c.streamEpoch,contextFingerprint:c.contextFingerprint,startedAt:new Date().toISOString()});
 expect(service.recoverInterrupted()).toBe(1); expect(store.get('interrupted')).toMatchObject({status:'failed',errorCode:'INTERRUPTED'});
 expect((await service.start({projectId:p.id,trigger:'observe'})).status).toBe('succeeded');
});
it('cancel A cannot abort a newer B; global concurrency is bounded',async()=>{
 const p=await project(); const other=await project('other');
 const a=await service.start({projectId:p.id,trigger:'observe'});
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 const provider:AnalysisProvider={id:'mock',model:'slow',async analyze(input){await gate;return new MockAnalysisProvider().analyze(input);}};
 service=new AnalysisService({observer,store,insight,provider});
 const b=service.start({projectId:p.id,trigger:'observe'});
 expect(service.cancel(a.id)).toBe(false);
 await expect(service.start({projectId:other.id,trigger:'observe'})).rejects.toMatchObject({code:'CAPACITY'});
 release();expect((await b).status).toBe('succeeded');
});
it('rejects nonexistent and missing target Insight before provider execution',async()=>{
 const p=await project();
 await expect(service.start({projectId:p.id,trigger:'insight'})).rejects.toMatchObject({code:'INVALID_INSIGHT'});
 await expect(service.start({projectId:p.id,trigger:'insight',insightId:'missing'})).rejects.toMatchObject({code:'INVALID_INSIGHT'});
 expect(store.list(p.id)).toHaveLength(0);
});
it('deletion journal compensates after a cross-database failure and purges feedback',async()=>{
 const p=await project();const run=await service.start({projectId:p.id,trigger:'observe'});service.feedback(run.id,'useful');
 const purge=vi.spyOn(insight,'purgeProject').mockImplementationOnce(()=>{throw new Error('injected power loss');});
 await expect(service.removeProject(p.id)).rejects.toThrow('injected');
 expect(store.pendingDeletions()).toEqual([p.id]);
 await expect(service.start({projectId:p.id,trigger:'observe'})).rejects.toMatchObject({code:'PROJECT_DELETING'});
 purge.mockRestore();await service.recoverDeletions();
 expect(store.list(p.id)).toEqual([]);expect(store.db.prepare('SELECT * FROM analysis_feedback').all()).toEqual([]);
 expect(store.pendingDeletions()).toEqual([]);expect(observer.listProjects()).toEqual([]);
});
it('request budget survives a service restart',async()=>{
 const p=await project(); const provider:AnalysisProvider={id:'pi',model:'synthetic',async analyze(){return {kind:'no_recommendation',reason:'synthetic'};}};
 service=new AnalysisService({observer,store,insight,provider,maxDailyRequests:1});
 await service.start({projectId:p.id,trigger:'observe',consentFingerprint:service.preview({projectId:p.id,trigger:'observe'}).context.contextFingerprint});
 service=new AnalysisService({observer,store,insight,provider,maxDailyRequests:1});
 await expect(service.start({projectId:p.id,trigger:'observe'})).rejects.toMatchObject({code:'BUDGET'});
});
it('rejects LAN listeners but accepts loopback',()=>{
 expect(()=>loadConfig({host:'0.0.0.0'})).toThrow('loopback');expect(loadConfig({host:'127.0.0.1'}).host).toBe('127.0.0.1');
});

it('a killed writer leaves an interrupted record that restart can recover',async()=>{
 const p=await project();const c=assembleProjectContext(observer,insight,p.id,new Date().toISOString());
 store.insertRunning({id:'killed',projectId:p.id,insightId:null,trigger:'observe',provider:'pi',model:'m',snapshotId:c.snapshotId,headSha:c.headSha,streamEpoch:c.streamEpoch,contextFingerprint:c.contextFingerprint,startedAt:new Date().toISOString()});
 const child=spawnSync(process.execPath,['--input-type=module','-e',`import {DatabaseSync} from 'node:sqlite'; const db=new DatabaseSync(${JSON.stringify(store.dbPath)}); db.prepare("UPDATE analysis_runs SET error_message='child-in-flight' WHERE run_id='killed'").run(); process.kill(process.pid,'SIGKILL');`]);
 // Windows has no POSIX signal termination, so the child reports an exit code
 // instead of `signal`. Either way it must not look like a clean exit.
 if(process.platform==='win32'){ expect(child.signal ?? child.status).not.toBe(0); } else { expect(child.signal).toBe('SIGKILL'); }
 const dbPath=store.dbPath;service.close();store=new AnalysisStore(dbPath);
 service=new AnalysisService({observer,store,insight,provider:new MockAnalysisProvider()});
 expect(service.recoverInterrupted()).toBe(1);expect(store.get('killed')?.errorCode).toBe('INTERRUPTED');
 expect((await service.start({projectId:p.id,trigger:'observe'})).status).toBe('succeeded');
});
it('validates cross-project and stale epoch targets and puts the selected Insight first',async()=>{
 const p=await project(),other=await project('other');
 const base=testFailSignal(); const signal={...base,projectId:p.id,evidenceRefs:base.evidenceRefs?.map(ref=>({...ref,projectId:p.id}))};
 insight.commitSignalBatch({projectId:p.id,streamEpoch:1,expectedRevision:0,batch:{signals:[signal],proposedCursor:{afterSeq:2,streamEpoch:1},highWatermark:2,outcome:'OK',hasMore:false,legacyOrderReconstructed:false,extractorVersion:signal.extractorVersion!,eventsRead:1}});
 processProjectRules(insight,{projectId:p.id,streamEpoch:1,baseline:'none'});
 const target=listInsights(insight,{projectId:p.id}).items[0]!;
 await expect(service.start({projectId:other.id,trigger:'insight',insightId:target.id})).rejects.toMatchObject({code:'INVALID_INSIGHT'});
 const context=assembleProjectContext(observer,insight,p.id,new Date().toISOString(),target.id);
 expect(context.insights[0]?.id).toBe(target.id);expect(context.insights[0]?.reasonCodes).toContain('junit_failures_gt_0');
 insight.db.prepare('UPDATE insight_episodes SET stream_epoch=99 WHERE insight_id=?').run(target.id);
 await expect(service.start({projectId:p.id,trigger:'insight',insightId:target.id})).rejects.toMatchObject({code:'STALE_INSIGHT'});
});
