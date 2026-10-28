import path from 'node:path';

const SENSITIVE_NAME =
  /(^|[/\\])(\.env([.][^/\\]*)?|credentials[^/\\]*|id_rsa[^/\\]*|.*\.(pem|key|p12|pfx)|.*secret.*|.*token.*)([/\\]|$)/i;

const SECRET_TOKEN = /\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,})\b/g;

export function isSensitivePath(value: string): boolean {
  return SENSITIVE_NAME.test(value.replace(/\\/g, '/'));
}

export function redactPath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  if (isSensitivePath(normalized)) {
    return `<redacted:${path.posix.basename(normalized)}>`;
  }
  return value;
}

export function redactText(value: string, max = 400): string {
  const cleaned = value.replace(SECRET_TOKEN, '<redacted-secret>');
  const withPaths = cleaned.replace(/(^|[\s=])(\/?(?:[\w.-]+\/)*?(?:\.env(?:[.\w-]*)?|id_rsa|[^/\s]+\.(?:pem|key)))/gi, '$1<redacted-path>');
  return withPaths.length > max ? `${withPaths.slice(0, max)}…` : withPaths;
}
