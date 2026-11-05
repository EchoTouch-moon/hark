import { ModelRuntime, SessionManager, SettingsManager, createAgentSession } from "@earendil-works/pi-coding-agent";
import type { FauxProviderHandle, Model } from "@earendil-works/pi-ai";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { createEmptyResourceLoader } from "./empty-resource-loader.ts";
import { createMemoryCredentialStore } from "./memory-credentials.ts";
import { SMOKE_TOOL_NAME, createSmokeNoopTool } from "./smoke-tool.ts";

const PRIVATE_VAULT_SEGMENTS = ["personal-vault", "memory-vault"] as const;

const absolutePathSchema = z.string().min(1).refine((value) => path.isAbsolute(value), {
  message: "path must be absolute",
});

export interface IsolatedSessionInput {
  cwd: string;
  agentDir: string;
  sessionDir: string;
  modelRuntime: ModelRuntime;
  model: Model<string>;
  sessionManager?: SessionManager;
}

function assertControlledDirectory(label: string, value: string): string {
  const parsed = absolutePathSchema.parse(value);
  const normalized = path.resolve(parsed);
  const homePi = path.resolve(os.homedir(), ".pi");
  if (normalized === homePi || normalized.startsWith(`${homePi}${path.sep}`)) {
    throw new Error(`${label} must not be under the global Pi agent directory`);
  }
  const segments = new Set(normalized.split(path.sep));
  for (const vault of PRIVATE_VAULT_SEGMENTS) {
    if (segments.has(vault)) {
      throw new Error(`${label} must not point at a private vault`);
    }
  }
  return normalized;
}

function assertInside(parent: string, child: string, label: string): void {
  if (child !== parent && !child.startsWith(`${parent}${path.sep}`)) {
    throw new Error(`${label} must stay inside the controlled directory`);
  }
}

/**
 * Runtime that does not read global auth/models and does not start a network catalog refresh.
 * `registerNativeProvider` still schedules an offline availability refresh. That refresh can
 * `fileExists` the Vertex ADC path through Pi's default auth context. It must not be treated as
 * a network call, and callers that need a hard deny should gate filesystem access outside the SDK.
 */
export async function createIsolatedModelRuntime(faux: FauxProviderHandle): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({
    credentials: createMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  runtime.registerNativeProvider(faux.provider);
  return runtime;
}

export function createIsolatedSettings(): SettingsManager {
  return SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
    cacheWarming: "off",
    enableInstallTelemetry: false,
  });
}

/** Wait for the SDK's offline refresh without enabling network catalog updates. */
export async function settleIsolatedRuntime(runtime: ModelRuntime): Promise<void> {
  await runtime.refresh({ allowNetwork: false });
}

export function requireRegisteredFauxModel(runtime: ModelRuntime, faux: FauxProviderHandle): Model<string> {
  const registered = runtime.getModel(faux.provider.id, faux.getModel().id);
  if (!registered) {
    throw new Error("faux model was not registered on the isolated runtime");
  }
  if (registered.provider === "stepfun" || registered.api === "openai-completions") {
    throw new Error("isolated smoke model must stay the faux provider, not a StepFun or OpenAI wire provider");
  }
  return registered as Model<string>;
}

/**
 * Controlled session. Tool registration is a pure name allowlist plus one capability-less tool.
 * This does not open Core paths and does not bind extensions.
 */
export async function createIsolatedPiSession(input: IsolatedSessionInput) {
  const cwd = assertControlledDirectory("cwd", input.cwd);
  const agentDir = assertControlledDirectory("agentDir", input.agentDir);
  const sessionDir = assertControlledDirectory("sessionDir", input.sessionDir);
  const sessionManager = input.sessionManager ?? SessionManager.create(cwd, sessionDir);
  if (path.resolve(sessionManager.getCwd()) !== cwd) {
    throw new Error("session manager cwd does not match the controlled cwd");
  }
  const managerDir = sessionManager.getSessionDir();
  if (managerDir !== undefined && path.resolve(managerDir) !== sessionDir) {
    throw new Error("session manager sessionDir does not match the controlled sessionDir");
  }
  const resourceLoader = createEmptyResourceLoader();
  const settingsManager = createIsolatedSettings();
  const { session, extensionsResult } = await createAgentSession({
    cwd,
    agentDir,
    model: input.model,
    thinkingLevel: "off",
    modelRuntime: input.modelRuntime,
    resourceLoader,
    settingsManager,
    sessionManager,
    tools: [SMOKE_TOOL_NAME],
    customTools: [createSmokeNoopTool()],
  });
  if (extensionsResult.extensions.length !== 0 || extensionsResult.errors.length !== 0) {
    session.dispose();
    throw new Error("isolated session discovered or failed while loading extensions");
  }
  return { session, sessionManager, resourceLoader, settingsManager, extensionsResult };
}

/** Open an existing JSONL session. Does not append or re-inject messages. */
export function openControlledSession(sessionFile: string, sessionDir: string): SessionManager {
  const file = assertControlledDirectory("sessionFile", sessionFile);
  const dir = assertControlledDirectory("sessionDir", sessionDir);
  assertInside(dir, file, "sessionFile");
  return SessionManager.open(file, dir);
}
