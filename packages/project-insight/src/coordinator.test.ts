import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectObserver } from '@hearth/project-observer';
import { createGitRepo } from '../../project-observer/src/testkit/git-fixture.js';
import { InsightStore } from './store/store.js';
import { InProcessObserverReadPort } from './observer-read-port.js';
import { InsightCoordinator } from './coordinator.js';
import { listInsights } from './insights/query.js';
let dir: string, observer: ProjectObserver, store: InsightStore, coordinator: InsightCoordinator;
beforeEach(async()=>{
 dir=await mkdtemp(path.join(tmpdir(),'hearth-r1-'));
 // The gap threshold defaults to 1.5x the reconcile interval - 60ms here. A
 // restart on a loaded machine routinely exceeds that, and the observer then
 // emits OBSERVATION_GAP, which R-OBSERVATION-GAP turns into a real, legitimate
 // insight episode. That is not a duplicate, but `countEpisodes` counts it, so
 // the idempotency assertions below became timing-dependent. Pin the threshold
 // far outside this test's lifetime: gap behaviour is asserted separately below.
 observer=new ProjectObserver({dbPath:path.join(dir,'o.sqlite'),watchEnabled:false,reconcileIntervalMs:40,gapThresholdMs:60_000});
 store=new InsightStore(path.join(dir,'i.sqlite'));
 coordinator=new InsightCoordinator({store,port:new InProcessObserverReadPort(observer),projectIds:()=>observer.listProjects().filter(p=>p.enabled).map(p=>p.id),intervalMs:20});
});
afterEach(async()=>{await coordinator.stop();await observer.stop();observer.close();store.close();await rm(dir,{recursive:true,force:true});});
it('a new report automatically creates one Insight; restart, repeat and idle do not duplicate',async()=>{
 const repo=await createGitRepo(dir,'repo',{commit:true});
 await mkdir(path.join(repo,'reports'));
 const project=await observer.registerProject(repo,{reports:[{format:'junit-xml',relativePath:'reports/junit.xml'}]});
 await observer.start();coordinator.start();
 await writeFile(path.join(repo,'reports/junit.xml'),'<testsuite tests="1" failures="1"><testcase name="bad"><failure/></testcase></testsuite>');
 await expect.poll(()=>listInsights(store,{projectId:project.id}).items.filter(item=>item.primaryRuleId.startsWith('R-TEST')).length,{timeout:6000}).toBe(1);
 await coordinator.stop();await observer.stop();
 const before=store.countEpisodes(project.id);
 const dbPath=store.dbPath;store.close();store=new InsightStore(dbPath);
 coordinator=new InsightCoordinator({store,port:new InProcessObserverReadPort(observer),projectIds:()=>[project.id],intervalMs:20});
 await observer.start();coordinator.start();
 await expect.poll(()=>coordinator.health().ticks).toBeGreaterThan(3);
 expect(store.countEpisodes(project.id)).toBe(before);
 await observer.stop();await coordinator.stop();
 // Restart may legitimately append an observation-gap signal. Once reconciled,
 // unchanged source ticks must not write anything to the Insight database.
 let targetTicks=coordinator.health().ticks+4;
 coordinator.start();await expect.poll(()=>coordinator.health().ticks).toBeGreaterThan(targetTicks);await coordinator.stop();
 const changes=store.db.prepare('SELECT total_changes() AS n').get();
 targetTicks=coordinator.health().ticks+4;
 coordinator.start();await expect.poll(()=>coordinator.health().ticks).toBeGreaterThan(targetTicks);await coordinator.stop();
 expect(store.db.prepare('SELECT total_changes() AS n').get()).toEqual(changes);
});
it('frozen source stays frozen and no writes occur during empty ticks',async()=>{
 const repo=await createGitRepo(dir,'repo',{commit:true});const project=await observer.registerProject(repo);
 coordinator.start();await expect.poll(()=>coordinator.health().ticks).toBeGreaterThan(2);
 await coordinator.stop();
 store.freezeCheckpoint(project.id,1);
 coordinator.start();await expect.poll(()=>coordinator.health().frozen).toBeGreaterThan(0);
 expect(store.getCheckpoint(project.id,1)?.status).toBe('FROZEN');expect(store.countEpisodes(project.id)).toBe(0);
});
it('a restart past the gap threshold opens exactly one observation-gap insight',async()=>{
 // Companion to the case above: the gap episode is real product behaviour, not a
 // duplicate, but it used to be exercised only by accident - whenever a restart
 // happened to be slow enough to cross the default threshold. threshold 0 makes
 // the gap unconditional, so this is deterministic instead of load-dependent.
 const gapDir=await mkdtemp(path.join(tmpdir(),'hearth-r1-gap-'));
 const gapObserver=new ProjectObserver({dbPath:path.join(gapDir,'o.sqlite'),watchEnabled:false,reconcileIntervalMs:40,gapThresholdMs:0});
 const gapStore=new InsightStore(path.join(gapDir,'i.sqlite'));
 const gapCoordinator=new InsightCoordinator({store:gapStore,port:new InProcessObserverReadPort(gapObserver),projectIds:()=>gapObserver.listProjects().filter(p=>p.enabled).map(p=>p.id),intervalMs:20});
 try{
  const repo=await createGitRepo(gapDir,'repo',{commit:true});
  const project=await gapObserver.registerProject(repo);
  await gapObserver.start();gapCoordinator.start();
  await expect.poll(()=>gapCoordinator.health().ticks).toBeGreaterThan(2);
  await gapCoordinator.stop();await gapObserver.stop();
  await gapObserver.start();gapCoordinator.start();
  await expect.poll(()=>gapStore.countEpisodes(project.id)).toBe(1);
  const rows=gapStore.db.prepare('SELECT issue_family,primary_rule_id,severity FROM insight_episodes WHERE project_id=?').all(project.id);
  expect(rows).toEqual([{issue_family:'observation-gap',primary_rule_id:'R-OBSERVATION-GAP',severity:'info'}]);
  const types=gapObserver.listEventsForward(project.id,{afterSeq:0,limit:100}).events.map(event=>event.type);
  expect(types).toContain('OBSERVATION_GAP');
 }finally{
  await gapCoordinator.stop();await gapObserver.stop();gapObserver.close();gapStore.close();await rm(gapDir,{recursive:true,force:true});
 }
});
it('delete/re-register does not silently reset a broken stream',async()=>{
 const repo=await createGitRepo(dir,'repo',{commit:true});const project=await observer.registerProject(repo);
 coordinator=new InsightCoordinator({store,port:new InProcessObserverReadPort(observer),projectIds:()=>[project.id],intervalMs:20});
 coordinator.start();await expect.poll(()=>coordinator.health().ticks).toBeGreaterThan(2);await coordinator.stop();
 await observer.removeProject(project.id);
 coordinator.start();await expect.poll(()=>store.listInterruptions(project.id).length).toBeGreaterThan(0);await coordinator.stop();
 const next=await observer.registerProject(repo);expect(next.id).toBe(project.id);
 coordinator.start();await expect.poll(()=>coordinator.health().frozen).toBeGreaterThan(0);
 expect(store.countEpisodes(project.id)).toBe(0);
});
