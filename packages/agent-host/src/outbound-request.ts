import { createHash } from "node:crypto";

/** The exact body presented for review before any HTTP request, without headers. */
export interface OutboundRequestSnapshot {
  readonly endpoint: string;
  readonly model: string;
  readonly body: string;
  readonly bodySha256: string;
}

/**
 * Capture only a fixed endpoint's final serialized SDK body. HTTP headers are
 * deliberately excluded: they contain the provider credential. The returned
 * string is immutable and must be used verbatim by the eventual sender.
 * Creating a snapshot does not authorize sending it.
 */
export function captureOutboundRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  expected: { endpoint: string; model: string },
): OutboundRequestSnapshot {
  const endpoint = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (endpoint !== expected.endpoint) throw new Error("outbound endpoint mismatch");
  // Do not clone a Request: it could hide a body, method, or headers from this boundary.
  if (input instanceof Request || (init?.method ?? "GET").toUpperCase() !== "POST") {
    throw new Error("outbound request must be an explicit POST");
  }
  if (typeof init?.body !== "string") throw new Error("outbound body must be serialized text");
  const body = init.body;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("outbound body is not JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || (parsed as Record<string, unknown>).model !== expected.model) {
    throw new Error("outbound model mismatch");
  }
  return Object.freeze({
    endpoint,
    model: expected.model,
    body,
    bodySha256: createHash("sha256").update(body, "utf8").digest("hex"),
  });
}

/** Fail closed if a provider credential has accidentally entered the body. */
export function bodyContainsSecret(body: string, secrets: readonly string[]): boolean {
  const keys = secrets.filter((secret) => secret.length > 0);
  if (keys.length === 0) return false;
  const contains = (text: string) => keys.some((secret) => text.includes(secret));
  if (contains(body)) return true;
  const visit = (value: unknown): boolean => {
    if (typeof value === "string") return contains(value);
    if (Array.isArray(value)) return value.some(visit);
    if (value && typeof value === "object") {
      return Object.entries(value).some(([key, item]) => contains(key) || visit(item));
    }
    return false;
  };
  // captureOutboundRequest already checked the JSON, but the helper also fails
  // closed if used independently on an invalid body.
  try { return visit(JSON.parse(body)); } catch { return true; }
}
