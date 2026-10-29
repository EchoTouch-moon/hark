export class AnalysisError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AnalysisError';
    this.code = code;
  }
}

export function isAnalysisError(value: unknown): value is AnalysisError {
  return value instanceof AnalysisError;
}
