import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  STEPFUN_LIVE_ENDPOINT,
  STEPFUN_LIVE_MAX_OUTPUT_TOKENS,
  STEPFUN_LIVE_MODEL,
  SYNTHETIC_INPUT_MARKER,
  createStepfunFetchGuard,
  parseCliArgs,
  resolveSummaryPath,
  runStepfunLiveCheck,
  scanTreeForSecret,
  writeBoundedSummary,
  type LiveCheckResult,
} from "../scripts/stepfun-live-check.ts";

const KEY = "synthetic-stepfun-live-check-key-do-not-log";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const scriptPath = path.join(repoRoot, "packages/agent-host/scripts/stepfun-live-check.ts");
const wrapperPath = path.join(repoRoot, "scripts/stepfun-live-check.sh");

let chain: Promise<void> = Promise.resolve();

function exclusive(name: string, fn: () => Promise<void>): void {
  test(name, async () => {
    const previous = chain;
    let release = () => {};
    chain = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await fn();
    } finally {
      release();
    }
  });
}

function tempRepo(): { root: string; summary: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "hark-stepfun-repo-"));
  mkdirSync(path.join(root, "handoff/EVIDENCE/r1"), { recursive: true });
  return {
    root,
    summary: "handoff/EVIDENCE/r1/stepfun-live-check-summary.json",
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function assertNoKey(text: string): void {
  assert.equal(text.includes(KEY), false);
  assert.equal(text.includes("Bearer "), false);
}

async function sse(kind: "text" | "tool", text = "synthetic-offline-text"): Promise<Response> {
  const provider = await import("../src/provider.ts");
  const body = kind === "text" ? provider.sseText(text) : provider.sseToolCall("workspace.read_file", { relativePath: "README.md" });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function recordedFetch(handler: (call: number) => Response | Promise<Response>) {
  const calls: Array<{ url: string; body: string; redirect: string | null; authorization: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      body: typeof init?.body === "string" ? init.body : "",
      redirect: init?.redirect ?? null,
      authorization: headers.get("authorization") ?? "",
    });
    return handler(calls.length);
  };
  return { calls, fetchImpl };
}

async function runOffline(fetchImpl: typeof fetch, apiKey: string | undefined = KEY): Promise<{ result: LiveCheckResult; repo: ReturnType<typeof tempRepo> }> {
  const repo = tempRepo();
  const result = await runStepfunLiveCheck({
    apiKey,
    repoRoot: repo.root,
    summaryRelativePath: repo.summary,
    fetchImpl,
    runTimeoutMs: 8_000,
  });
  return { result, repo };
}

exclusive("guard rejects the fourth send and caps the outgoing body", async () => {
  let innerCalls = 0;
  const guard = createStepfunFetchGuard(async (_input, init) => {
    innerCalls += 1;
    assert.equal(init?.redirect, "error");
    return new Response(null, { status: 200 });
  });
  const body = JSON.stringify({ model: "other-model", max_tokens: 4096, messages: [] });
  for (let i = 0; i < 3; i += 1) {
    await guard.fetch(STEPFUN_LIVE_ENDPOINT, { method: "POST", body, redirect: "follow" });
  }
  await assert.rejects(() => guard.fetch(STEPFUN_LIVE_ENDPOINT, { method: "POST", body }), (error: unknown) => {
    assert.equal(error instanceof Error ? error.message : "", "budget_exceeded");
    return true;
  });
  assert.equal(innerCalls, 3);
  assert.equal(guard.state.sends, 3);
  assert.equal(guard.state.attempts, 4);
  const first = guard.state.calls[0];
  const second = guard.state.calls[1];
  const third = guard.state.calls[2];
  assert.equal(first?.model, STEPFUN_LIVE_MODEL);
  assert.equal(first?.maxTokens, STEPFUN_LIVE_MAX_OUTPUT_TOKENS);
  assert.equal(first?.maxCompletionTokens, STEPFUN_LIVE_MAX_OUTPUT_TOKENS);
  assert.equal(first?.toolChoice, "forced-none");
  assert.equal(second?.toolChoice, "forced-read-file");
  assert.equal(third?.toolChoice, "forced-none");
  assert.equal(first?.url, STEPFUN_LIVE_ENDPOINT);
  await assert.rejects(() => guard.fetch("https://api.stepfun.com/v1/models", { method: "GET" }), (error: unknown) => {
    assert.equal(error instanceof Error ? error.message : "", "fatal_stop");
    return true;
  });
  assert.equal(innerCalls, 3);
});

