import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { installOutboundGuard, type OutboundGuard } from "./outbound-guard.ts";

const PROMPT = "smoke-prompt-isolated-local";
const FAUX_REPLY = "smoke-faux-reply-not-stepfun";
const AGENTS_SENTINEL = "MALICIOUS_AGENTS_SENTINEL_DO_NOT_LOAD";
const EXTENSION_MARKER = "EXTENSION_EXECUTED_MARKER";

const SENSITIVE_ENV = /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AWS_|GOOGLE_|ANTHROPIC|OPENAI|OPENROUTER|MOONSHOT|XAI_|ZAI_)/i;

let restoreEnv: () => void = () => {};
let guard: OutboundGuard | undefined;
let tempRoot = "";
let projectRoot = "";
let agentDir = "";
let sessionDir = "";

function blankSensitiveEnv(): () => void {
  const saved = new Map<string, string | undefined>();
  const names = [
    ...Object.keys(process.env).filter((name) => SENSITIVE_ENV.test(name)),
    "PI_TELEMETRY",
    "PI_OFFLINE",
    "PI_CODING_AGENT_DIR",
    "PI_CODING_AGENT_SESSION_DIR",
  ];
  for (const name of new Set(names)) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

function plantUntrustedProject(root: string): void {
  mkdirSync(path.join(root, ".pi", "extensions"), { recursive: true });
  mkdirSync(path.join(root, ".pi", "skills", "evil"), { recursive: true });
  writeFileSync(
    path.join(root, ".pi", "extensions", "evil.js"),
    `import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./${EXTENSION_MARKER}", import.meta.url), "executed\\n");\nexport default function () {}\n`,
  );
  writeFileSync(
    path.join(root, ".pi", "settings.json"),
    JSON.stringify({
      extensions: [".pi/extensions/evil.js"],
      defaultTools: ["read", "bash", "edit", "write"],
      enableInstallTelemetry: true,
      cacheWarming: "streaming",
      compaction: { enabled: true },
    }),
  );
  writeFileSync(path.join(root, ".pi", "mcp.json"), JSON.stringify({ mcpServers: { evil: { command: "echo" } } }));
  writeFileSync(path.join(root, ".pi", "skills", "evil", "SKILL.md"), "# evil skill\n");
  writeFileSync(path.join(root, "AGENTS.md"), `# ignore\n${AGENTS_SENTINEL}\n`);
  writeFileSync(path.join(root, "CLAUDE.md"), AGENTS_SENTINEL);
}

function toolNames(session: {
  getAllTools: () => Array<{ name: string }>;
  getActiveToolNames: () => string[];
  getCallableToolNames: () => string[];
}): { all: string[]; active: string[]; callable: string[] } {
  return {
    all: session.getAllTools().map((tool) => tool.name),
    active: session.getActiveToolNames(),
    callable: session.getCallableToolNames(),
  };
}

function assertNoForbiddenTools(names: string[], label: string): void {
  const forbidden = ["read", "bash", "edit", "write", "grep", "find", "ls", "powershell"];
  for (const name of names) {
    assert.equal(forbidden.includes(name), false, `${label} still exposes ${name}`);
    assert.equal(name.startsWith("mcp__"), false, `${label} still exposes MCP tool ${name}`);
  }
}

function userTexts(messages: readonly { role: string; content?: unknown }[]): string[] {
  return messages
    .filter((message) => message.role === "user")
    .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content)));
}

before(() => {
  restoreEnv = blankSensitiveEnv();
  tempRoot = mkdtempSync(path.join(tmpdir(), "hark-pi-smoke-"));
  projectRoot = path.join(tempRoot, "project");
  agentDir = path.join(tempRoot, "agent");
  sessionDir = path.join(tempRoot, "sessions");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  plantUntrustedProject(projectRoot);
  guard = installOutboundGuard(tempRoot, projectRoot);
});

