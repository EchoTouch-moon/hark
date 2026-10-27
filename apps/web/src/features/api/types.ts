/**
 * API 类型层：核心领域类型直接复用 @hearth/contracts（单一事实源），
 * 本文件只补充前端展示用的本地 DTO / 响应形状。
 */
import type {
  ActionCard,
  CardStatus,
  Event,
  Risk,
  RunState,
  RunStep,
  SourceRef,
  TaskRun,
} from '@hearth/contracts';

export type {
  ActionCard,
  CardStatus,
  Event,
  Risk,
  RunState,
  RunStep,
  SourceRef,
  TaskRun,
};

/** GET /api/v1/projects 列表项 */
export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
}

/** GET /api/v1/health */
export interface HealthStatus {
  status: string;
  db: string;
  demoMode: boolean;
  provider: string;
  version: string;
}

/** GET /api/v1/auth/session */
export interface SessionInfo {
  csrfToken: string;
}

/** GET /api/v1/cards 的响应 */
export interface CardListResponse {
  cards: ActionCard[];
  nextCursor: string | null;
}

/** Run 的证据引用（evidence 表投影，不含 restricted payload） */
export interface RunEvidence {
  id: string;
  kind: string;
  sha256: string;
  artifactPath?: string;
  createdAt: string;
}

/** GET /api/v1/runs/:id 的响应 */
export interface RunDetail {
  run: TaskRun;
  steps: RunStep[];
  evidence: RunEvidence[];
}

export type ChatRole = 'user' | 'assistant';

/** POST /api/v1/chat 的消息（Demo 模式由 Mock Adapter 生成） */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  adapter: string;
}

/** GET/PUT /api/v1/settings */
export interface SettingsDto {
  quietHours: { start: string; end: string };
  maxCardsPerDay: number;
  demoMode: boolean;
}
