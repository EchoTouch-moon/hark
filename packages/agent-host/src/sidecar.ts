import { takeSessionProviderKey } from "./dto.ts";
import { installCredentialPathDeny, scrubAmbientCredentialEnv } from "./credentials/path-deny.ts";

const sessionKey = takeSessionProviderKey();
scrubAmbientCredentialEnv();
installCredentialPathDeny();

const { runSidecarMain } = await import("./sidecar-main.ts");
await runSidecarMain(process.argv.slice(2), sessionKey);
