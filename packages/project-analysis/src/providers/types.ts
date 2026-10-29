import type { ProjectContext, ProviderOutcome } from '../contracts.js';

export interface AnalyzeInput {
  context: ProjectContext;
  insightId?: string;
  signal?: AbortSignal;
}

export interface AnalysisProvider {
  readonly id: string;
  readonly model: string | null;
  analyze(input: AnalyzeInput): Promise<ProviderOutcome>;
}
