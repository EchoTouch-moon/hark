import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppEvent, HarkBridge, HarkUIError, RunStreamEvent } from "./HarkBridge.ts";
import { DevPreviewHarkBridge } from "./dev-preview.ts";
import {
  createTauriHarkBridge,
  selectBridge,
  uiError,
  type AppEventListener,
  type InvokeFn,
  type TurnChannelFactory,
} from "./native-adapter.ts";

/**
 * Native default is strict Tauri IPC.
 * Dev preview is returned only when the caller explicitly asks for it.
 * A failed invoke never falls back to DevPreviewHarkBridge.
 */

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke?: unknown;
    };
  }
}

export function isTauriHostAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.__TAURI_INTERNALS__?.invoke === "function";
}

export const tauriInvoke: InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) =>
  invoke<T>(cmd, args);

export const tauriTurnChannel: TurnChannelFactory = (onEvent: (event: RunStreamEvent) => void) => {
  const channel = new Channel<RunStreamEvent>();
  channel.onmessage = onEvent;
  return channel;
};

export const tauriListenAppEvents: AppEventListener = async (onEvent) => {
  if (!isTauriHostAvailable()) {
    return () => {};
  }
  try {
    return await listen<AppEvent>("hark://app-event", (event) => {
      if (event?.payload && typeof event.payload === "object" && "type" in event.payload) {
        onEvent(event.payload);
      }
    });
  } catch {
    return () => {};
  }
};

class StrictUnavailableTauriBridge implements HarkBridge {
  private createError(): HarkUIError {
    return uiError(
      "SIDECAR_UNAVAILABLE",
      "未检测到 Tauri 宿主。Native 默认严格模式不会静默切到 Dev Preview。可在设置里显式选择预览。",
      true,
      { recovery: "explicit_preview_only" },
    );
  }

  async getAppSnapshot(): Promise<never> {
    throw this.createError();
  }
  async previewRoot(): Promise<never> {
    throw this.createError();
  }
  async confirmImport(): Promise<never> {
    throw this.createError();
  }
  async createChildWorkspace(): Promise<never> {
    throw this.createError();
  }
  async listWorkspaces(): Promise<never> {
    throw this.createError();
  }
  async getWorkspace(): Promise<never> {
    throw this.createError();
  }
  async updateWorkspaceState(): Promise<never> {
    throw this.createError();
  }
  async getOnboardingRun(): Promise<never> {
    throw this.createError();
  }
  async getConversation(): Promise<never> {
    throw this.createError();
  }
  async startAgentTurn(): Promise<never> {
    throw this.createError();
  }
  async getRunStatus(): Promise<never> {
    throw this.createError();
  }
  async cancelAgentTurn(): Promise<never> {
    throw this.createError();
  }
  async getOpinion(): Promise<never> {
    throw this.createError();
  }
  async listWorkspaceOpinions(): Promise<never> {
    throw this.createError();
  }
  async submitOpinionFeedback(): Promise<never> {
    throw this.createError();
  }
  async revertMemoryOperation(): Promise<never> {
    throw this.createError();
  }
  async getEvidence(): Promise<never> {
    throw this.createError();
  }
  async listWorkspaceEvidence(): Promise<never> {
    throw this.createError();
  }
  async searchWorkspaceMemory(): Promise<never> {
    throw this.createError();
  }
  async getWorkspacePermissions(): Promise<never> {
    throw this.createError();
  }
  async setWorkspacePermissions(): Promise<never> {
    throw this.createError();
  }
  async getNarrativeState(): Promise<never> {
    throw this.createError();
  }
  async observeWorkspace(): Promise<never> {
    throw this.createError();
  }
  async dismissAttentionItem(): Promise<never> {
    throw this.createError();
  }
  async getSearchConfig(): Promise<never> {
    throw this.createError();
  }
  async saveSearchConfig(): Promise<never> {
    throw this.createError();
  }
  async getRuntimeStatus(): Promise<never> {
    throw this.createError();
  }
  async updateRuntimePreference(): Promise<never> {
    throw this.createError();
  }
  async subscribeAppEvents(): Promise<() => void> {
    throw this.createError();
  }
  async pickAndScan(): Promise<never> {
    throw this.createError();
  }
  async continueLocalRecognition(): Promise<never> {
    throw this.createError();
  }
  async hideWindow(): Promise<never> {
    throw this.createError();
  }
  async quitApp(): Promise<never> {
    throw this.createError();
  }
  async pauseDirectory(): Promise<never> {
    throw this.createError();
  }
  async resumeDirectory(): Promise<never> {
    throw this.createError();
  }
  async revokeDirectory(): Promise<never> {
    throw this.createError();
  }
}

const singletonDevBridge = new DevPreviewHarkBridge();
const singletonStrictTauriBridge = new StrictUnavailableTauriBridge();

export function getHarkBridge(mode: "dev_preview_synthetic" | "strict_tauri_ipc"): HarkBridge {
  return selectBridge({
    mode,
    hostAvailable: isTauriHostAvailable(),
    invoke: tauriInvoke,
    devPreview: singletonDevBridge,
    unavailable: singletonStrictTauriBridge,
    turnChannel: tauriTurnChannel,
    listenAppEvents: tauriListenAppEvents,
  });
}

export function createNativeBridge(invoke: InvokeFn = tauriInvoke): HarkBridge {
  return createTauriHarkBridge(invoke, {
    turnChannel: tauriTurnChannel,
    listenAppEvents: tauriListenAppEvents,
  });
}
