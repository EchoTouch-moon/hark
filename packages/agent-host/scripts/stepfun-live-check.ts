/**
 * User-started bounded StepFun check.
 * Reuses HostRuntime and the production Pi loop. This file is not a second agent loop,
 * not a Rust closed loop, and must not be treated as product acceptance.
 * Offline tests inject fetch. The CLI does not read ambient keys or call the network
 * unless the user starts the wrapper and supplies HARK_STEPFUN_API_KEY for this process.
 */
import { closeSync, constants, existsSync, fchmodSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, unlinkSync, writeSync, type Stats } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { providerConfigSchema, type ProviderConfig } from "../src/dto.ts";
import { installCredentialPathDeny } from "../src/credentials/path-deny.ts";
import { encodeFrame, mintId, NdjsonParser, type Frame } from "../src/ipc.ts";

export const STEPFUN_LIVE_MODEL = "step-3.7-flash";
export const STEPFUN_LIVE_BASE_URL = "https://api.stepfun.com/v1";
export const STEPFUN_LIVE_ENDPOINT = "https://api.stepfun.com/v1/chat/completions";
export const STEPFUN_LIVE_MAX_REQUESTS = 3;
export const STEPFUN_LIVE_MAX_OUTPUT_TOKENS = 512;
export const STEPFUN_LIVE_TOOL = "workspace.read_file";
export const SYNTHETIC_README_PATH = "README.md";
export const SYNTHETIC_INPUT_MARKER = "synthetic-hark-stepfun-live-check";
export const SUMMARY_PREFIX = "handoff/EVIDENCE/r1/";
export const DEFAULT_SUMMARY_RELATIVE = "handoff/EVIDENCE/r1/stepfun-live-check-summary.json";

const DEDICATED_KEY_ENV = "HARK_STEPFUN_API_KEY";
const RUN_DEADLINE_MS = 90_000;
const FETCH_TIMEOUT_MS = 60_000;
const FORCED_TOOL_CHOICE = {
  type: "function",
  function: { name: STEPFUN_LIVE_TOOL },
} as const;

const AMBIENT_ENV = /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AWS_|GOOGLE_|ANTHROPIC|OPENAI|OPENROUTER|MOONSHOT|XAI_|ZAI_|STEPFUN|PROXY)/i;
const EXTRA_ENV = [
  "NODE_OPTIONS",
  "NODE_DEBUG",
  "PI_CODING_AGENT_DIR",
  "PI_AGENT_DIR",
  "PI_SESSION_DIR",
  "CLAUDE_CONFIG_DIR",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
];
const DENIED_BODY_KEYS = new Set(["metadata", "web_search", "search", "plugins", "documents", "file_search"]);
const KNOWN_CODES = new Set([
  "missing_key",
  "invalid_key",
  "key_in_args",
  "invalid_args",
  "invalid_summary_path",
  "budget_exceeded",
  "url_refused",
  "redirect_refused",
  "http_401",
  "http_403",
  "http_429",
  "http_status",
  "network_error",
  "protocol_error",
  "timeout",
  "incomplete",
  "check_failed",
  "secret_in_output",
  "summary_refused",
  "fatal_stop",
  "ok",
]);

export class StepfunLiveError extends Error {
  readonly code: string;
  readonly status: number | null;

  constructor(code: string, status: number | null = null) {
    super(code);
    this.name = "StepfunLiveError";
    this.code = code;
    this.status = status;
  }
}

export interface GuardCall {
  url: string;
  redirect: string;
  model: string;
  maxTokens: number;
  maxCompletionTokens: number;
  toolChoice: "forced-none" | "forced-read-file";
  stream: boolean;
}

export interface GuardState {
  attempts: number;
  sends: number;
  blocked: number;
  fatal: boolean;
  fatalCode: string | null;
  status: number | null;
  statuses: number[];
  calls: GuardCall[];
  refusedPath: string | null;
}

export interface StepfunFetchGuard {
  fetch: typeof fetch;
  state: GuardState;
}

export type Verdict = "pass" | "fail" | "incomplete" | "not-run";

