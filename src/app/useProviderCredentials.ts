import { useEffect, useState } from "react";
import {
  bridgeRequest,
  type DshCredential,
  type DshProvider,
  type DshSettingsDescription,
} from "../lib/desktop";
import { credentialRefForProvider, errorText } from "./settings-model";

type UseProviderCredentialsOptions = {
  desktop: boolean;
  settings: DshSettingsDescription | null;
  providers: DshProvider[];
  onNotice: (message: string) => void;
};

export function useProviderCredentials({ desktop, settings, providers, onNotice }: UseProviderCredentialsOptions) {
  const [credentials, setCredentials] = useState<Record<string, DshCredential>>({});
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, string>>({});
  const [credentialBusy, setCredentialBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop || !settings || providers.length === 0) {
      setCredentials({});
      return;
    }
    const refs = [...new Set(providers
      .map((provider) => credentialRefForProvider(provider, settings.namespaces.find((namespace) => namespace.ns === provider.settingsNs)))
      .filter((ref) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)))];
    if (refs.length === 0) {
      setCredentials({});
      return;
    }
    let stale = false;
    void bridgeRequest<{ credentials: Record<string, DshCredential> }>("credentials.describe", { refs })
      .then((result) => { if (!stale) setCredentials(result.credentials); })
      .catch(() => undefined);
    return () => { stale = true; };
  }, [desktop, providers, settings]);

  function updateCredentialDraft(providerId: string, value: string) {
    setCredentialDrafts((current) => ({ ...current, [providerId]: value }));
  }

  async function saveProviderCredential(provider: DshProvider, valueOverride?: string) {
    const namespace = settings?.namespaces.find((item) => item.ns === provider.settingsNs);
    const ref = credentialRefForProvider(provider, namespace);
    const value = (valueOverride ?? credentialDrafts[provider.provider] ?? "").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) {
      onNotice("当前 Provider 的凭据引用名无效");
      return;
    }
    if (credentials[ref]?.writable === false) {
      onNotice("当前凭据由只读来源提供，不能覆盖");
      return;
    }
    setCredentialBusy(provider.provider);
    try {
      if (value) {
        await bridgeRequest("credentials.set", { ref, value });
        setCredentials((current) => ({ ...current, [ref]: { ...(current[ref] ?? { writable: true }), configured: true } }));
        onNotice("Provider 密钥已更新");
      } else {
        await bridgeRequest("credentials.unset", { ref });
        setCredentials((current) => ({ ...current, [ref]: { ...(current[ref] ?? { writable: true }), configured: false, source: undefined } }));
        onNotice("Provider 密钥已清除");
      }
      setCredentialDrafts((current) => ({ ...current, [provider.provider]: "" }));
    } catch (error) {
      onNotice(errorText(error));
    } finally {
      setCredentialBusy(null);
    }
  }

  function clearProviderCredential(provider: DshProvider) {
    updateCredentialDraft(provider.provider, "");
    return saveProviderCredential(provider, "");
  }

  return {
    credentials,
    credentialDrafts,
    credentialBusy,
    updateCredentialDraft,
    saveProviderCredential,
    clearProviderCredential,
  };
}

export type ProviderCredentialsController = ReturnType<typeof useProviderCredentials>;
