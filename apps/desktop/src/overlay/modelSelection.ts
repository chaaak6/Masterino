import type { ScreenCaptureAgentOption, ScreenCaptureModelOption } from '@lobechat/electron-client-ipc';

export const shouldShowOverlayModelSelector = (agent?: ScreenCaptureAgentOption) =>
  !agent?.heterogeneousType;

export const resolveOverlayModelSelectionPayload = ({
  agent,
  model,
  modelId,
}: {
  agent?: ScreenCaptureAgentOption;
  model?: ScreenCaptureModelOption;
  modelId?: string;
}) => {
  if (!shouldShowOverlayModelSelector(agent)) {
    return { modelId: undefined, provider: undefined };
  }

  return { modelId, provider: model?.provider };
};