export interface LiveSummary {
  schema: "hark.stepfun-live-check.v1";
  model: typeof STEPFUN_LIVE_MODEL;
  endpoint: typeof STEPFUN_LIVE_ENDPOINT;
  endpointProven: false;
  endpointStatus: "pending-live";
  maxRequests: typeof STEPFUN_LIVE_MAX_REQUESTS;
  requestCount: number;
  attemptCount: number;
  blockedAttempts: number;
  tokenCap: typeof STEPFUN_LIVE_MAX_OUTPUT_TOKENS;
  tokenCapFields: ["max_tokens", "max_completion_tokens"];
  tokenCapForced: true;
  httpStatuses: number[];
  redirect: "error";
  autoRetry: false;
  backupModel: false;
  firstText: {
    verdict: Verdict;
    httpStatus: number | null;
    sawStreamDelta: boolean;
    toolChoice: "forced-none" | "not-sent";
  };
  tool: {
    verdict: Verdict;
    selection: "forced" | "not-sent";
    toolName: typeof STEPFUN_LIVE_TOOL | null;
    followUpToolChoice: "forced-none" | "not-sent";
    httpStatuses: number[];
    readFileRequests: number;
  };
  syntheticInputMarker: typeof SYNTHETIC_INPUT_MARKER;
  realProjectRead: false;
  rustJointClosedLoop: false;
  claimsProductAcceptance: false;
  liveTransport: boolean;
  boundedLiveObservation: boolean;
  code: string;
  status: number | null;
  refusedPath: string | null;
}

export interface LiveCheckOptions {
  apiKey: string | undefined;
  repoRoot: string;
  summaryRelativePath?: string;
  fetchImpl?: typeof fetch;
  runTimeoutMs?: number;
}

export interface LiveCheckResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  summary: LiveSummary;
  summaryFile: string | null;
}

function stable(code: string, status: number | null = null): StepfunLiveError {
  if (!KNOWN_CODES.has(code)) return new StepfunLiveError("protocol_error", status);
  return new StepfunLiveError(code, status);
}

export function scrubAmbientProcessEnv(): void {
  for (const name of Object.keys(process.env)) {
    if (AMBIENT_ENV.test(name) || EXTRA_ENV.includes(name)) delete process.env[name];
  }
  process.env.NODE_USE_ENV_PROXY = "0";
}

export function assertArgsDoNotCarryKey(argv: readonly string[], apiKey: string | undefined): void {
  for (const arg of argv) {
    if (arg === "--api-key" || arg.startsWith("--api-key=") || arg.startsWith(`${DEDICATED_KEY_ENV}=`)) {
      throw stable("key_in_args");
    }
    if (apiKey && apiKey.length > 0 && arg.includes(apiKey)) throw stable("key_in_args");
  }
}

export function parseCliArgs(argv: readonly string[]): { summaryRelativePath: string } {
  assertArgsDoNotCarryKey(argv, undefined);
  if (argv.length === 0) return { summaryRelativePath: DEFAULT_SUMMARY_RELATIVE };
  if (argv.length === 2 && argv[0] === "--summary" && argv[1] && !argv[1].startsWith("-")) {
    return { summaryRelativePath: argv[1] };
  }
  throw stable("invalid_args");
}

const SUMMARY_BASENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.json$/;

function lstatOrNull(target: string): Stats | null {
  try {
    return lstatSync(target);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") return null;
    throw stable("invalid_summary_path");
  }
}

function assertRealDirectory(target: string): void {
  const stat = lstatOrNull(target);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) throw stable("invalid_summary_path");
}

export function resolveSummaryPath(repoRoot: string, relativePath: string): string {
  if (path.isAbsolute(relativePath) || relativePath.includes("\0") || relativePath.includes("\\")) {
    throw stable("invalid_summary_path");
  }
  const parts = relativePath.split("/");
  if (parts.length !== 4 || parts[0] !== "handoff" || parts[1] !== "EVIDENCE" || parts[2] !== "r1") {
    throw stable("invalid_summary_path");
  }
  const base = parts[3] ?? "";
  if (!SUMMARY_BASENAME.test(base) || base.includes("..")) throw stable("invalid_summary_path");
  const root = path.resolve(repoRoot);
  if (root.split(path.sep).some((part) => part === "personal-vault" || part === "memory-vault")) {
    throw stable("invalid_summary_path");
  }
  assertRealDirectory(root);
  let evidence = root;
  for (const part of ["handoff", "EVIDENCE", "r1"]) {
    evidence = path.join(evidence, part);
    assertRealDirectory(evidence);
  }
  const target = path.join(evidence, base);
  if (path.dirname(target) !== evidence) throw stable("invalid_summary_path");
  if (lstatOrNull(target)) throw stable("invalid_summary_path");
  return target;
}