exclusive("missing key never fetches and summary has no secret", async () => {
  let called = 0;
  const repo = tempRepo();
  const previous = process.env.STEPFUN_API_KEY;
  process.env.STEPFUN_API_KEY = KEY;
  try {
    const result = await runStepfunLiveCheck({
      apiKey: undefined,
      repoRoot: repo.root,
      summaryRelativePath: repo.summary,
      fetchImpl: async () => {
        called += 1;
        throw new Error("fetch must not run");
      },
    });
    assert.equal(called, 0);
    assert.equal(result.summary.code, "missing_key");
    assert.equal(result.summary.firstText.verdict, "not-run");
    assert.equal(result.summary.tool.verdict, "not-run");
    assert.equal(result.summary.boundedLiveObservation, false);
    assert.equal(result.exitCode, 2);
    assertNoKey(result.stdout);
    assertNoKey(result.stderr);
    assert.equal(process.env.HARK_STEPFUN_API_KEY, undefined);
    assert.equal(process.env.STEPFUN_API_KEY, undefined);
    const summary = readFileSync(path.join(repo.root, repo.summary), "utf8");
    assertNoKey(summary);
    assert.equal(summary.includes(SYNTHETIC_INPUT_MARKER), true);
  } finally {
    if (previous === undefined) delete process.env.STEPFUN_API_KEY;
    else process.env.STEPFUN_API_KEY = previous;
    repo.cleanup();
  }
});

exclusive("production loop is stopped by the budget guard on the fourth attempt", async () => {
  const recorded = recordedFetch(async () => sse("tool"));
  const { result, repo } = await runOffline(recorded.fetchImpl);
  try {
    assert.equal(recorded.calls.length, 3);
    assert.equal(result.summary.requestCount, 3);
    assert.equal(result.summary.code, "budget_exceeded");
    assert.equal(result.summary.firstText.verdict, "fail");
    assert.equal(result.summary.tool.verdict, "incomplete");
    assert.equal(result.summary.boundedLiveObservation, false);
    assert.equal(result.summary.claimsProductAcceptance, false);
    assert.equal(result.exitCode, 1);
    assertNoKey(result.stdout);
    assertNoKey(result.stderr);
    assertNoKey(readFileSync(result.summaryFile ?? "", "utf8"));
    for (const call of recorded.calls) {
      assert.equal(call.url, STEPFUN_LIVE_ENDPOINT);
      assert.equal(call.redirect, "error");
      assert.equal(call.authorization, `Bearer ${KEY}`);
      const body = JSON.parse(call.body) as { model?: string; max_tokens?: number; max_completion_tokens?: number };
      assert.equal(body.model, STEPFUN_LIVE_MODEL);
      assert.equal(body.max_tokens, STEPFUN_LIVE_MAX_OUTPUT_TOKENS);
      assert.equal(body.max_completion_tokens, STEPFUN_LIVE_MAX_OUTPUT_TOKENS);
      assertNoKey(call.body);
    }
  } finally {
    repo.cleanup();
  }
});

