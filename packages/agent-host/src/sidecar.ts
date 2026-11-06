import { installCredentialPathDeny, scrubAmbientCredentialEnv } from "./credentials/path-deny.ts";

scrubAmbientCredentialEnv();
installCredentialPathDeny();

const { runSidecarMain } = await import("./sidecar-main.ts");
await runSidecarMain(process.argv.slice(2));
