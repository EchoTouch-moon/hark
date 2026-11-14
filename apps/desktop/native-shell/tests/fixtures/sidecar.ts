// Isolated integration fixture. This process has no real network transport.
// The Native supervisor only uses it when a Rust-only test hook is enabled.
import { HostRuntime } from "../../../../../packages/agent-host/src/runtime.ts";

const index = process.argv.indexOf("--app-data");
const appDataDir = index >= 0 ? process.argv[index + 1] : undefined;
if (!appDataDir) throw new Error("fixture app data missing");
const host = new HostRuntime({
  appDataDir,
  input: process.stdin,
  output: process.stdout,
  providerConfig: {
    enabled: true,
    providerId: "hark-byok",
    modelId: "local-model",
    baseUrl: "http://127.0.0.1:9/v1",
    apiKey: "synthetic-key-not-real",
    wire: "openai-completions",
    allowRemote: true,
  },
  syntheticReviewIpc: { waitMs: 15_000 },
});
await host.start();
await new Promise<void>((resolve) => {
  process.stdin.on("end", () => resolve());
  process.stdin.on("close", () => resolve());
});
