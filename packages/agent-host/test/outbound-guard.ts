import dns from "node:dns";
import { createRequire } from "node:module";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";

const require = createRequire(import.meta.url);
type MutableFs = {
  promises: typeof import("node:fs").promises;
  existsSync: typeof import("node:fs").existsSync;
  readFileSync: typeof import("node:fs").readFileSync;
  statSync: typeof import("node:fs").statSync;
  readdirSync: typeof import("node:fs").readdirSync;
  accessSync: typeof import("node:fs").accessSync;
};
const fs = require("node:fs") as MutableFs;
const fsPromises = fs.promises;

export type GuardKind =
  | "fetch"
  | "socket"
  | "http"
  | "dns"
  | "spawn"
  | "pi-global"
  | "vault"
  | "project-discovery"
  | "ambient-credential";

export interface GuardRecord {
  kind: GuardKind;
  detail: string;
}

export interface OutboundGuard {
  records: GuardRecord[];
  restore: () => void;
  real: {
    existsSync: typeof fs.existsSync;
    readFileSync: typeof fs.readFileSync;
    statSync: typeof fs.statSync;
  };
}

const CREDENTIAL_BASENAMES = new Set([
  "auth.json",
  "models.json",
  "settings.json",
  "mcp.json",
  "mcp-auth.json",
  "application_default_credentials.json",
  "credentials",
]);

function enoent(filePath: string): NodeJS.ErrnoException {
  const error = new Error(`ENOENT: isolated smoke denied ${filePath}`) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  return error;
}

function hostOf(input: unknown): string {
  try {
    const raw =
      typeof input === "string" ? input : input instanceof URL ? input.href : input instanceof Request ? input.url : "";
    if (!raw) return "unparsed";
    const url = new URL(raw);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "unparsed";
  }
}

function socketDetail(args: unknown[]): string {
  const first = args[0];
  if (typeof first === "object" && first !== null) {
    const options = first as { port?: unknown; host?: unknown; path?: unknown };
    if (typeof options.path === "string") return "ipc-socket";
    const host = typeof options.host === "string" ? options.host : "localhost";
    const port = typeof options.port === "number" ? String(options.port) : "?";
    return `${host}:${port}`;
  }
  if (typeof first === "number") return `localhost:${first}`;
  return "socket";
}

/**
 * Test-layer transport and filesystem gate. Denied paths are not opened.
 * This is not an SDK hook; a swallowed hook throw cannot replace it.
 */
