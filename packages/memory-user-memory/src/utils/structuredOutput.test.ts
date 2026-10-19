import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { generateValidatedOutput } from './structuredOutput';

const schema = z.object({
  labels: z.array(z.string()),
  memoryType: z.enum(['context', 'fact']),
});
const valid = { labels: ['synthetic'], memoryType: 'context' };

describe('generateValidatedOutput', () => {
  it('asks the model to correct a missing field and invalid enum once', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ memoryType: 'project' })
      .mockResolvedValue(valid);

    await expect(
      generateValidatedOutput(generate, (value) => schema.parse(value)),
    ).resolves.toEqual(valid);
    expect(generate).toHaveBeenCalledTimes(2);
    const feedback = generate.mock.calls[1][0];
    expect(feedback).toContain('labels');
    expect(feedback).toContain('memoryType');
    expect(feedback).toContain('context');
  });

  it('does not retry a valid result', async () => {
    const generate = vi.fn().mockResolvedValue(valid);
    await expect(
      generateValidatedOutput(generate, (value) => schema.parse(value)),
    ).resolves.toEqual(valid);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('keeps invalid output failed after one correction attempt', async () => {
    const generate = vi.fn().mockResolvedValue({ memoryType: 'project' });
    await expect(
      generateValidatedOutput(generate, (value) => schema.parse(value)),
    ).rejects.toBeInstanceOf(z.ZodError);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('does not retry transport or unsupported-model errors', async () => {
    const error = new Error('unsupported tool_choice');
    const generate = vi.fn().mockRejectedValue(error);
    await expect(generateValidatedOutput(generate, (value) => schema.parse(value))).rejects.toBe(
      error,
    );
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('can recover missing tool output without accepting an empty result', async () => {
    const generate = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValue(valid);
    await expect(
      generateValidatedOutput(generate, (value) => schema.parse(value)),
    ).resolves.toEqual(valid);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('does not put invalid output values into the correction instruction', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ memoryType: 'SYNTHETIC_PRIVATE_VALUE' })
      .mockResolvedValue(valid);
    await generateValidatedOutput(generate, (value) => schema.parse(value));
    expect(generate.mock.calls[1][0]).not.toContain('SYNTHETIC_PRIVATE_VALUE');
  });
});
