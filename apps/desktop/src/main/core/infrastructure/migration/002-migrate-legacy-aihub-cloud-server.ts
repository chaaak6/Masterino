import { defineMigration } from './defineMigration';

export default defineMigration({
  id: '002-migrate-legacy-aihub-cloud-server',
  up: (store) => {
    const config = store.get('dataSyncConfig');
    if (
      config?.storageMode !== 'cloud' ||
      !/^https:\/\/aihub\.bielcrystal\.com\/?$/i.test(config.remoteServerUrl?.trim() ?? '')
    )
      return;

    // The new issuer requires a fresh authorization. Existing credentials
    // remain scoped to their original issuer by RemoteServerConfigCtr.
    store.set('dataSyncConfig', {
      ...config,
      active: false,
      remoteServerUrl: 'https://masterino.bielcrystal.com',
    });
  },
});
