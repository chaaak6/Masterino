import { executeDocumentOperation } from './index';
const controller = new AbortController();
process.on('message', async (message: any) => {
  if (message.type === 'cancel') {
    controller.abort();
    return;
  }
  if (message.type !== 'run') return;
  try {
    const result = await executeDocumentOperation(message.operation, message.args, {
      ...message.options,
      signal: controller.signal,
      progress: (progress) => process.send?.({ type: 'progress', progress }),
    });
    if (JSON.stringify(result).length > 64000)
      throw new Error('Document result exceeds 64000 character budget');
    process.send?.({ type: 'result', result }, () => process.exit(0));
  } catch (error) {
    process.send?.(
      { type: 'error', error: error instanceof Error ? error.message : String(error) },
      () => process.exit(1),
    );
  }
});
