import { readFileSync } from "node:fs";
import path from "node:path";
import { providerConfigFromFile } from "./dto.ts";
import { loadScriptedTransport, HostRuntime } from "./runtime.ts";
import { redactText } from "./ipc.ts";

function arg(name: string, argv: readonly string[]): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  return argv[index + 1];
}

export async function runSidecarMain(argv: readonly string[], sessionKey?: string): Promise<void> {
  const appData = arg("--app-data", argv);
  if (!appData) throw new Error("--app-data is required");
  const providerPath = arg("--provider-config", argv);
  const scriptPath = arg("--scripted-transport", argv);
  const provider = providerPath ? providerConfigFromFile(JSON.parse(readFileSync(providerPath, "utf8")), sessionKey) : null;
  const scripted = scriptPath ? loadScriptedTransport(JSON.parse(readFileSync(scriptPath, "utf8"))) : null;
  if (scriptPath && !scriptPath.startsWith(`${path.resolve(appData)}${path.sep}`)) {
    throw new Error("scripted transport must stay inside app-data");
  }
  const secrets = provider ? [provider.apiKey] : [];
  const host = new HostRuntime({
    appDataDir: appData,
    input: process.stdin,
    output: process.stdout,
    providerConfig: provider,
    scriptedTransport: scripted,
    log: (line) => {
      process.stderr.write(`${redactText(line, secrets)}\n`);
    },
  });
  await host.start();
  await new Promise<void>((resolve) => {
    process.stdin.on("end", () => resolve());
    process.stdin.on("close", () => resolve());
  });
}
