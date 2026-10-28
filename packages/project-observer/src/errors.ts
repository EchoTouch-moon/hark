export class ObserverError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ObserverError';
    this.code = code;
  }
}

export function isObserverError(value: unknown): value is ObserverError {
  return value instanceof ObserverError;
}