exclusive("controlled tool chain stays within three sends and does not self-certify a live pass", async () => {
  const recorded = recordedFetch(async (call) => {
    if (call === 1) return sse("text", "synthetic-offline-text");
    if (call === 2) return sse("tool");
    if (call === 3) return sse("text", "synthetic-offline-final");
    throw new Error("fourth fetch must not happen");
  });
  const previousProxy = process.env.HTTPS_PROXY;
  process.env.HTTPS_PROXY = "http://127.0.0.1:9";
  process.env.HARK_STEPFUN_API_KEY = KEY;
  const { result, repo } = await runOffline(recorded.fetchImpl);
  try {
    assert.equal(process.env.HARK_STEPFUN_API_KEY, undefined);
    assert.equal(process.env.HTTPS_PROXY, undefined);
    assert.equal(recorded.calls.length, 3);
    assert.equal(result.summary.code, "ok");
    assert.equal(result.summary.liveTransport, false);
    assert.equal(result.summary.boundedLiveObservation, false);
    assert.equal(result.summary.claimsProductAcceptance, false);
    assert.equal(result.summary.rustJointClosedLoop, false);
    assert.equal(result.summary.realProjectRead, false);
    assert.equal(result.summary.firstText.verdict, "pass");
    assert.equal(result.summary.firstText.toolChoice, "forced-none");
    assert.equal(result.summary.tool.verdict, "pass");
    assert.equal(result.summary.tool.selection, "forced");
    assert.equal(result.summary.tool.followUpToolChoice, "forced-none");
    assert.equal(result.summary.tool.readFileRequests, 1);
    assert.equal(result.summary.autoRetry, false);
    assert.equal(result.summary.redirect, "error");
    assert.equal(result.exitCode, 0);
    const choices = recorded.calls.map((call) => JSON.parse(call.body) as { tool_choice?: unknown });
    assert.equal(choices[0]?.tool_choice, "none");
    assert.deepEqual(choices[1]?.tool_choice, { type: "function", function: { name: "workspace.read_file" } });
    assert.equal(choices[2]?.tool_choice, "none");
    assertNoKey(result.stdout);
    assertNoKey(result.stderr);
    assertNoKey(readFileSync(result.summaryFile ?? "", "utf8"));
    assert.equal(result.stdout.includes("synthetic-offline-final"), false);
    assert.equal(result.stdout.includes(SYNTHETIC_INPUT_MARKER), true);
  } finally {
    if (previousProxy === undefined) delete process.env.HTTPS_PROXY;
    else process.env.HTTPS_PROXY = previousProxy;
    delete process.env.HARK_STEPFUN_API_KEY;
    repo.cleanup();
  }
});

for (const status of [401, 403, 429] as const) {
  exclusive(`http ${status} does not add another call`, async () => {
    let calls = 0;
    const { result, repo } = await runOffline(async () => {
      calls += 1;
      return new Response(null, { status, headers: { "x-secret": KEY } });
    });
    try {
      assert.equal(calls, 1);
      assert.equal(result.summary.code, `http_${status}`);
      assert.equal(result.summary.status, status);
      assert.equal(result.summary.firstText.verdict, "fail");
      assert.notEqual(result.summary.firstText.verdict, "pass");
      assert.equal(result.summary.tool.verdict, "incomplete");
      assert.equal(result.summary.boundedLiveObservation, false);
      assert.equal(result.exitCode, 1);
      assertNoKey(result.stdout);
      assertNoKey(result.stderr);
      assert.equal(result.stdout.includes("x-secret"), false);
      assert.equal(result.stderr.includes(String(status)) || result.stdout.includes(String(status)), true);
    } finally {
      repo.cleanup();
    }
  });
}

exclusive("redirect response is not followed", async () => {
  let calls = 0;
  const { result, repo } = await runOffline(async (_input, init) => {
    calls += 1;
    assert.equal(init?.redirect, "error");
    return new Response(null, { status: 302, headers: { location: "https://api.stepfun.com/v1/elsewhere" } });
  });
  try {
    assert.equal(calls, 1);
    assert.equal(result.summary.code, "redirect_refused");
    assert.equal(result.summary.firstText.verdict, "fail");
    assert.equal(result.summary.tool.verdict, "incomplete");
    assertNoKey(result.stdout);
    assert.equal(result.stdout.includes("elsewhere"), false);
  } finally {
    repo.cleanup();
  }
});

exclusive("summary path cannot escape the evidence directory", async () => {
  const repo = tempRepo();
  try {
    assert.throws(() => resolveSummaryPath(repo.root, "../stepfun-live-check-summary.json"), /invalid_summary_path/);
    assert.throws(() => resolveSummaryPath(repo.root, "/tmp/stepfun-live-check-summary.json"), /invalid_summary_path/);
    assert.throws(() => resolveSummaryPath(repo.root, "handoff/EVIDENCE/r1/../../secret.json"), /invalid_summary_path/);
    const result = await runStepfunLiveCheck({
      apiKey: KEY,
      repoRoot: repo.root,
      summaryRelativePath: "handoff/EVIDENCE/other.json",
      fetchImpl: async () => {
        throw new Error("fetch must not run");
      },
    });
    assert.equal(result.summary.code, "invalid_summary_path");
    assert.equal(result.summaryFile, null);
    assertNoKey(result.stdout);
    assertNoKey(result.stderr);
  } finally {
    repo.cleanup();
  }
});