export function scanTreeForSecret(root: string, secret: string): void {
  if (secret.length === 0 || !existsSync(root)) return;
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries: Array<{ name: string; isSymbolicLink: () => boolean; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = readdirSync(current, { withFileTypes: true }).map((entry) => ({
        name: String(entry.name),
        isSymbolicLink: () => entry.isSymbolicLink(),
        isDirectory: () => entry.isDirectory(),
        isFile: () => entry.isFile(),
      }));
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.name.includes(secret)) throw stable("secret_in_output");
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
        continue;
      }
      if (!entry.isFile()) continue;
      const interesting = entry.name.endsWith(".jsonl") || entry.name.endsWith(".json") || entry.name.endsWith(".log") || entry.name.endsWith(".txt");
      if (!interesting) continue;
      if (readFileSync(child, "utf8").includes(secret)) throw stable("secret_in_output");
    }
  }
}

function pathnameOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function toolChoiceForAttempt(attempt: number): "forced-none" | "forced-read-file" {
  return attempt === 2 ? "forced-read-file" : "forced-none";
}

function forceOutgoingBody(raw: string, attempt: number): { json: string; call: Omit<GuardCall, "url" | "redirect"> } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw stable("protocol_error");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw stable("protocol_error");
  const body = parsed as Record<string, unknown>;
  for (const key of DENIED_BODY_KEYS) {
    if (key in body) throw stable("url_refused");
  }
  body.model = STEPFUN_LIVE_MODEL;
  // Both fields stay at the hard cap. Official acceptance of the pair is unverified; do not probe to decide.
  body.max_tokens = STEPFUN_LIVE_MAX_OUTPUT_TOKENS;
  body.max_completion_tokens = STEPFUN_LIVE_MAX_OUTPUT_TOKENS;
  body.stream = true;
  const choice = toolChoiceForAttempt(attempt);
  body.tool_choice = choice === "forced-read-file" ? { ...FORCED_TOOL_CHOICE, function: { ...FORCED_TOOL_CHOICE.function } } : "none";
  const maxTokens = body.max_tokens;
  const maxCompletionTokens = body.max_completion_tokens;
  if (body.model !== STEPFUN_LIVE_MODEL) throw stable("protocol_error");
  if (typeof maxTokens !== "number" || typeof maxCompletionTokens !== "number") throw stable("protocol_error");
  if (maxTokens > STEPFUN_LIVE_MAX_OUTPUT_TOKENS || maxCompletionTokens > STEPFUN_LIVE_MAX_OUTPUT_TOKENS) {
    throw stable("protocol_error");
  }
  if (body.stream !== true) throw stable("protocol_error");
  return {
    json: JSON.stringify(body),
    call: {
      model: STEPFUN_LIVE_MODEL,
      maxTokens,
      maxCompletionTokens,
      toolChoice: choice,
      stream: true,
    },
  };
}

