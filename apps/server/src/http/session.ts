import { randomBytes } from 'node:crypto';

export interface SessionRecord {
  token: string;
  csrfToken: string;
  createdAt: string;
}

/**
 * Single-principal local session store. The token lives in an HttpOnly cookie,
 * the CSRF token is handed to the SPA once via GET /auth/session and must be
 * echoed in the `x-csrf-token` header on every state-changing request.
 * Sessions persist in the settings table so a server restart keeps the UI
 * logged in; they are never embedded into static build assets.
 */
export class SessionManager {
  private record: SessionRecord | null = null;

  constructor(
    private readonly load: () => unknown,
    private readonly persist: (value: unknown) => void,
  ) {
    const raw = this.load();
    if (
      raw &&
      typeof raw === 'object' &&
      typeof (raw as Record<string, unknown>)['token'] === 'string' &&
      typeof (raw as Record<string, unknown>)['csrfToken'] === 'string'
    ) {
      this.record = raw as SessionRecord;
    }
  }

  current(): SessionRecord {
    if (!this.record) {
      this.record = {
        token: randomBytes(32).toString('hex'),
        csrfToken: randomBytes(24).toString('hex'),
        createdAt: new Date().toISOString(),
      };
      this.persist(this.record);
    }
    return this.record;
  }

  isValidToken(token: string | undefined): boolean {
    return token !== undefined && this.record !== null && token === this.record.token;
  }

  csrfFor(token: string | undefined): string | null {
    return this.isValidToken(token) ? this.record!.csrfToken : null;
  }

  rotate(): SessionRecord {
    this.record = null;
    return this.current();
  }
}

export function parseSessionCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'hearth_session') return rest.join('=');
  }
  return undefined;
}