after(() => {
  guard?.restore();
  restoreEnv();
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

test("isolated Pi SDK session stays off built-ins, project resources, and the network", async () => {
  assert.ok(guard);
  const recordsBefore = guard.records.length;
  const sdk = await import("@earendil-works/pi-coding-agent");
  const ai = await import("@earendil-works/pi-ai");
  const host = await import("../src/index.ts");

  assert.equal(sdk.VERSION, "1.5.0");
  const childProcess = await import("node:child_process");
  assert.throws(() => childProcess.spawn("isolated-smoke-should-not-spawn"), /blocked spawn/);
  await assert.rejects(globalThis.fetch("https://example.invalid/smoke-guard"), /blocked fetch/);
  const lockPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../package-lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
    packages?: Record<string, { version?: string }>;
  };
  for (const [name, entry] of Object.entries(lock.packages ?? {})) {
    const match = name.match(/(?:^|\/)node_modules\/(@earendil-works\/[^/]+)$/);
    if (match) {
      assert.equal(entry.version, "1.5.0", `${match[1]} is not locked to 1.5.0`);
    }
  }

  const faux = ai.fauxProvider();
  let declaredTools: string[] = [];
  faux.setResponses([
    (context) => {
      const system = context.messages.find((message) => message.role === "system");
      declaredTools = system?.role === "system" ? (system.toolsAdded ?? []).map((tool) => tool.name) : [];
      return ai.fauxAssistantMessage(FAUX_REPLY);
    },
  ]);

  const runtime = await host.createIsolatedModelRuntime(faux);
  await host.settleIsolatedRuntime(runtime);
  const model = host.requireRegisteredFauxModel(runtime, faux);
  assert.equal(model.provider, "faux");
  assert.notEqual(model.provider, "stepfun");

  const created = await host.createIsolatedPiSession({
    cwd: projectRoot,
    agentDir,
    sessionDir,
    modelRuntime: runtime,
    model,
  });
  try {
    const names = toolNames(created.session);
    assert.deepEqual(names.all, [host.SMOKE_TOOL_NAME]);
    assert.deepEqual(names.active, [host.SMOKE_TOOL_NAME]);
    assert.deepEqual(names.callable, [host.SMOKE_TOOL_NAME]);
    assertNoForbiddenTools([...names.all, ...names.active, ...names.callable], "allowlist session");
    assert.equal(created.extensionsResult.extensions.length, 0);
    assert.equal(created.resourceLoader.getAgentsFiles().agentsFiles.length, 0);
    assert.equal(created.resourceLoader.getSkills().skills.length, 0);
    assert.equal(created.settingsManager.getCompactionEnabled(), false);
    assert.equal(created.settingsManager.getRetryEnabled(), false);
    assert.equal(created.settingsManager.getCacheWarmingMode(), "off");
    assert.equal(created.settingsManager.getSettings().enableInstallTelemetry, false);
    assert.equal(created.session.systemPrompt.includes(host.ISOLATED_SYSTEM_PROMPT), true);
    assert.equal(created.session.systemPrompt.includes(AGENTS_SENTINEL), false);
    assert.equal(guard.real.existsSync(path.join(projectRoot, ".pi", "extensions", EXTENSION_MARKER)), false);
    assert.equal(guard.real.existsSync(path.join(agentDir, "auth.json")), false);
    assert.equal(guard.real.existsSync(path.join(agentDir, "models.json")), false);

    await created.session.prompt(PROMPT);
    assert.equal(faux.state.callCount, 1);
    assert.equal(created.session.getLastAssistantText(), FAUX_REPLY);
    assert.deepEqual(declaredTools, [host.SMOKE_TOOL_NAME]);
    assertNoForbiddenTools(declaredTools, "faux transcript tools");

    const sessionFile = created.session.sessionFile;
    assert.equal(typeof sessionFile, "string");
    assert.ok(sessionFile);
    assert.equal(sessionFile.startsWith(`${sessionDir}${path.sep}`), true);
    assert.equal(sessionFile.includes(`${path.sep}.pi${path.sep}agent${path.sep}sessions`), false);
    const persisted = guard.real.readFileSync(sessionFile, "utf8");
    const lines = persisted.split("\n").filter((line) => line.length > 0);
    const entries = lines.map((line) => JSON.parse(line) as { type?: string; cwd?: string; message?: { role?: string; provider?: string } });
    assert.equal(entries[0]?.type, "session");
    assert.equal(entries[0]?.cwd, projectRoot);
    const userEntries = entries.filter((entry) => entry.type === "message" && entry.message?.role === "user");
    const assistantEntries = entries.filter((entry) => entry.type === "message" && entry.message?.role === "assistant");
    assert.equal(userEntries.length, 1);
    assert.equal(assistantEntries.length, 1);
    assert.equal(assistantEntries[0]?.message?.provider, "faux");
    assert.notEqual(assistantEntries[0]?.message?.provider, "stepfun");
    assert.equal(persisted.includes(PROMPT), true);
    assert.equal(persisted.split(PROMPT).length - 1, 1);
    const beforeRestoreBytes = guard.real.statSync(sessionFile).size;
    const beforeRestoreMessages = userTexts(created.session.messages);
    created.session.dispose();

    const restoredManager = host.openControlledSession(sessionFile, sessionDir);
    const restored = await host.createIsolatedPiSession({
      cwd: projectRoot,
      agentDir,
      sessionDir,
      modelRuntime: runtime,
      model,
      sessionManager: restoredManager,
    });
    try {
      const restoredUsers = userTexts(restored.session.messages);
      assert.deepEqual(restoredUsers, beforeRestoreMessages);
      assert.equal(restoredUsers.filter((text) => text.includes(PROMPT)).length, 1);
      assert.equal(guard.real.statSync(sessionFile).size, beforeRestoreBytes);
      assert.equal(guard.real.readFileSync(sessionFile, "utf8").split(PROMPT).length - 1, 1);
      const restoredNames = toolNames(restored.session);
      assert.deepEqual(restoredNames.all, [host.SMOKE_TOOL_NAME]);
      assertNoForbiddenTools([...restoredNames.all, ...restoredNames.active, ...restoredNames.callable], "restored session");
    } finally {
      restored.session.dispose();
    }

    const builtinProbe = await sdk.createAgentSession({
      cwd: projectRoot,
      agentDir,
      model,
      thinkingLevel: "off",
      modelRuntime: runtime,
      resourceLoader: host.createEmptyResourceLoader(),
      settingsManager: host.createIsolatedSettings(),
      sessionManager: sdk.SessionManager.create(projectRoot, sessionDir),
      noTools: "builtin",
      customTools: [host.createSmokeNoopTool()],
    });
    try {
      const builtinNames = toolNames(builtinProbe.session);
      assert.equal(builtinNames.all.includes("read"), true);
      assert.equal(builtinNames.all.includes("bash"), true);
      assert.equal(builtinNames.all.includes(host.SMOKE_TOOL_NAME), true);
    } finally {
      builtinProbe.session.dispose();
    }

    const allProbe = await sdk.createAgentSession({
      cwd: projectRoot,
      agentDir,
      model,
      thinkingLevel: "off",
      modelRuntime: runtime,
      resourceLoader: host.createEmptyResourceLoader(),
      settingsManager: host.createIsolatedSettings(),
      sessionManager: sdk.SessionManager.create(projectRoot, sessionDir),
      noTools: "all",
      customTools: [host.createSmokeNoopTool()],
    });
    try {
      const allNames = toolNames(allProbe.session);
      assert.equal(allNames.all.includes(host.SMOKE_TOOL_NAME), false);
      assert.equal(allNames.all.includes("read"), false);
      assert.equal(allNames.active.length, 0);
    } finally {
      allProbe.session.dispose();
    }

    await assert.rejects(() =>
      host.createIsolatedPiSession({
        cwd: path.join(homedir(), ".pi", "agent"),
        agentDir,
        sessionDir,
        modelRuntime: runtime,
        model,
      }),
    );

    assert.equal(guard.real.existsSync(path.join(projectRoot, ".pi", "extensions", EXTENSION_MARKER)), false);
    assert.equal(guard.real.existsSync(path.join(agentDir, "auth.json")), false);
    assert.equal(guard.real.existsSync(path.join(agentDir, "models.json")), false);
    assert.equal(guard.real.existsSync(path.join(agentDir, "settings.json")), false);

    await host.settleIsolatedRuntime(runtime);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const fresh = guard.records.slice(recordsBefore);
    const network = fresh.filter((record) =>
      (record.kind === "fetch" || record.kind === "socket" || record.kind === "http" || record.kind === "dns") &&
      record.detail !== "https://example.invalid/smoke-guard",
    );
    assert.equal(fresh.some((record) => record.kind === "fetch" && record.detail === "https://example.invalid/smoke-guard"), true);
    const spawned = fresh.filter((record) => record.kind === "spawn" && record.detail !== "isolated-smoke-should-not-spawn");
    assert.equal(fresh.some((record) => record.kind === "spawn" && record.detail === "isolated-smoke-should-not-spawn"), true);
    const piGlobal = fresh.filter((record) => record.kind === "pi-global");
    const vault = fresh.filter((record) => record.kind === "vault");
    const discovery = fresh.filter((record) => record.kind === "project-discovery");
    assert.deepEqual(network, [], `network attempts: ${JSON.stringify(network)}`);
    assert.deepEqual(spawned, [], `spawn attempts: ${JSON.stringify(spawned)}`);
    assert.deepEqual(piGlobal, [], `global Pi directory probes: ${JSON.stringify(piGlobal)}`);
    assert.deepEqual(vault, [], `private vault probes: ${JSON.stringify(vault)}`);
    assert.deepEqual(discovery, [], `project resource discovery: ${JSON.stringify(discovery)}`);
    const ambient = fresh.filter((record) => record.kind === "ambient-credential");
    assert.ok(
      ambient.every((record) => record.detail === "application_default_credentials.json"),
      `unexpected ambient credential probe: ${JSON.stringify(ambient)}`,
    );
    console.log(JSON.stringify({
      piSdk: sdk.VERSION,
      provider: "faux",
      fauxIsNotStepFun: true,
      providerHttpPayload: "untested",
      networkAttempts: network.length,
      spawnAttempts: spawned.length,
      piGlobalProbes: piGlobal.length,
      vaultProbes: vault.length,
      projectDiscoveryReads: discovery.length,
      ambientAdcDeniedWithoutOpen: ambient.length,
      extensionExecuted: false,
      jsonlRestoredWithoutReinjection: true,
    }));
  } finally {
    created.session.dispose();
  }
});
