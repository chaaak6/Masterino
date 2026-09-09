import type {
  GatewayConnectionState,
  GatewayConnectionStatus,
} from '@lobechat/electron-client-ipc';
import { type SWRResponse } from 'swr';
import useSWR from 'swr';

import { mutate } from '@/libs/swr';
import { electronKeys } from '@/libs/swr/keys';
import { gatewayConnectionService } from '@/services/electron/gatewayConnection';
import { type StoreSetter } from '@/store/types';

import { type ElectronStore } from '../store';

type Setter = StoreSetter<ElectronStore>;
export const gatewaySlice = (set: Setter, get: () => ElectronStore, _api?: unknown) =>
  new ElectronGatewayActionImpl(set, get, _api);

export interface GatewayDeviceInfo {
  description: string;
  deviceId: string;
  hostname: string;
  name: string;
  platform: string;
}

export class ElectronGatewayActionImpl {
  readonly #get: () => ElectronStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => ElectronStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  connectGateway = async (): Promise<void> => {
    this.#set({
      gatewayConnectionState: { enabled: true, status: 'connecting' },
      gatewayConnectionStatus: 'connecting',
    });
    try {
      const result = await gatewayConnectionService.connect();
      if (!result.success) {
        const state = await gatewayConnectionService.getConnectionStatus();
        this.setGatewayConnectionState(state);
      }
    } catch (error) {
      console.error('Gateway connect failed:', error);
      const state = await gatewayConnectionService.getConnectionStatus();
      this.setGatewayConnectionState(state);
    }
  };

  disconnectGateway = async (): Promise<void> => {
    try {
      await gatewayConnectionService.disconnect();
      this.#set({
        gatewayConnectionState: { enabled: false, status: 'disconnected' },
        gatewayConnectionStatus: 'disconnected',
      });
    } catch (error) {
      console.error('Gateway disconnect failed:', error);
    }
  };

  refreshGatewayDeviceInfo = async (): Promise<void> => {
    await mutate(electronKeys.gatewayDeviceInfo());
  };

  setGatewayConnectionStatus = (status: GatewayConnectionStatus): void => {
    this.#set(
      (state) => ({
        gatewayConnectionState: { ...state.gatewayConnectionState, status },
        gatewayConnectionStatus: status,
      }),
      false,
      'setGatewayConnectionStatus',
    );
  };

  setGatewayConnectionState = (state: GatewayConnectionState): void => {
    this.#set(
      { gatewayConnectionState: state, gatewayConnectionStatus: state.status },
      false,
      'setGatewayConnectionState',
    );
  };

  updateDeviceDescription = async (description: string): Promise<void> => {
    try {
      await gatewayConnectionService.setDeviceDescription(description);
      await this.#get().refreshGatewayDeviceInfo();
    } catch (error) {
      console.error('Update device description failed:', error);
    }
  };

  updateDeviceName = async (name: string): Promise<void> => {
    try {
      await gatewayConnectionService.setDeviceName(name);
      await this.#get().refreshGatewayDeviceInfo();
    } catch (error) {
      console.error('Update device name failed:', error);
    }
  };

  useFetchGatewayDeviceInfo = (enabled = true): SWRResponse<GatewayDeviceInfo> => {
    return useSWR<GatewayDeviceInfo>(
      enabled ? electronKeys.gatewayDeviceInfo() : null,
      async () => gatewayConnectionService.getDeviceInfo() as Promise<GatewayDeviceInfo>,
      {
        onSuccess: (data) => {
          this.#set({ gatewayDeviceInfo: data }, false, 'setGatewayDeviceInfo');
        },
      },
    );
  };

  useFetchGatewayStatus = (): SWRResponse<GatewayConnectionState> => {
    return useSWR<GatewayConnectionState>(
      'electron:getGatewayConnectionStatus',
      async () => gatewayConnectionService.getConnectionStatus(),
      {
        onSuccess: (data) => {
          this.setGatewayConnectionState(data);
        },
      },
    );
  };
}

export type ElectronGatewayAction = Pick<
  ElectronGatewayActionImpl,
  keyof ElectronGatewayActionImpl
>;