exclusive("jsonl scanner rejects a planted synthetic key and wrapper has no key argument", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hark-stepfun-scan-"));
  try {
    writeFileSync(path.join(dir, "session.jsonl"), `{"text":"${KEY}"}`);
    assert.throws(() => scanTreeForSecret(dir, KEY), /secret_in_output/);
    rmSync(path.join(dir, "session.jsonl"));
    writeFileSync(path.join(dir, "session.jsonl"), "{\"text\":\"synthetic-only\"}\n");
    assert.doesNotThrow(() => scanTreeForSecret(dir, KEY));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const wrapper = readFileSync(wrapperPath, "utf8");
  const wrapperCode = wrapper.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
  assert.equal(wrapper.includes("set +x"), true);
  assert.equal(wrapper.includes("umask 077"), true);
  assert.equal(wrapper.includes("trap cleanup"), true);
  assert.equal(wrapper.includes("read -r -s"), true);
  assert.equal(wrapper.includes("unset HARK_STEPFUN_API_KEY"), true);
  assert.equal(wrapper.includes("env -i"), true);
  assert.equal(wrapper.includes("bash --noprofile --norc"), true);
  assert.equal(wrapper.includes("HARK_STEPFUN_CLEAN_SHELL"), true);
  assert.equal(wrapperCode.includes("--api-key"), true);
  assert.equal(wrapperCode.includes("security "), false);
  assert.equal(wrapperCode.includes("keychain"), false);
  assert.equal(wrapperCode.includes("auth.json"), false);
  assert.equal(wrapperCode.includes(".env"), false);
  assert.equal(wrapperCode.includes("printenv"), false);
  assert.equal(wrapper.includes("echo \"$HARK_STEPFUN_API_KEY\""), false);
  assert.equal(wrapper.includes("echo \"$KEY_INPUT\""), false);
  const withoutStderr = wrapper.replaceAll(">&2", "");
  assert.equal(withoutStderr.includes(">"), false);
  assert.equal(wrapper.includes(KEY), false);
  const nodeLine = wrapper.split("\n").filter((line) => line.includes("stepfun-live-check.ts") || line.trim() === "\"$@\"");
  assert.equal(nodeLine.some((line) => line.includes("$HARK_STEPFUN_API_KEY")), false);
  assert.throws(() => parseCliArgs(["--api-key", "not-a-real-key"]), /key_in_args/);
  chmodSync(wrapperPath, 0o755);
  const syntax = spawnSync("bash", ["-n", wrapperPath], { encoding: "utf8" });
  assert.equal(syntax.status, 0);
});

exclusive("summary symlink or unsafe parent is refused before fetch and does not follow outside", async () => {
  const canary = "outside-canary-do-not-touch\n";
  const repo = tempRepo();
  const outside = mkdtempSync(path.join(tmpdir(), "hark-stepfun-outside-"));
  const canaryPath = path.join(outside, "canary.txt");
  writeFileSync(canaryPath, canary);
  const linkName = "handoff/EVIDENCE/r1/summary.json";
  symlinkSync(canaryPath, path.join(repo.root, linkName));
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response(null, { status: 500 });
  };
  try {
    assert.throws(() => resolveSummaryPath(repo.root, linkName), /invalid_summary_path/);
    const result = await runStepfunLiveCheck({
      apiKey: KEY,
      repoRoot: repo.root,
      summaryRelativePath: linkName,
      fetchImpl,
    });
    assert.equal(calls, 0);
    assert.equal(result.summary.code, "invalid_summary_path");
    assert.equal(result.summary.requestCount, 0);
    assert.equal(result.summaryFile, null);
    assert.equal(result.exitCode, 2);
    assert.equal(readFileSync(canaryPath, "utf8"), canary);
    assert.equal(lstatSync(path.join(repo.root, linkName)).isSymbolicLink(), true);
    assertNoKey(result.stdout);
    assertNoKey(result.stderr);
  } finally {
    repo.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

exclusive("summary parent symlink cannot receive a relative write", async () => {
  const canary = "outside-parent-canary-do-not-touch\n";
  const repo = tempRepo();
  const outside = mkdtempSync(path.join(tmpdir(), "hark-stepfun-outside-parent-"));
  const canaryPath = path.join(outside, "canary.txt");
  writeFileSync(canaryPath, canary);
  const evidence = path.join(repo.root, "handoff/EVIDENCE/r1");
  rmSync(evidence, { recursive: true, force: true });
  symlinkSync(outside, evidence);
  let calls = 0;
  try {
    const result = await runStepfunLiveCheck({
      apiKey: KEY,
      repoRoot: repo.root,
      summaryRelativePath: "handoff/EVIDENCE/r1/summary.json",
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 500 });
      },
    });
    assert.equal(calls, 0);
    assert.equal(result.summary.code, "invalid_summary_path");
    assert.equal(result.exitCode, 2);
    assert.equal(readFileSync(canaryPath, "utf8"), canary);
    assert.deepEqual(readdirSync(outside).sort(), ["canary.txt"]);
    assertNoKey(result.stdout);
  } finally {
    repo.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

exclusive("nested summary path is refused before fetch", async () => {
  const repo = tempRepo();
  let calls = 0;
  try {
    const result = await runStepfunLiveCheck({
      apiKey: KEY,
      repoRoot: repo.root,
      summaryRelativePath: "handoff/EVIDENCE/r1/nested/summary.json",
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 500 });
      },
    });
    assert.equal(calls, 0);
    assert.equal(result.summary.code, "invalid_summary_path");
    assert.equal(result.summaryFile, null);
  } finally {
    repo.cleanup();
  }
});

