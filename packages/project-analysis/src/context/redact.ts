const SECRET =
  /\b(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._-]{20,})\b/g;

const SENSITIVE_FILE =
  /(^|\/)(\.env([.][^/]*)?|credentials[^/]*|id_rsa[^/]*|.*\.(pem|key|p12|pfx)|.*secret.*|.*token.*)(\/|$)/i;

export function isSensitiveRelativePath(relativePath: string): boolean {
  return SENSITIVE_FILE.test(relativePath.replace(/\\/g, '/'));
}

export function redactSecrets(text: string): string {
  return text.replace(SECRET, '<redacted-secret>');
}

export function stripControlChars(text: string): string {
  return [...text].filter((ch) => ch.charCodeAt(0) >= 32 || ch === '\n' || ch === '\t').join('');
}
