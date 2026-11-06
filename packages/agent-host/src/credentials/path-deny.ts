import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

type MutableFs = {
  promises: {
    access: (...args: never[]) => Promise<unknown>;
    readFile: (...args: never[]) => Promise<unknown>;
  };
  existsSync: (target: unknown) => boolean;
  readFileSync: (target: unknown, options?: unknown) => unknown;
  accessSync: (target: unknown, mode?: unknown) => void;
};

const fs = require("node:fs") as MutableFs;

const CREDENTIAL_BASENAMES = new Set([
  "application_default_credentials.json",
  "auth.json",
  "models.json",
  "credentials",
]);

const SENSITIVE_ENV = /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AWS_|GOOGLE_|ANTHROPIC|OPENAI|OPENROUTER|MOONSHOT|XAI_|ZAI_|STEPFUN)/i;

let installed = false;
let scrubbed = false;

function pathText(target: unknown): string {
  if (typeof target === "string") return target;
  if (target instanceof URL) return target.pathname;
  return "";
}

/** Known credential locations only. Ordinary session and app-data paths pass through. */
export function isClosedCredentialPath(target: unknown): boolean {
  const raw = pathText(target).replaceAll("\\", "/");
  if (!raw) return false;
  const parts = raw.split("/");
  if (parts.includes("personal-vault") || parts.includes("memory-vault")) return true;
  const base = parts.at(-1) ?? "";
  if (raw.includes("/.config/gcloud/") || raw.endsWith("/.config/gcloud")) return true;
  if (raw.includes("/.aws/credentials") || raw.includes("/.aws/config")) return true;
  if (raw.includes("/.pi/agent/") && CREDENTIAL_BASENAMES.has(base)) return true;
  return base === "application_default_credentials.json";
}

function enoent(target: string): NodeJS.ErrnoException {
  const error = new Error("ENOENT: credential path closed") as NodeJS.ErrnoException;
  error.code = "ENOENT";
  error.path = target;
  return error;
}

/**
 * Close file credential fallback without wrapping every filesystem call.
 * Must run before the Pi SDK import caches `existsSync`.
 */
export function installCredentialPathDeny(): void {
  if (installed) return;
  installed = true;
  const access = fs.promises.access;
  const readFile = fs.promises.readFile;
  const existsSync = fs.existsSync;
  const readFileSync = fs.readFileSync;
  const accessSync = fs.accessSync;
  fs.promises.access = (async (target: never) => {
    const raw = pathText(target);
    if (isClosedCredentialPath(raw)) throw enoent(raw);
    return access(target);
  }) as typeof fs.promises.access;
  fs.promises.readFile = (async (target: never, options?: never) => {
    const raw = pathText(target);
    if (isClosedCredentialPath(raw)) throw enoent(raw);
    return readFile(target, options as never);
  }) as typeof fs.promises.readFile;
  fs.existsSync = ((target: unknown) => {
    if (isClosedCredentialPath(target)) return false;
    return existsSync(target);
  }) as typeof fs.existsSync;
  fs.readFileSync = ((target: unknown, options?: unknown) => {
    if (isClosedCredentialPath(target)) throw enoent(pathText(target));
    return readFileSync(target, options);
  }) as typeof fs.readFileSync;
  fs.accessSync = ((target: unknown, mode?: unknown) => {
    if (isClosedCredentialPath(target)) throw enoent(pathText(target));
    return accessSync(target, mode);
  }) as typeof fs.accessSync;
}

/** Drop ambient provider env. Values are not logged or returned. */
export function scrubAmbientCredentialEnv(): string[] {
  if (scrubbed) return [];
  scrubbed = true;
  const removed: string[] = [];
  for (const name of Object.keys(process.env)) {
    if (!SENSITIVE_ENV.test(name)) continue;
    delete process.env[name];
    removed.push(name);
  }
  return removed;
}