exclusive("post-send exception keeps guard send and status counts", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    const home = process.env.HOME;
    if (!home) throw new Error("HOME missing during guarded send");
    writeFileSync(path.join(home, "planted-secret.json"), `{"token":"${KEY}"}`);
    return sse("text", "synthetic-offline-text");
  };
  const { result, repo } = await runOffline(fetchImpl);
  try {
    assert.ok(calls > 0);
    assert.equal(result.summary.code, "secret_in_output");
    assert.equal(result.summary.requestCount, calls);
    assert.ok(result.summary.attemptCount >= calls);
    assert.equal(result.summary.httpStatuses.length, calls);
    assert.notEqual(result.summary.requestCount, 0);
    assert.equal(result.summary.boundedLiveObservation, false);
    assert.equal(result.summary.claimsProductAcceptance, false);
    assert.equal(result.exitCode, 1);
    assertNoKey(result.stdout);
    assertNoKey(result.stderr);
    if (result.summaryFile) assertNoKey(readFileSync(result.summaryFile, "utf8"));
  } finally {
    repo.cleanup();
  }
});

exclusive("wrapper launchers do not receive the synthetic key in argv", async () => {
  assert.equal(KEY.includes("--api-key"), false);
  const probeRoot = mkdtempSync(path.join(tmpdir(), "hark-stepfun-argv-probe-"));
  const spyDir = path.join(probeRoot, "bin");
  const home = path.join(probeRoot, "home");
  mkdirSync(spyDir);
  mkdirSync(home);
  const secretFile = path.join(probeRoot, "pty-secret");
  const decoyFile = path.join(probeRoot, "decoy-secret");
  const logFile = path.join(probeRoot, "argv-log");
  const decoy = "synthetic-decoy-stepfun-key-not-from-tty";
  writeFileSync(secretFile, `${KEY}\n`, { mode: 0o600 });
  writeFileSync(decoyFile, `${decoy}\n`, { mode: 0o600 });
  const recordPy = path.join(probeRoot, "record.py");
  const matchPy = path.join(probeRoot, "match.py");
  writeFileSync(recordPy, [
    "import json, os, sys",
    "launcher, log = sys.argv[1], sys.argv[2]",
    "secret = open(os.environ['HARK_PROBE_SECRET_FILE'], encoding='utf-8').read().strip('\\n')",
    "decoy = open(os.environ['HARK_PROBE_DECOY_FILE'], encoding='utf-8').read().strip('\\n')",
    "argv = sys.argv[3:]",
    "blob = '\\n'.join(argv)",
    "leak = secret in blob or decoy in blob",
    "def red(value):",
    "    return value.replace(secret, '[SECRET]').replace(decoy, '[DECOY]')",
    "row = {'launcher': launcher, 'leak': leak, 'checked_secret': True, 'argv': [red(item) for item in argv]}",
    "with open(log, 'a', encoding='utf-8') as handle:",
    "    handle.write(json.dumps(row) + '\\n')",
    "",
  ].join("\n"));
  writeFileSync(matchPy, [
    "import json, os, sys",
    "log = sys.argv[1]",
    "secret = open(os.environ['HARK_PROBE_SECRET_FILE'], encoding='utf-8').read().strip('\\n')",
    "decoy = open(os.environ['HARK_PROBE_DECOY_FILE'], encoding='utf-8').read().strip('\\n')",
    "got = os.environ.get('HARK_STEPFUN_API_KEY', '')",
    "row = {'launcher': 'node-env', 'match_pty': int(got == secret), 'match_decoy': int(got == decoy)}",
    "with open(log, 'a', encoding='utf-8') as handle:",
    "    handle.write(json.dumps(row) + '\\n')",
    "",
  ].join("\n"));
  const spy = (name: string, tail: string) => {
    const file = path.join(spyDir, name);
    const body = [
      "#!/bin/bash",
      "set +x",
      "set -eu",
      `export HARK_PROBE_SECRET_FILE=${JSON.stringify(secretFile)}`,
      `export HARK_PROBE_DECOY_FILE=${JSON.stringify(decoyFile)}`,
      `python3 ${JSON.stringify(recordPy)} ${name} ${JSON.stringify(logFile)} "$@"`,
      tail,
      "",
    ].join("\n");
    writeFileSync(file, body, { mode: 0o700 });
    chmodSync(file, 0o700);
  };
  spy("env", "exec /usr/bin/env \"$@\"");
  spy("bash", "exec /bin/bash \"$@\"");
  spy("node", `python3 ${JSON.stringify(matchPy)} ${JSON.stringify(logFile)}\nexit 0`);
  const py = path.join(probeRoot, "pty-probe.py");
  writeFileSync(py, [
    "import os, pty, select, subprocess, sys, termios, time",
    "wrapper, spy, home, secret_file, decoy_file = sys.argv[1:6]",
    "secret = open(secret_file, encoding='utf-8').read().strip('\\n')",
    "decoy = open(decoy_file, encoding='utf-8').read().strip('\\n')",
    "env = {",
    "    'PATH': spy + os.pathsep + os.environ.get('PATH', ''),",
    "    'HOME': home,",
    "    'TMPDIR': os.environ.get('TMPDIR', '/tmp'),",
    "    'LANG': 'C.UTF-8',",
    "    'TERM': 'xterm-256color',",
    "    'HARK_STEPFUN_API_KEY': decoy,",
    "    'HARK_PROBE_SECRET_FILE': secret_file,",
    "    'HARK_PROBE_DECOY_FILE': decoy_file,",
    "}",
    "master, slave = pty.openpty()",
    "attrs = termios.tcgetattr(master)",
    "attrs[3] = attrs[3] & ~termios.ECHO",
    "termios.tcsetattr(master, termios.TCSANOW, attrs)",
    "proc = subprocess.Popen(['/bin/bash', wrapper], stdin=slave, stdout=slave, stderr=slave, env=env, close_fds=True)",
    "os.close(slave)",
    "os.write(master, (secret + '\\n').encode())",
    "deadline = time.time() + 15",
    "buf = b''",
    "while time.time() < deadline:",
    "    if proc.poll() is not None:",
    "        break",
    "    ready, _, _ = select.select([master], [], [], 0.2)",
    "    if master in ready:",
    "        try:",
    "            chunk = os.read(master, 4096)",
    "        except OSError:",
    "            break",
    "        if not chunk:",
    "            break",
    "        buf += chunk",
    "rc = proc.wait(timeout=5)",
    "while True:",
    "    ready, _, _ = select.select([master], [], [], 0.1)",
    "    if not ready:",
    "        break",
    "    try:",
    "        chunk = os.read(master, 4096)",
    "    except OSError:",
    "        break",
    "    if not chunk:",
    "        break",
    "    buf += chunk",
    "sys.stdout.buffer.write(buf)",
    "sys.exit(rc)",
    "",
  ].join("\n"));
  try {
    const child = spawnSync("python3", [py, wrapperPath, spyDir, home, secretFile, decoyFile], {
      encoding: "utf8",
      timeout: 20_000,
    });
    const transcript = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
    const shown = transcript.replaceAll(KEY, "[SECRET]").replaceAll(decoy, "[DECOY]");
    assert.equal(child.status, 0, shown);
    assert.equal(transcript.includes(KEY), false, shown);
    assert.equal(transcript.includes(decoy), false, shown);
    const log = readFileSync(logFile, "utf8");
    assert.equal(log.includes(KEY), false);
    assert.equal(log.includes(decoy), false);
    assert.equal(log.includes("[SECRET]"), false);
    assert.equal(log.includes("[DECOY]"), false);
    const rows = log.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line) as {
      launcher: string;
      leak?: boolean;
      argv?: string[];
      match_pty?: number;
      match_decoy?: number;
      checked_secret?: boolean;
    });
    const launchers = rows.filter((row) => row.launcher === "env" || row.launcher === "bash" || row.launcher === "node");
    assert.equal(launchers.length > 0, true);
    for (const row of launchers) {
      assert.equal(row.checked_secret, true);
      assert.equal(row.leak, false);
      assert.equal((row.argv ?? []).some((arg) => arg.includes(KEY) || arg.includes("--api-key")), false);
    }
    assert.equal(launchers.some((row) => row.launcher === "env"), true);
    assert.equal(launchers.some((row) => row.launcher === "bash" && (row.argv ?? []).includes("--noprofile") && (row.argv ?? []).includes("--norc")), true);
    assert.equal(launchers.some((row) => row.launcher === "node"), true);
    const nodeEnv = rows.find((row) => row.launcher === "node-env");
    assert.equal(nodeEnv?.match_pty, 1);
    assert.equal(nodeEnv?.match_decoy, 0);
  } finally {
    rmSync(probeRoot, { recursive: true, force: true });
  }
});

