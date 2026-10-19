import type { ChatInputModalityConclusion, EvidenceState } from '@lobechat/types/src/modelCatalog';
import type { ModelAbilities } from 'model-bank';
import deepseekModels from 'model-bank/deepseek';
import minimaxModels from 'model-bank/minimax';
import moonshotModels from 'model-bank/moonshot';
import qwenModels from 'model-bank/qwen';
import zhipuModels from 'model-bank/zhipu';

const knownNewApiModels = new Map(
  [...deepseekModels, ...minimaxModels, ...moonshotModels, ...qwenModels, ...zhipuModels]
    .filter((model) => model.type === 'chat')
    .map((model) => [model.id.toLowerCase(), model.abilities] as const),
);

const resolveVisualSupport = (
  published: EvidenceState | undefined,
  runtime: boolean | undefined,
  catalog: EvidenceState,
  builtin: boolean | undefined,
) => {
  if (published === 'supported') return true;
  if (published === 'unsupported') return false;
  if (runtime !== undefined) return runtime;
  if (catalog !== 'unknown') return catalog === 'supported';
  return builtin === true;
};

/** Only positive evidence earns a capability icon; missing metadata stays visually quiet. */
export const getVisualCapabilities = (
  modelId: string,
  providerId: string | undefined,
  abilities: ModelAbilities | undefined,
  conclusion: ChatInputModalityConclusion,
  managedImageState?: EvidenceState,
  managedVideoState?: EvidenceState,
) => {
  const builtin =
    providerId === 'newapi' ? knownNewApiModels.get(modelId.toLowerCase()) : undefined;
  return {
    image: resolveVisualSupport(
      managedImageState,
      abilities?.vision,
      conclusion.evidence.image.state,
      builtin?.vision,
    ),
    video: resolveVisualSupport(
      managedVideoState,
      abilities?.video,
      conclusion.evidence.video.state,
      builtin?.video,
    ),
  };
};
