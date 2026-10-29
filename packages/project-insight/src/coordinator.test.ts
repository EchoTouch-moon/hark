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
 observer=new ProjectObserver({dbPath:path.join(dir,'o.sqlite'),watchEnabled:false,reconcileIntervalMs:40});
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
 coordinator.start();await expect.poll(()=>coordinator.health().ticks).toBeGreaterThan(6);await coordinator.stop();
 const changes=store.db.prepare('SELECT total_changes() AS n').get();
 coordinator.start();await expect.poll(()=>coordinator.health().ticks).toBeGreaterThan(10);await coordinator.stop();
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
