import { createExtensionRuntime, type ResourceLoader } from "@earendil-works/pi-coding-agent";

export const ISOLATED_SYSTEM_PROMPT =
  "Hark isolated smoke identity. No filesystem, shell, or network tools are available.";

/** Resource loader that never discovers project, global, or package resources. */
export function createEmptyResourceLoader(): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => ISOLATED_SYSTEM_PROMPT,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: () => Promise.resolve(),
  };
}
