import { createServer } from 'node:http';

import { loadConfig } from './config.js';
import { createBridgeHandler, handleNodeRequest } from './http.js';
import { AihubBridgeRepository } from './repository.js';

const config = loadConfig();
const repository = new AihubBridgeRepository({
  connectionString: config.connectionString,
  queryTimeoutMs: config.queryTimeoutMs,
});
const handler = createBridgeHandler({
  bridgeToken: config.bridgeToken,
  iamProviderId: config.iamProviderId,
  managedTokenName: config.managedTokenName,
  repository,
});
const server = createServer(handleNodeRequest(handler));

server.listen(config.port, '0.0.0.0', () => {
  console.log(`aihub-db-bridge listening on ${config.port}`);
});
