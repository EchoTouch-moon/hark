// Run with an isolated Vite server at 127.0.0.1:1431. All data and IPC are synthetic.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const profile = await mkdtemp(path.join(os.tmpdir(), 'hark-review-app-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let ws;
try {
  let port;
  for (let i = 0; i < 100; i++) { try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await new Promise(r => setTimeout(r, 50)); } }
  if (!port) throw Error('browser unavailable');
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0; const pending = new Map();
  ws.onmessage = e => { const value = JSON.parse(e.data); if (value.id) { const p = pending.get(value.id); pending.delete(value.id); value.error ? p.reject(Error(value.error.message)) : p.resolve(value.result); } };
  const call = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
  const ev = async expression => { const value = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (value.exceptionDetails) throw Error(JSON.stringify(value.exceptionDetails)); return value.result.value; };
  await call('Page.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const WS='ws_0123456789abcdef0123456789abcdef', ROOT='root_0123456789abcdef0123456789abcdef', CONV='conv_0123456789abcdef0123456789abcdef', RUN='run_0123456789abcdef0123456789abcdef', MSG='msg_0123456789abcdef0123456789abcdef';
    const date='2026-11-10T00:00:00Z'; const root={id:ROOT,path:'/synthetic/project',dev:'1',ino:'2',status:'active',createdAt:date,updatedAt:date}; const workspace={id:WS,rootId:ROOT,agentId:'agt_0123456789abcdef0123456789abcdef',conversationId:CONV,relativePath:'',dev:'1',ino:'2',displayName:'示例项目',status:'active',createdAt:date};
    const checkpoint={workspaceId:WS,generation:1,state:'presented',structureScanned:true,selectiveReadDone:true,modelAnalyzed:true,openingPresented:true,localCardFolded:true,modelStatus:'enabled',initialReadRequested:true}; const overview={workspaceId:WS,relativePath:'',directoryStatus:'active',readable:true,structureScanned:true,selectiveReadDone:true,modelAnalyzed:true,openingPresented:true,modelInference:true,sourceIds:[]};
    const first='review_00000000000000000000000000000001', second='review_00000000000000000000000000000002', third='review_00000000000000000000000000000003'; window.__decisions=[]; window.__requests=[]; window.__cancelCount=0; let channel, callback=0;
    const realTimeout=window.setTimeout.bind(window); window.setTimeout=(fn,ms,...args)=>realTimeout(fn,window.__fastReviewTimeout&&ms===120000?1000:ms,...args);
    window.__review = (reviewId, seq) => channel.onmessage({schemaVersion:'hark.ui.v1',workspaceId:WS,conversationId:CONV,runId:RUN,seq,type:'outbound_review_requested',payload:{reviewId}});
    window.__TAURI_INTERNALS__={transformCallback:()=>++callback,unregisterCallback:()=>{},invoke:async(cmd,args)=>{switch(cmd){
      case 'shell_snapshot': return {roots:[root],workspaces:[workspace],readerCapability:'synthetic',remoteModelTransport:'stepfun_session_memory',modelTransportAvailable:true,credentialPersistenceAvailable:true,sidecar:{connected:true,transport:'synthetic',windowsJobObject:'none',reason:''},notes:[]};
      case 'list_workspaces':return [workspace]; case 'get_workspace':return workspace; case 'workspace_overview':return overview; case 'service_grants':return [{id:'grant',workspaceId:WS,service:'model',status:'enabled',updatedAt:date}]; case 'onboarding':return checkpoint;
      case 'list_source_refs':case 'list_workspace_opinions':case 'list_memory_receipts':case 'list_conversation':return [];
      case 'start_agent_turn': channel=args.onEvent; setTimeout(()=>window.__review(first,2),20); return {runId:RUN,acceptedUserMessage:{id:MSG,workspaceId:WS,conversationId:CONV,kind:'user_message',body:args.request.userPrompt,sourceIds:[],presentation:'normal',createdAt:date}};
      case 'get_outbound_review': window.__requests.push(args.request); return {...args.request,recipient:'https://example.invalid/messages',model:'synthetic-model',limits:[{label:'最大输出',value:'200'}],sources:[],body:args.request.reviewId===first?'FIRST-SYNTHETIC-BODY':'SECOND-SYNTHETIC-BODY'};
      case 'decide_outbound_review':window.__decisions.push(args.request);return null;
      case 'get_agent_turn':return {runId:RUN,workspaceId:WS,conversationId:CONV,state:'running'};
      case 'cancel_agent_turn':window.__cancelCount++;return {runId:RUN,workspaceId:WS,conversationId:CONV,state:'cancelled'};
      default:throw {code:'unexpected',detail:cmd};
    }}}; window.__second=()=>window.__review(second,3); window.__third=()=>{window.__fastReviewTimeout=true;window.__review(third,4);};
  })();` });
  await call('Page.navigate', { url: 'http://127.0.0.1:1431/' });
  for (let i = 0; i < 150; i++) { if (await ev('!!document.querySelector("[data-testid=composer-textarea]")')) break; await new Promise(r => setTimeout(r, 50)); }
  const result = await ev(`(async()=>{
    const wait=()=>new Promise(r=>setTimeout(r,180)); const input=document.querySelector('[data-testid=composer-textarea]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'synthetic message'); input.dispatchEvent(new Event('input',{bubbles:true})); await wait(); document.querySelector('[data-testid=send-message-button]').click(); await wait(); await wait();
    const first=document.querySelector('[data-testid=outbound-review-body]')?.textContent==='FIRST-SYNTHETIC-BODY'; document.querySelector('[data-testid=outbound-review-approve]')?.click(); await wait();
    const approved=window.__decisions.length===1&&window.__decisions[0].decision==='approve'&&Object.keys(window.__decisions[0]).sort().join(',')==='decision,reviewId,runId,workspaceId';
    window.__second(); await wait(); const second=document.querySelector('[data-testid=outbound-review-body]')?.textContent==='SECOND-SYNTHETIC-BODY'; document.querySelector('[data-testid=outbound-review-reject]')?.click(); await wait();
    const rejected=window.__decisions.length===2&&window.__decisions[1].decision==='reject',closed=!document.querySelector('[data-testid=outbound-review-dialog]');
    window.__third(); await wait(); const third=!!document.querySelector('[data-testid=outbound-review-dialog]'); await new Promise(r=>setTimeout(r,1300)); await wait();
    return {first,approved,second,rejected,closed,third,expired:!document.querySelector('[data-testid=outbound-review-dialog]')&&window.__cancelCount===1,requests:window.__requests.length};
  })()`);
  console.log(JSON.stringify(result));
  if (!result.first || !result.approved || !result.second || !result.rejected || !result.closed || !result.third || !result.expired || result.requests !== 3) throw Error('synthetic review flow failed');
} finally { ws?.close(); chrome.kill(); await new Promise(r => chrome.once('exit', r)); await rm(profile, { recursive: true, force: true }); }
