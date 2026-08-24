import { useEffect, useState } from "react";
import {
  type DshCredential,
  type DshProvider,
  type DshSettingsDescription,
  type DshSettingsNamespace,
} from "../lib/desktop";
import { desktopRequest } from "../lib/desktop-api";
import { credentialRefForProvider, errorText, providerApiKeyEnvOp, providerProfile } from "./settings-model";
import { t, type UiLocale } from "./i18n.ts";

type UseProviderCredentialsOptions = {
  desktop: boolean;
  settings: DshSettingsDescription | null;
  providers: DshProvider[];
  locale: UiLocale;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  loadRuntimeDetails: () => Promise<void>;
};

export function useProviderCredentials({ desktop, settings, providers, locale, onNotice, onError, loadRuntimeDetails }: UseProviderCredentialsOptions) {
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
    void desktopRequest("credentials.describe", { refs })
      .then((result) => { if (!stale) setCredentials(result.credentials); })
      .catch(() => undefined);
    return () => { stale = true; };
  }, [desktop, providers, settings]);

  function updateCredentialDraft(providerId: string, value: string) {
    setCredentialDrafts((current) => ({ ...current, [providerId]: value }));
  }

  async function persistApiKeyEnv(provider: DshProvider, namespace: DshSettingsNamespace | undefined, ref: string) {
    const op = providerApiKeyEnvOp(provider.settingsPath, providerProfile(provider, namespace), ref);
    if (!op || !namespace || !settings?.writable) return;
    try {
      await desktopRequest("settings.mutate", {
        ns: provider.settingsNs,
        ops: [op],
        expectedRevision: namespace.revision,
      });
      await loadRuntimeDetails();
    } catch {
      // The credential is already stored; recording `apiKeyEnv` in the profile
      // is best-effort and may be rejected when the namespace schema has no
      // such field — the derived reference still resolves the key.
    }
  }

  async function saveProviderCredential(provider: DshProvider, valueOverride?: string) {
    const namespace = settings?.namespaces.find((item) => item.ns === provider.settingsNs);
    const ref = credentialRefForProvider(provider, namespace);
    const value = (valueOverride ?? credentialDrafts[provider.provider] ?? "").trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) {
      onNotice(t("provider.notice.refInvalid", locale));
      return;
    }
    if (credentials[ref]?.writable === false) {
      onNotice(t("provider.notice.readonlyCredential", locale));
      return;
    }
    setCredentialBusy(provider.provider);
    try {
      if (value) {
        await desktopRequest("credentials.set", { ref, value });
        setCredentials((current) => ({ ...current, [ref]: { ...(current[ref] ?? { writable: true }), configured: true } }));
        await persistApiKeyEnv(provider, namespace, ref);
        onNotice(t("provider.notice.keyUpdated", locale));
      } else {
        await desktopRequest("credentials.unset", { ref });
        setCredentials((current) => ({ ...current, [ref]: { ...(current[ref] ?? { writable: true }), configured: false, source: undefined } }));
        onNotice(t("provider.notice.keyCleared", locale));
      }
      setCredentialDrafts((current) => ({ ...current, [provider.provider]: "" }));
    } catch (error) {
      onError(errorText(error));
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
