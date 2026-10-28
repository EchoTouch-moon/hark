export class InsightError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'InsightError';
    this.code = code;
  }
}

export function isInsightError(value: unknown): value is InsightError {
  return value instanceof InsightError;
}
