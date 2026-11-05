import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";

/**
 * In-memory credential store. `read` is always empty so ambient files are not
 * a fallback, and every write is refused so nothing reaches auth.json.
 */
export function createMemoryCredentialStore(): CredentialStore {
  return {
    read(_providerId: string, _options?: AuthOperationOptions): Promise<Credential | undefined> {
      return Promise.resolve(undefined);
    },
    list(_options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
      return Promise.resolve([]);
    },
    modify(
      providerId: string,
      _fn: (current: Credential | undefined) => Promise<Credential | undefined>,
      _options?: AuthOperationOptions,
    ): Promise<Credential | undefined> {
      return Promise.reject(new Error(`memory credential store refuses writes for ${providerId}`));
    },
    delete(providerId: string, _options?: AuthOperationOptions): Promise<void> {
      return Promise.reject(new Error(`memory credential store refuses writes for ${providerId}`));
    },
  };
}