export function installOutboundGuard(tempRoot: string, projectRoot: string): OutboundGuard {
  const records: GuardRecord[] = [];
  const originalFetch = globalThis.fetch;
  const originalConnect = net.Socket.prototype.connect;
  const originalLookup = dns.lookup;
  const originalLookupPromise = dns.promises.lookup;
  const originalHttpRequest = http.request;
  const originalHttpsRequest = https.request;
  const originalTlsConnect = tls.connect;
  const childProcess = require("node:child_process") as {
    spawn: (command: string, args?: readonly string[], options?: object) => unknown;
    spawnSync: (command: string, args?: readonly string[], options?: object) => unknown;
    execFile: (file: string, args?: readonly string[], options?: object, callback?: unknown) => unknown;
    execFileSync: (file: string, args?: readonly string[], options?: object) => unknown;
    fork: (modulePath: string, args?: readonly string[], options?: object) => unknown;
    ChildProcess: { prototype: { spawn: (options: object) => unknown } };
  };
  const originalSpawn = childProcess.spawn;
  const originalSpawnSync = childProcess.spawnSync;
  const originalExecFile = childProcess.execFile;
  const originalExecFileSync = childProcess.execFileSync;
  const originalFork = childProcess.fork;
  const originalChildSpawn = childProcess.ChildProcess.prototype.spawn;
  const originalAccess = fsPromises.access.bind(fsPromises);
  const originalReadFile = fsPromises.readFile.bind(fsPromises);
  const originalStat = fsPromises.stat.bind(fsPromises);
  const originalReaddir = fsPromises.readdir.bind(fsPromises);
  const originalExistsSync = fs.existsSync;
  const originalReadFileSync = fs.readFileSync;
  const originalStatSync = fs.statSync;
  const originalReaddirSync = fs.readdirSync;
  const originalAccessSync = fs.accessSync;

  const homePi = path.resolve(os.homedir(), ".pi");
  const resolvedTemp = path.resolve(tempRoot);
  const resolvedProject = path.resolve(projectRoot);

  function classify(raw: string): GuardKind | "allow" {
    const expanded = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
    const resolved = path.resolve(expanded);
    if (resolved === homePi || resolved.startsWith(`${homePi}${path.sep}`)) return "pi-global";
    const segments = resolved.split(path.sep);
    if (segments.includes("personal-vault") || segments.includes("memory-vault")) return "vault";
    const base = path.basename(resolved);
    const underTemp = resolved === resolvedTemp || resolved.startsWith(`${resolvedTemp}${path.sep}`);
    if (!underTemp && (CREDENTIAL_BASENAMES.has(base) || resolved.includes(`${path.sep}.aws${path.sep}`) || resolved.includes(`${path.sep}gcloud${path.sep}`))) {
      return "ambient-credential";
    }
    const underProject = resolved === resolvedProject || resolved.startsWith(`${resolvedProject}${path.sep}`);
    if (underProject) {
      if (resolved.includes(`${path.sep}.pi${path.sep}`) || resolved.endsWith(`${path.sep}.pi`)) return "project-discovery";
      if (base === "AGENTS.md" || base === "CLAUDE.md") return "project-discovery";
    }
    return "allow";
  }

  function denyFs(raw: string): boolean {
    const kind = classify(raw);
    if (kind === "allow") return false;
    const detail = kind === "project-discovery" || kind === "ambient-credential" ? path.basename(raw) : kind;
    records.push({ kind, detail });
    return true;
  }

  globalThis.fetch = ((input: Parameters<typeof fetch>[0], _init?: Parameters<typeof fetch>[1]) => {
    records.push({ kind: "fetch", detail: hostOf(input) });
    return Promise.reject(new Error("isolated smoke blocked fetch"));
  }) as typeof fetch;

  net.Socket.prototype.connect = function connectBlocked(this: net.Socket, ...args: unknown[]) {
    records.push({ kind: "socket", detail: socketDetail(args) });
    const error = new Error("isolated smoke blocked socket");
    queueMicrotask(() => this.emit("error", error));
    return this;
  } as typeof net.Socket.prototype.connect;

  dns.lookup = ((hostname: string, options: unknown, callback?: unknown) => {
    records.push({ kind: "dns", detail: hostname });
    const cb = typeof options === "function" ? options : callback;
    const error = new Error("isolated smoke blocked dns");
    if (typeof cb === "function") {
      cb(error, "", 0);
      return;
    }
    throw error;
  }) as typeof dns.lookup;

  dns.promises.lookup = (async (hostname: string) => {
    records.push({ kind: "dns", detail: hostname });
    throw new Error("isolated smoke blocked dns");
  }) as typeof dns.promises.lookup;

  const blockRequest = (kind: "http") =>
    ((...args: unknown[]) => {
      records.push({ kind, detail: hostOf(args[0]) });
      throw new Error("isolated smoke blocked http");
    }) as typeof http.request;

  http.request = blockRequest("http");
  https.request = blockRequest("http") as typeof https.request;
  tls.connect = ((..._args: unknown[]) => {
    records.push({ kind: "socket", detail: "tls" });
    throw new Error("isolated smoke blocked tls");
  }) as typeof tls.connect;

  const blockSpawn = (command: unknown) => {
    const name = typeof command === "string" ? path.basename(command) : "spawn";
    records.push({ kind: "spawn", detail: name });
    throw new Error("isolated smoke blocked spawn");
  };
  childProcess.spawn = (command: string) => blockSpawn(command);
  childProcess.spawnSync = (command: string) => blockSpawn(command);
  childProcess.execFile = (file: string) => blockSpawn(file);
  childProcess.execFileSync = (file: string) => blockSpawn(file);
  childProcess.fork = (modulePath: string) => blockSpawn(modulePath);
  childProcess.ChildProcess.prototype.spawn = function blockedChildSpawn() {
    records.push({ kind: "spawn", detail: "child-process" });
    throw new Error("isolated smoke blocked spawn");
  };

  fsPromises.access = (async (target: Parameters<typeof fsPromises.access>[0]) => {
    const raw = String(target);
    if (denyFs(raw)) throw enoent(raw);
    return originalAccess(target);
  }) as typeof fsPromises.access;

  fsPromises.readFile = (async (target: Parameters<typeof fsPromises.readFile>[0], options?: Parameters<typeof fsPromises.readFile>[1]) => {
    const raw = String(target);
    if (denyFs(raw)) throw enoent(raw);
    return originalReadFile(target, options);
  }) as typeof fsPromises.readFile;

  fsPromises.stat = (async (target: Parameters<typeof fsPromises.stat>[0]) => {
    const raw = String(target);
    if (denyFs(raw)) throw enoent(raw);
    return originalStat(target);
  }) as typeof fsPromises.stat;

  fsPromises.readdir = (async (target: Parameters<typeof fsPromises.readdir>[0], options?: Parameters<typeof fsPromises.readdir>[1]) => {
    const raw = String(target);
    if (denyFs(raw)) throw enoent(raw);
    return originalReaddir(target, options as never);
  }) as unknown as typeof fsPromises.readdir;

  fs.existsSync = ((target: Parameters<typeof fs.existsSync>[0]) => {
    const raw = String(target);
    if (denyFs(raw)) return false;
    return originalExistsSync(target);
  }) as typeof fs.existsSync;
  fs.readFileSync = ((target: Parameters<typeof fs.readFileSync>[0], options?: Parameters<typeof fs.readFileSync>[1]) => {
    const raw = String(target);
    if (denyFs(raw)) throw enoent(raw);
    return originalReadFileSync(target, options);
  }) as typeof fs.readFileSync;
  fs.statSync = ((target: Parameters<MutableFs["statSync"]>[0], options?: Parameters<MutableFs["statSync"]>[1]) => {
    const raw = String(target);
    if (denyFs(raw)) throw enoent(raw);
    return originalStatSync(target, options);
  }) as typeof fs.statSync;
  fs.readdirSync = ((target: Parameters<typeof fs.readdirSync>[0], options?: Parameters<typeof fs.readdirSync>[1]) => {
    const raw = String(target);
    if (denyFs(raw)) throw enoent(raw);
    return originalReaddirSync(target, options as never);
  }) as unknown as typeof fs.readdirSync;
  fs.accessSync = ((target: Parameters<typeof fs.accessSync>[0], mode?: Parameters<typeof fs.accessSync>[1]) => {
    const raw = String(target);
    if (denyFs(raw)) throw enoent(raw);
    return originalAccessSync(target, mode);
  }) as typeof fs.accessSync;

  return {
    records,
    real: {
      existsSync: originalExistsSync,
      readFileSync: originalReadFileSync,
      statSync: originalStatSync,
    },
    restore() {
      globalThis.fetch = originalFetch;
      net.Socket.prototype.connect = originalConnect;
      dns.lookup = originalLookup;
      dns.promises.lookup = originalLookupPromise;
      http.request = originalHttpRequest;
      https.request = originalHttpsRequest;
      tls.connect = originalTlsConnect;
      fsPromises.access = originalAccess;
      fsPromises.readFile = originalReadFile;
      fsPromises.stat = originalStat;
      fsPromises.readdir = originalReaddir;
      fs.existsSync = originalExistsSync;
      fs.readFileSync = originalReadFileSync;
      fs.statSync = originalStatSync;
      fs.readdirSync = originalReaddirSync;
      fs.accessSync = originalAccessSync;
      childProcess.spawn = originalSpawn;
      childProcess.spawnSync = originalSpawnSync;
      childProcess.execFile = originalExecFile;
      childProcess.execFileSync = originalExecFileSync;
      childProcess.fork = originalFork;
      childProcess.ChildProcess.prototype.spawn = originalChildSpawn;
    },
  };
}
