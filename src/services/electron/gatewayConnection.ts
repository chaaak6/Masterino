import { ensureElectronIpc } from '@/utils/electron/ipc';

class GatewayConnectionService {
  connect = async () => {
    return ensureElectronIpc().gatewayConnection.connect();
  };

  disconnect = async () => {
    return ensureElectronIpc().gatewayConnection.disconnect();
  };

  getConnectionStatus = async () => {
    return ensureElectronIpc().gatewayConnection.getConnectionStatus();
  };

  getDeviceInfo = async () => {
    return ensureElectronIpc().gatewayConnection.getDeviceInfo();
  };

  executeLocalToolCall = async (
    params: Parameters<
      ReturnType<typeof ensureElectronIpc>['gatewayConnection']['executeLocalToolCall']
    >[0],
    options?: { signal?: AbortSignal },
  ) => {
    const ipc = ensureElectronIpc().gatewayConnection;
    if (!['inspectOfficeDocument', 'readOfficeDocument'].includes(params.apiName))
      return ipc.executeLocalToolCall(params);
    const signal = options?.signal;
    signal?.throwIfAborted();
    const execution = ipc.executeLocalToolCall(params);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      const cancel = (reason: unknown) => {
        if (params.trace) void ipc.cancelLocalOfficeRead(params.trace).catch(() => undefined);
        reject(reason);
      };
      onAbort = () =>
        cancel(signal?.reason ?? new DOMException('Office read cancelled', 'AbortError'));
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(
        () => cancel(new Error('Office read timed out after 120 seconds')),
        120_000,
      );
      if (signal?.aborted) onAbort();
    });
    try {
      return await Promise.race([execution, cancelled]);
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) signal?.removeEventListener('abort', onAbort);
    }
  };

  setDeviceDescription = async (description: string) => {
    return ensureElectronIpc().gatewayConnection.setDeviceDescription({ description });
  };

  setDeviceName = async (name: string) => {
    return ensureElectronIpc().gatewayConnection.setDeviceName({ name });
  };
}

export const gatewayConnectionService = new GatewayConnectionService();
