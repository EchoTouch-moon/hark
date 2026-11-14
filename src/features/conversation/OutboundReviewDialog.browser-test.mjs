// Run against an isolated local Vite server on port 1432; no native bridge or network provider is used.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const profile = await mkdtemp(path.join(os.tmpdir(), "hark-review-ui-"));
const chrome = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  "--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });
let socket;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(path.join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 50)); }
  }
  if (!port) throw new Error("Chrome did not start");
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    message.error ? waiter.reject(Error(message.error.message)) : waiter.resolve(message.result);
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id; pending.set(next, { resolve, reject }); socket.send(JSON.stringify({ id: next, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await call("Page.enable");
  await call("Page.navigate", { url: "http://127.0.0.1:1432/" });
  for (let i = 0; i < 100; i++) {
    try { if (await evaluate("document.readyState === 'complete'")) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const details = await evaluate(`(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { OutboundReviewDialog } = await import('/src/features/conversation/OutboundReviewDialog.tsx');
    const host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host); const pause = () => new Promise(resolve => setTimeout(resolve, 100));
    const body = '\\n  <script>alert(1)</script>\\n中文\\t x  \\n';
    const request = { reviewId: 'review-synthetic', recipient: 'https://example.invalid/v1/messages', model: 'synthetic-model', limits: [{label:'最大输出',value:'100 tokens'}], sources: [{path:'README.md',version:'sha256:synthetic'}], body };
    const calls = []; let finish;
    const onApprove = id => { calls.push('approve:' + id); return new Promise(resolve => {finish=resolve;}); };
    const onReject = id => { calls.push('reject:' + id); };
    root.render(React.createElement(OutboundReviewDialog, {request,onApprove,onReject})); await pause();
    const modal = document.querySelector('[data-testid=outbound-review-dialog]');
    const output = document.querySelector('[data-testid=outbound-review-body]');
    const before = {modal:modal.matches(':modal'), exact:output.textContent===body, noMarkup:output.querySelector('script')===null, recipient:modal.textContent.includes(request.recipient), model:modal.textContent.includes(request.model), limit:modal.textContent.includes('100 tokens'), source:modal.textContent.includes('sha256:synthetic'), focused:document.activeElement?.dataset.testid==='outbound-review-reject'};
    const approve=document.querySelector('[data-testid=outbound-review-approve]'); approve.click(); approve.click(); await pause();
    const during={calls:[...calls], disabled:approve.disabled}; finish(); await pause();
    const after={enabled:!approve.disabled};
    modal.dispatchEvent(new Event('cancel',{cancelable:true})); await pause();
    after.rejected=calls.includes('reject:review-synthetic'); root.unmount(); host.remove();
    return {before,during,after};
  })()`);
  console.log(JSON.stringify(details));
  if (!Object.values(details.before).every(Boolean) || details.during.calls.length !== 1 || !details.during.disabled || !details.after.enabled || !details.after.rejected) {
    throw Error("Review dialog check failed");
  }
} finally {
  socket?.close(); chrome.kill();
  await new Promise((resolve) => chrome.once("exit", resolve));
  await rm(profile, { recursive: true, force: true });
}
