import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

/** Literal, not a shell command and not a real key. Stops inherited Vertex ADC resolve. */
export const CLOSED_AMBIENT_KEY = "hark-closed-ambient";

/**
 * Pi 1.5.0 `ModelRuntime.create` does not accept `authContext`.
 * A full availability refresh otherwise calls google-vertex `fileExists` on ADC.
 * Registering a literal API key makes that check skip the inherited file probe.
 */
export async function closeBuiltinCredentialProbes(runtime: ModelRuntime): Promise<void> {
  runtime.registerProvider("google-vertex", {
    name: "hark-closed",
    apiKey: CLOSED_AMBIENT_KEY,
  });
  await runtime.refresh({ allowNetwork: false, providers: ["google-vertex"] });
}
