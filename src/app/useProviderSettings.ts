import type { DshProvider, DshSettingsDescription } from "../lib/desktop";
import { useProviderCredentials } from "./useProviderCredentials";
import { useProviderModelCatalog } from "./useProviderModelCatalog";

type UseProviderSettingsOptions = {
  desktop: boolean;
  settings: DshSettingsDescription | null;
  providers: DshProvider[];
  onNotice: (message: string) => void;
  loadRuntimeDetails: () => Promise<void>;
};

export function useProviderSettings({
  desktop,
  settings,
  providers,
  onNotice,
  loadRuntimeDetails,
}: UseProviderSettingsOptions) {
  const credentials = useProviderCredentials({
    desktop,
    settings,
    providers,
    onNotice,
  });
  const modelCatalog = useProviderModelCatalog({
    settings,
    credentials: credentials.credentials,
    credentialDrafts: credentials.credentialDrafts,
    onNotice,
    loadRuntimeDetails,
  });

  return {
    ...credentials,
    ...modelCatalog,
  };
}

export type ProviderSettingsController = ReturnType<typeof useProviderSettings>;
