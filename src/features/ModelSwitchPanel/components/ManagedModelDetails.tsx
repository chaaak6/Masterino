import { useAiInfraStore } from '@/store/aiInfra';

import ManagedModelDescriptionContent from './ManagedModelDescriptionContent';

export default function ManagedModelDetails({
  modelId,
  provider,
}: {
  modelId?: string;
  provider?: string;
}) {
  const description = useAiInfraStore(
    (s) =>
      s.enabledAiModels?.find((model) => model.id === modelId && model.providerId === provider)
        ?.settings?.managedModelCatalog?.description,
  );
  return <ManagedModelDescriptionContent description={description} />;
}