function statusCode(status: number): string {
  if (status === 401) return "http_401";
  if (status === 403) return "http_403";
  if (status === 429) return "http_429";
  if (status >= 300 && status < 400) return "redirect_refused";
  return "http_status";
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function mentionsRedirect(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("redirect");
}

export function createStepfunFetchGuard(inner: typeof fetch): StepfunFetchGuard {
  const state: GuardState = {
    attempts: 0,
    sends: 0,
    blocked: 0,
    fatal: false,
    fatalCode: null,
    status: null,
    statuses: [],
    calls: [],
    refusedPath: null,
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    if (state.fatal) {
      state.blocked += 1;
      throw stable("fatal_stop", state.status);
    }
    state.attempts += 1;
    if (state.attempts > STEPFUN_LIVE_MAX_REQUESTS) {
      state.fatal = true;
      state.fatalCode = "budget_exceeded";
      throw stable("budget_exceeded");
    }
    const url = requestUrl(input);
    if (url !== STEPFUN_LIVE_ENDPOINT) {
      state.fatal = true;
      state.fatalCode = "url_refused";
      state.refusedPath = pathnameOf(url);
      throw stable("url_refused");
    }
    const method = (init?.method ?? (typeof input === "object" && !(input instanceof URL) && "method" in input ? input.method : "GET")).toUpperCase();
    if (method !== "POST") {
      state.fatal = true;
      state.fatalCode = "url_refused";
      state.refusedPath = pathnameOf(url);
      throw stable("url_refused");
    }
    let forced: ReturnType<typeof forceOutgoingBody>;
    try {
      const raw = typeof init?.body === "string"
        ? init.body
        : init?.body instanceof Uint8Array
          ? Buffer.from(init.body).toString("utf8")
          : null;
      if (raw === null) throw stable("protocol_error");
      forced = forceOutgoingBody(raw, state.attempts);
    } catch (error) {
      state.fatal = true;
      state.fatalCode = error instanceof StepfunLiveError ? error.code : "protocol_error";
      throw error instanceof StepfunLiveError ? error : stable("protocol_error");
    }
    const headers = new Headers(init?.headers);
    headers.delete("content-length");
    const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    state.sends += 1;
    state.calls.push({ url, redirect: "error", ...forced.call });
    let response: Response;
    try {
      response = await inner(url, {
        method: "POST",
        headers,
        body: forced.json,
        redirect: "error",
        signal,
      });
    } catch (error) {
      state.fatal = true;
      if (isAbort(error)) {
        state.fatalCode = "timeout";
        throw stable("timeout");
      }
      if (mentionsRedirect(error)) {
        state.fatalCode = "redirect_refused";
        throw stable("redirect_refused");
      }
      state.fatalCode = "network_error";
      throw stable("network_error");
    }
    state.statuses.push(response.status);
    state.status = response.status;
    if (response.status !== 200) {
      state.fatal = true;
      const code = statusCode(response.status);
      state.fatalCode = code;
      void response.body?.cancel().catch(() => undefined);
      throw stable(code, response.status);
    }
    return response;
  };
  return { fetch: fetchImpl, state };
}

function hexId(prefix: "ws" | "run" | "root" | "msg"): string {
  return `${prefix}_${mintId("req").slice(4)}`;
}

interface SyntheticAuth {
  runId: string;
  provider: "stepfun";
  model: typeof STEPFUN_LIVE_MODEL;
  rootId: string;
  rootUpdatedAt: "root-synthetic";
  grantUpdatedAt: "grant-synthetic";
  directoryStatus: "active";
  modelGrantStatus: "active";
  current: true;
}

function syntheticAuth(runId: string): SyntheticAuth {
  return {
    runId,
    provider: "stepfun",
    model: STEPFUN_LIVE_MODEL,
    rootId: hexId("root"),
    rootUpdatedAt: "root-synthetic",
    grantUpdatedAt: "grant-synthetic",
    directoryStatus: "active",
    modelGrantStatus: "active",
    current: true,
  };
}

function syntheticOverview(auth: SyntheticAuth) {
  return {
    authorization: auth,
    sourceVersion: "src-synthetic",
    contextPackRevision: "rev-synthetic",
    overviewText: "Synthetic overview for the StepFun live-check. No personal project is mounted.",
    synthetic: true,
  };
}

function startPayload(auth: SyntheticAuth, userText: string): Record<string, unknown> {
  return {
    provider: "stepfun",
    model: STEPFUN_LIVE_MODEL,
    purpose: "conversation",
    authorization: auth,
    contextSnapshot: {
      contextPackRevision: "rev-synthetic",
      sourceVersion: "src-synthetic",
      empty: true,
      overview: "Synthetic overview for the StepFun live-check. No personal project is mounted.",
    },
    userText,
    userMessageId: hexId("msg"),
    sessionRef: null,
    handoffId: null,
    syntheticCore: true,
  };
}

interface PhaseObs {
  deltas: number;
  doneChars: number;
  readFiles: number;
  unexpectedReads: number;
  sawDone: boolean;
  frameCode: string | null;
}

function emptySummary(partial: Pick<LiveSummary, "code" | "status" | "liveTransport"> & Partial<LiveSummary>): LiveSummary {
  return {
    schema: "hark.stepfun-live-check.v1",
    model: STEPFUN_LIVE_MODEL,
    endpoint: STEPFUN_LIVE_ENDPOINT,
    endpointProven: false,
    endpointStatus: "pending-live",
    maxRequests: STEPFUN_LIVE_MAX_REQUESTS,
    requestCount: 0,
    attemptCount: 0,
    blockedAttempts: 0,
    tokenCap: STEPFUN_LIVE_MAX_OUTPUT_TOKENS,
    tokenCapFields: ["max_tokens", "max_completion_tokens"],
    tokenCapForced: true,
    httpStatuses: [],
    redirect: "error",
    autoRetry: false,
    backupModel: false,
    firstText: { verdict: "not-run", httpStatus: null, sawStreamDelta: false, toolChoice: "not-sent" },
    tool: {
      verdict: "not-run",
      selection: "not-sent",
      toolName: null,
      followUpToolChoice: "not-sent",
      httpStatuses: [],
      readFileRequests: 0,
    },
    syntheticInputMarker: SYNTHETIC_INPUT_MARKER,
    realProjectRead: false,
    rustJointClosedLoop: false,
    claimsProductAcceptance: false,
    boundedLiveObservation: false,
    refusedPath: null,
    ...partial,
  };
}

function summaryAfterStop(guard: StepfunFetchGuard, code: string, errorStatus: number | null, liveTransport: boolean): LiveSummary {
  const sends = guard.state.sends;
  const statuses = [...guard.state.statuses];
  const sent = sends > 0;
  return emptySummary({
    code,
    status: errorStatus ?? guard.state.status,
    liveTransport,
    refusedPath: guard.state.refusedPath,
    requestCount: sends,
    attemptCount: guard.state.attempts,
    blockedAttempts: guard.state.blocked,
    httpStatuses: statuses,
    firstText: {
      verdict: sent ? "incomplete" : "not-run",
      httpStatus: statuses[0] ?? null,
      sawStreamDelta: false,
      toolChoice: "not-sent",
    },
    tool: {
      verdict: sent ? "incomplete" : "not-run",
      selection: "not-sent",
      toolName: null,
      followUpToolChoice: "not-sent",
      httpStatuses: statuses.slice(1),
      readFileRequests: 0,
    },
  });
}

function publicLine(summary: LiveSummary): string {
  return `${JSON.stringify(summary)}\n`;
}

function errorLine(code: string, status: number | null): string {
  return `${JSON.stringify({ code, status })}\n`;
}

const REFUSAL_CODES = new Set(["missing_key", "invalid_key", "key_in_args", "invalid_args", "invalid_summary_path"]);

function finish(summary: LiveSummary, summaryFile: string | null, _failed: boolean): LiveCheckResult {
  const exitCode = summary.code === "ok" ? 0 : REFUSAL_CODES.has(summary.code) ? 2 : 1;
  return {
    exitCode,
    stdout: publicLine(summary),
    stderr: exitCode === 0 ? "" : errorLine(summary.code, summary.status),
    summary,
    summaryFile,
  };
}

function assertClean(text: string, secret: string): void {
  if (secret.length > 0 && text.includes(secret)) throw stable("secret_in_output");
}

async function waitFor(frames: Frame[], pred: (frame: Frame) => boolean, timeoutMs: number): Promise<Frame> {
  const started = Date.now();
  while (Date.now() - started <= timeoutMs) {
    const found = frames.find(pred);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw stable("timeout");
}

function providerConfig(apiKey: string): ProviderConfig {
  const parsed = providerConfigSchema.safeParse({
    enabled: true,
    providerId: "stepfun",
    modelId: STEPFUN_LIVE_MODEL,
    baseUrl: STEPFUN_LIVE_BASE_URL,
    apiKey,
    wire: "openai-completions",
    allowRemote: true,
  });
  if (!parsed.success || parsed.data.providerId === "faux" || parsed.data.modelId === "faux") {
    throw stable("invalid_key");
  }
  return parsed.data;
}

export async function runStepfunLiveCheck(options: LiveCheckOptions): Promise<LiveCheckResult> {
  const secret = options.apiKey ?? "";
  delete process.env[DEDICATED_KEY_ENV];
  scrubAmbientProcessEnv();
  installCredentialPathDeny();
  const summaryRelativePath = options.summaryRelativePath ?? DEFAULT_SUMMARY_RELATIVE;
  let summaryFile: string | null = null;
  try {
    summaryFile = resolveSummaryPath(options.repoRoot, summaryRelativePath);
  } catch (error) {
    const code = error instanceof StepfunLiveError ? error.code : "invalid_summary_path";
    return finish(emptySummary({ code, status: null, liveTransport: false, refusedPath: null }), null, false);
  }
  if (!options.apiKey || options.apiKey.trim().length === 0 || options.apiKey !== options.apiKey.trim()) {
    const summary = emptySummary({ code: "missing_key", status: null, liveTransport: false });
    return writeChecked(summary, summaryFile, secret, false);
  }
  if (options.apiKey.length > 512) {
    return writeChecked(emptySummary({ code: "invalid_key", status: null, liveTransport: false }), summaryFile, secret, false);
  }

  const liveTransport = options.fetchImpl === undefined;
  const previousHome = process.env.HOME;
  const previousProfile = process.env.USERPROFILE;
  const tempRoot = mkdtempSync(path.join(tmpdir(), "hark-stepfun-live-"));
  const homeDir = path.join(tempRoot, "home");
  const appDataDir = path.join(tempRoot, "app-data");
  mkdirSync(homeDir, { recursive: true });
  mkdirSync(appDataDir, { recursive: true });
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  const previousFetch = globalThis.fetch;
  const inner = options.fetchImpl ?? previousFetch;
  const guard = createStepfunFetchGuard(inner);
  globalThis.fetch = guard.fetch;
  try {
    const { HostRuntime } = await import("../src/runtime.ts");
    const config = providerConfig(options.apiKey);
    const input = new PassThrough();
    const output = new PassThrough();
    const frames: Frame[] = [];
    const parser = new NdjsonParser();
    const runTimeoutMs = Math.min(options.runTimeoutMs ?? RUN_DEADLINE_MS, 110_000);
    let activeRunId: string | null = null;
    const auths = new Map<string, SyntheticAuth>();
    const observations = new Map<string, PhaseObs>();
    const ensure = (runId: string): PhaseObs => {
      const existing = observations.get(runId);
      if (existing) return existing;
      const created: PhaseObs = { deltas: 0, doneChars: 0, readFiles: 0, unexpectedReads: 0, sawDone: false, frameCode: null };
      observations.set(runId, created);
      return created;
    };
    output.on("data", (chunk: Buffer) => {
      let parsed: Frame[] = [];
      try {
        parsed = parser.push(chunk);
      } catch {
        if (activeRunId) ensure(activeRunId).frameCode = "protocol_error";
        return;
      }
      for (const frame of parsed) {
        frames.push(frame);
        if (frame.method === "host.ready" && frame.kind === "request") {
          input.write(encodeFrame({ ...frame, kind: "response", replyTo: frame.id, payload: { synthetic: true } }));
        }
        if (frame.kind === "error" && frame.runId) ensure(frame.runId).frameCode = "protocol_error";
        if (frame.method === "stream.delta" && frame.runId) ensure(frame.runId).deltas += 1;
        if (frame.method === "stream.done" && frame.runId) {
          const obs = ensure(frame.runId);
          obs.sawDone = true;
          obs.doneChars = typeof frame.payload.text === "string" ? frame.payload.text.length : 0;
        }
        if (frame.method === "tool.request" && frame.kind === "request") {
          const tool = frame.payload.tool;
          const runId = frame.runId ?? activeRunId;
          if (!runId) continue;
          if (tool === "workspace.read_file") {
            const inputRecord = frame.payload.input;
            const relativePath = inputRecord && typeof inputRecord === "object" && "relativePath" in inputRecord
              ? String(inputRecord.relativePath)
              : "";
            const obs = ensure(runId);
            if (relativePath === SYNTHETIC_README_PATH) obs.readFiles += 1;
            else obs.unexpectedReads += 1;
            const payload = relativePath === SYNTHETIC_README_PATH
              ? {
                  relativePath: SYNTHETIC_README_PATH,
                  text: "Synthetic README for the Hark StepFun live-check. This file is not a user project.",
                  synthetic: true,
                }
              : { relativePath, text: "synthetic-unavailable", unavailable: true, synthetic: true };
            input.write(encodeFrame({ ...frame, kind: "response", replyTo: frame.id, method: "tool.result", payload }));
          } else if (tool === "workspace.overview") {
            const auth = auths.get(runId);
            if (!auth) continue;
            input.write(encodeFrame({
              ...frame,
              kind: "response",
              replyTo: frame.id,
              method: "tool.result",
              payload: syntheticOverview(auth),
            }));
          }
        }
      }
    });
    const host = new HostRuntime({
      appDataDir,
      input,
      output,
      providerConfig: config,
      fetchImpl: guard.fetch,
      log: () => undefined,
    });
    await host.start();
    await waitFor(frames, (frame) => frame.method === "host.ready", 2_000);

    const textUser = `Synthetic Hark live-check. Reply with one short sentence and do not call tools. Marker ${SYNTHETIC_INPUT_MARKER}.`;
    const toolUser = `Synthetic Hark live-check. Read ${SYNTHETIC_README_PATH} with workspace.read_file, then reply with one short sentence. Marker ${SYNTHETIC_INPUT_MARKER}.`;
    const textRun = await driveRun(input, frames, observations, auths, textUser, runTimeoutMs, (runId) => {
      activeRunId = runId;
    });
    const textSends = guard.state.sends;
    const textFatal = guard.state.fatal;
    const textStatus = guard.state.statuses[0] ?? null;
    const textCall = guard.state.calls[0] ?? null;
    let toolVerdict: Verdict = "not-run";
    let toolObs: PhaseObs | null = null;
    let toolCalls: GuardCall[] = [];
    if (!textFatal && textRun.sawDone && STEPFUN_LIVE_MAX_REQUESTS - textSends >= 2) {
      const before = guard.state.sends;
      toolObs = await driveRun(input, frames, observations, auths, toolUser, runTimeoutMs, (runId) => {
        activeRunId = runId;
      });
      toolCalls = guard.state.calls.slice(before);
      if (guard.state.fatal && !toolObs.sawDone) toolVerdict = "incomplete";
    } else {
      toolVerdict = "incomplete";
    }
    const firstPass = !textFatal
      && textSends === 1
      && textCall?.toolChoice === "forced-none"
      && textRun.sawDone
      && textRun.deltas > 0
      && textRun.doneChars > 0
      && textRun.readFiles === 0
      && textRun.unexpectedReads === 0
      && textStatus === 200;
    const toolStatuses = guard.state.statuses.slice(textSends, textSends + toolCalls.length);
    const toolPass = toolObs !== null
      && toolVerdict !== "incomplete"
      && toolCalls.length === 2
      && toolCalls[0]?.toolChoice === "forced-read-file"
      && toolCalls[1]?.toolChoice === "forced-none"
      && toolObs.readFiles === 1
      && toolObs.unexpectedReads === 0
      && toolObs.sawDone
      && toolObs.doneChars > 0
      && toolObs.deltas > 0
      && toolStatuses.length === 2
      && toolStatuses.every((status) => status === 200);
    if (toolObs && toolVerdict !== "incomplete") toolVerdict = toolPass ? "pass" : "fail";
    const resolvedTool: Verdict = toolPass ? "pass" : toolVerdict;
    const code = guard.state.fatalCode
      ?? (firstPass && toolPass ? "ok" : resolvedTool === "incomplete" ? "incomplete" : "check_failed");
    const summary = emptySummary({
      code,
      status: guard.state.status,
      liveTransport,
      requestCount: guard.state.sends,
      attemptCount: guard.state.attempts,
      blockedAttempts: guard.state.blocked,
      httpStatuses: [...guard.state.statuses],
      refusedPath: guard.state.refusedPath,
      firstText: {
        verdict: firstPass ? "pass" : "fail",
        httpStatus: textStatus,
        sawStreamDelta: textRun.deltas > 0,
        toolChoice: textCall?.toolChoice === "forced-none" ? "forced-none" : "not-sent",
      },
      tool: {
        verdict: resolvedTool,
        selection: toolCalls[0]?.toolChoice === "forced-read-file" ? "forced" : "not-sent",
        toolName: toolObs && toolObs.readFiles > 0 ? STEPFUN_LIVE_TOOL : null,
        followUpToolChoice: toolCalls[1]?.toolChoice === "forced-none" ? "forced-none" : "not-sent",
        httpStatuses: toolStatuses,
        readFileRequests: toolObs?.readFiles ?? 0,
      },
    });
    summary.boundedLiveObservation = liveTransport && firstPass && toolPass;
    input.end();
    await new Promise((resolve) => setTimeout(resolve, 150));
    scanTreeForSecret(tempRoot, secret);
    assertClean(JSON.stringify(host.payloads), secret);
    return writeChecked(summary, summaryFile, secret, summary.code !== "ok");
  } catch (error) {
    const code = error instanceof StepfunLiveError ? error.code : "protocol_error";
    const errorStatus = error instanceof StepfunLiveError ? error.status : null;
    const summary = summaryAfterStop(guard, code, errorStatus, liveTransport);
    try {
      return writeChecked(summary, summaryFile, secret, true);
    } catch {
      return finish(summary, null, true);
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousProfile;
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function driveRun(
  input: PassThrough,
  frames: Frame[],
  observations: Map<string, PhaseObs>,
  auths: Map<string, SyntheticAuth>,
  userText: string,
  runTimeoutMs: number,
  onRun: (runId: string) => void,
): Promise<PhaseObs> {
  const runId = hexId("run");
  const workspaceId = hexId("ws");
  const auth = syntheticAuth(runId);
  auths.set(runId, auth);
  onRun(runId);
  const obs: PhaseObs = { deltas: 0, doneChars: 0, readFiles: 0, unexpectedReads: 0, sawDone: false, frameCode: null };
  observations.set(runId, obs);
  input.write(encodeFrame({
    v: 1,
    kind: "request",
    id: mintId("req"),
    replyTo: null,
    workspaceId,
    runId,
    method: "run.start",
    deadlineUnixMs: Date.now() + runTimeoutMs,
    payload: startPayload(auth, userText),
    error: null,
  }));
  try {
    await waitFor(frames, (frame) => frame.runId === runId && (frame.method === "stream.done" || frame.kind === "error"), runTimeoutMs + 1_000);
  } catch (error) {
    obs.frameCode = error instanceof StepfunLiveError ? error.code : "timeout";
  }
  const latest = observations.get(runId) ?? obs;
  return latest;
}

function noFollowFlag(): number {
  const flag = constants.O_NOFOLLOW;
  if (typeof flag !== "number") throw stable("summary_refused");
  return flag;
}

export function writeBoundedSummary(summaryFile: string, body: string): void {
  const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag();
  let fd: number;
  try {
    fd = openSync(summaryFile, flags, 0o600);
  } catch {
    throw stable("summary_refused");
  }
  try {
    const encoded = Buffer.from(body, "utf8");
    let offset = 0;
    while (offset < encoded.length) {
      const wrote = writeSync(fd, encoded, offset, encoded.length - offset);
      if (wrote <= 0) throw stable("summary_refused");
      offset += wrote;
    }
    fchmodSync(fd, 0o600);
  } catch (error) {
    try {
      unlinkSync(summaryFile);
    } catch {
      // The exclusive create may have failed before a name existed.
    }
    if (error instanceof StepfunLiveError) throw error;
    throw stable("summary_refused");
  } finally {
    closeSync(fd);
  }
}

function readNoFollow(summaryFile: string): string {
  const fd = openSync(summaryFile, constants.O_RDONLY | noFollowFlag());
  try {
    return readFileSync(fd, "utf8");
  } finally {
    closeSync(fd);
  }
}

function writeChecked(summary: LiveSummary, summaryFile: string | null, secret: string, failed: boolean): LiveCheckResult {
  summary.boundedLiveObservation = summary.liveTransport && summary.firstText.verdict === "pass" && summary.tool.verdict === "pass" && summary.claimsProductAcceptance === false && summary.rustJointClosedLoop === false;
  if (summary.boundedLiveObservation && summary.code !== "ok") summary.boundedLiveObservation = false;
  const result = finish(summary, summaryFile, failed || summary.code !== "ok");
  assertClean(result.stdout, secret);
  assertClean(result.stderr, secret);
  if (!summaryFile) return result;
  const body = `${JSON.stringify(summary, null, 2)}\n`;
  assertClean(body, secret);
  writeBoundedSummary(summaryFile, body);
  let written = "";
  try {
    written = readNoFollow(summaryFile);
  } catch {
    throw stable("summary_refused");
  }
  if (secret.length > 0 && written.includes(secret)) {
    try {
      unlinkSync(summaryFile);
    } catch {
      // Refuse the summary even if the name cannot be removed.
    }
    throw stable("summary_refused");
  }
  return result;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry) === fileURLToPath(import.meta.url);
}

async function main(): Promise<number> {
  let code = "protocol_error";
  let status: number | null = null;
  try {
    const argv = process.argv.slice(2);
    const captured = process.env[DEDICATED_KEY_ENV];
    delete process.env[DEDICATED_KEY_ENV];
    assertArgsDoNotCarryKey(argv, captured);
    const cli = parseCliArgs(argv);
    scrubAmbientProcessEnv();
    installCredentialPathDeny();
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const result = await runStepfunLiveCheck({
      apiKey: captured,
      repoRoot,
      summaryRelativePath: cli.summaryRelativePath,
    });
    process.stdout.write(result.stdout);
    if (result.stderr.length > 0) process.stderr.write(result.stderr);
    return result.exitCode;
  } catch (error) {
    code = error instanceof StepfunLiveError ? error.code : "protocol_error";
    status = error instanceof StepfunLiveError ? error.status : null;
    process.stderr.write(errorLine(code, status));
    return code === "missing_key" || code === "invalid_args" || code === "key_in_args" || code === "invalid_summary_path" ? 2 : 1;
  }
}

if (isDirectRun()) {
  main().then((code) => {
    process.exit(code);
  }).catch(() => {
    process.stderr.write(errorLine("protocol_error", null));
    process.exit(1);
  });
}
