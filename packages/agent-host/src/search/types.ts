import { z } from "zod";

export const SEARCH_PROVIDERS = ["tavily", "zhipu_mcp", "bing", "serper", "duckduckgo"] as const;
export type SearchProviderType = typeof SEARCH_PROVIDERS[number];

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string | undefined;
  score?: number | undefined;
}

export interface SearchExecutionResult {
  provider: SearchProviderType;
  query: string;
  answer?: string | undefined;
  results: SearchResultItem[];
  rawSummaryText: string;
}

export interface SearchProviderCredentials {
  apiKey?: string | undefined;
  endpoint?: string | undefined;
}

export interface SearchConfig {
  activeProvider: SearchProviderType;
  providers: Partial<Record<SearchProviderType, SearchProviderCredentials | undefined>>;
}

export const searchConfigSchema = z.object({
  activeProvider: z.enum(SEARCH_PROVIDERS).default("tavily"),
  providers: z.record(
    z.enum(SEARCH_PROVIDERS),
    z.object({
      apiKey: z.string().nullish().transform((v) => v ?? undefined),
      endpoint: z.string().nullish().transform((v) => v ?? undefined),
    }).nullish().transform((v) => v ?? undefined)
  ).default({}),
});
