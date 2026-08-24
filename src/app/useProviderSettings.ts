import type { DshProvider, DshSettingsDescription } from "../lib/desktop";
import { useProviderCredentials } from "./useProviderCredentials";
import { useProviderModelCatalog } from "./useProviderModelCatalog";
import type { UiLocale } from "./i18n.ts";

type UseProviderSettingsOptions = {
  desktop: boolean;
  settings: DshSettingsDescription | null;
  providers: DshProvider[];
  locale: UiLocale;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
  onConfirm: (message: string) => Promise<boolean>;
  loadRuntimeDetails: () => Promise<void>;
};

export function useProviderSettings({
  desktop,
  settings,
  providers,
  locale,
  onNotice,
  onError,
  onConfirm,
  loadRuntimeDetails,
}: UseProviderSettingsOptions) {
  const credentials = useProviderCredentials({
    desktop,
    settings,
    providers,
    locale,
    onNotice,
    onError,
    loadRuntimeDetails,
  });
  const modelCatalog = useProviderModelCatalog({
    settings,
    credentials: credentials.credentials,
    credentialDrafts: credentials.credentialDrafts,
    locale,
    onNotice,
    onError,
    onConfirm,
    loadRuntimeDetails,
  });

  return {
    ...credentials,
    ...modelCatalog,
  };
}

export type ProviderSettingsController = ReturnType<typeof useProviderSettings>;
