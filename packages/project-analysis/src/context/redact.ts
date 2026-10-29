const SECRET =
  /\b(sk-[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{12,}|AKIA[0-9A-Z]{16}|Bearer\s+[A-Za-z0-9._-]{20,})\b/g;

const SENSITIVE_FILE =
  /(^|\/)(\.env([.][^/]*)?|credentials[^/]*|id_rsa[^/]*|.*\.(pem|key|p12|pfx)|.*secret.*|.*token.*)(\/|$)/i;

export function isSensitiveRelativePath(relativePath: string): boolean {
  return SENSITIVE_FILE.test(relativePath.replace(/\\/g, '/'));
}

export function redactSecrets(text: string): string {
  const masked = text.replace(SECRET, '<redacted-secret>').replace(
    /((?:[a-z0-9_]*?(?:api[_-]?key|secret|password|token|authorization)[a-z0-9_]*)["']?\s*[:=]\s*)["']?[^\s,"'<>;]+/gi,
    '$1<redacted-secret>',
  );
  // Conservative heuristic, not a guarantee that arbitrary documents are safe.
  return masked.replace(/[A-Za-z0-9+/_=-]{24,}/g, candidate => {
    if (!/[a-zA-Z]/.test(candidate) || !/[0-9]/.test(candidate)) return candidate;
    const counts = new Map<string, number>();
    for (const ch of candidate) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const entropy = [...counts.values()].reduce((sum, n) => { const p = n / candidate.length; return sum - p * Math.log2(p); }, 0);
    return entropy >= 3.5 ? '<redacted-suspected-secret>' : candidate;
  });
}

export function stripControlChars(text: string): string {
  return [...text].filter((ch) => ch.charCodeAt(0) >= 32 || ch === '\n' || ch === '\t').join('');
}
