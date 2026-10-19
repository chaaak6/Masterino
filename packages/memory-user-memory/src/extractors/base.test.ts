import type { ModelRuntime } from '@lobechat/model-runtime';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ContextExtractor } from './context';
import { ExperienceExtractor } from './experience';

const context = {
  details: 'Synthetic QA project',
  memoryCategory: 'work',
  memoryType: 'context',
  sourceIds: [],
  summary: 'ORCHID-47',
  tags: [],
  title: 'Synthetic project',
  withContext: {
    associatedObjects: [],
    associatedSubjects: [],
    currentStatus: 'ongoing',
    description: 'Synthetic project',
    labels: [],
    scoreImpact: 0.5,
    scoreUrgency: 0.5,
    title: 'ORCHID-47',
    type: 'project',
  },
};

describe('memory extraction schema correction', () => {
  it('recovers the project enum error at the real context extractor boundary', async () => {
    const generateObject = vi
      .fn()
      .mockResolvedValueOnce({ memories: [{ ...context, memoryType: 'project' }] })
      .mockResolvedValue({ memories: [context] });
    const extractor = new ContextExtractor({
      agent: 'layer-context',
      model: 'synthetic',
      modelRuntime: { generateObject } as unknown as ModelRuntime,
    });
    const onExtractRequest = vi.fn();
    const onExtractResponse = vi.fn();
    await expect(
      extractor.structuredCall({ callbacks: { onExtractRequest, onExtractResponse } }),
    ).resolves.toEqual({ memories: [context] });
    expect(onExtractRequest).toHaveBeenCalledTimes(2);
    expect(onExtractResponse).toHaveBeenCalledTimes(2);
    expect(onExtractRequest.mock.calls[1][1].messages.at(-1).content).toContain('memoryType');
    expect(generateObject).toHaveBeenCalledTimes(2);
    const [first, second] = generateObject.mock.calls;
    expect(second[0].messages.at(-1).content).toContain('memoryType');
    expect(second[0].schema).toEqual(first[0].schema);
    expect(second[1].signal).toBe(first[1].signal);
  });

  it('corrects missing experience labels and type without discarding the memory', async () => {
    const item = {
      details: '',
      memoryCategory: 'work',
      memoryType: 'fact',
      sourceIds: [],
      summary: 'Use stable IDs',
      tags: [],
      title: 'Idempotency',
      withExperience: {
        action: 'Checked IDs',
        keyLearning: 'Retries must be idempotent',
        knowledgeValueScore: 0.5,
        possibleOutcome: 'No duplicates',
        problemSolvingScore: 0.5,
        reasoning: 'Prevent duplicates',
        scoreConfidence: 0.8,
        situation: 'Synthetic QA',
      },
    };
    const valid = {
      memories: [
        {
          ...item,
          withExperience: { ...item.withExperience, labels: [], type: 'problem-solving' },
        },
      ],
    };
    const generateObject = vi
      .fn()
      .mockResolvedValueOnce({ memories: [item] })
      .mockResolvedValue(valid);
    const extractor = new ExperienceExtractor({
      agent: 'layer-experience',
      model: 'synthetic',
      modelRuntime: { generateObject } as unknown as ModelRuntime,
    });
    await expect(extractor.structuredCall({})).resolves.toEqual(valid);
    expect(generateObject.mock.calls[1][0].messages.at(-1).content).toContain('labels');
    expect(generateObject.mock.calls[1][0].messages.at(-1).content).toContain('type');
  });

  it('still rejects invalid output after the single correction attempt', async () => {
    const generateObject = vi
      .fn()
      .mockResolvedValue({ memories: [{ ...context, memoryType: 'project' }] });
    const extractor = new ContextExtractor({
      agent: 'layer-context',
      model: 'synthetic',
      modelRuntime: { generateObject } as unknown as ModelRuntime,
    });
    await expect(extractor.structuredCall({})).rejects.toBeInstanceOf(z.ZodError);
    expect(generateObject).toHaveBeenCalledTimes(2);
  });
});