exclusive("existing summary file is refused before fetch", async () => {
  const repo = tempRepo();
  const target = path.join(repo.root, repo.summary);
  const original = "existing-summary-canary\n";
  writeFileSync(target, original);
  let calls = 0;
  try {
    const result = await runStepfunLiveCheck({
      apiKey: KEY,
      repoRoot: repo.root,
      summaryRelativePath: repo.summary,
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, { status: 500 });
      },
    });
    assert.equal(calls, 0);
    assert.equal(result.summary.code, "invalid_summary_path");
    assert.equal(result.summaryFile, null);
    assert.equal(readFileSync(target, "utf8"), original);
    assertNoKey(result.stdout);
  } finally {
    repo.cleanup();
  }
});

exclusive("exclusive summary write does not follow a final symlink", async () => {
  const outside = mkdtempSync(path.join(tmpdir(), "hark-stepfun-write-outside-"));
  const dir = mkdtempSync(path.join(tmpdir(), "hark-stepfun-write-dir-"));
  const canaryPath = path.join(outside, "canary.txt");
  const canary = "write-canary-do-not-touch\n";
  writeFileSync(canaryPath, canary);
  const link = path.join(dir, "summary.json");
  symlinkSync(canaryPath, link);
  const regular = path.join(dir, "exists.json");
  writeFileSync(regular, canary);
  try {
    assert.throws(() => writeBoundedSummary(link, "{}\n"), /summary_refused/);
    assert.equal(readFileSync(canaryPath, "utf8"), canary);
    assert.throws(() => writeBoundedSummary(regular, "{}\n"), /summary_refused/);
    assert.equal(readFileSync(regular, "utf8"), canary);
    const fresh = path.join(dir, "fresh.json");
    writeBoundedSummary(fresh, "{}\n");
    assert.equal(readFileSync(fresh, "utf8"), "{}\n");
    assert.equal(lstatSync(fresh).isSymbolicLink(), false);
    assert.equal(lstatSync(fresh).mode & 0o777, 0o600);
  } finally {
    rmSync(outside, { recursive: true, force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

exclusive("cli refuses a missing key without inheriting ambient credentials", async () => {
  const summaryName = `stepfun-live-check-cli-offline-${process.pid}-${Date.now()}.json`;
  const summaryPath = path.join(repoRoot, "handoff/EVIDENCE/r1", summaryName);
  const child = spawnSync(process.execPath, [
    "--experimental-strip-types",
    scriptPath,
    "--summary",
    `handoff/EVIDENCE/r1/${summaryName}`,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH ?? "",
      TMPDIR: process.env.TMPDIR ?? "/tmp",
      STEPFUN_API_KEY: KEY,
      HTTPS_PROXY: "http://127.0.0.1:9",
    },
  });
  try {
    assert.equal(child.status, 2);
    assert.equal(child.stderr.includes("missing_key"), true);
    assertNoKey(child.stdout);
    assertNoKey(child.stderr);
    assert.equal(child.stdout.includes("STEPFUN_API_KEY"), false);
    if (child.stdout.length > 0) {
      const summary = JSON.parse(child.stdout) as { code?: string; liveTransport?: boolean };
      assert.equal(summary.code, "missing_key");
      assert.equal(summary.liveTransport, false);
    }
  } finally {
    rmSync(summaryPath, { force: true });
  }
});
