import { createInterface } from 'node:readline';

const io = createInterface({ input: process.stdin });
let calls = 0;
for await (const line of io) {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) continue;
  let result;
  switch (method) {
    case 'initialize': {
      result = {
        capabilities: { tools: {} },
        protocolVersion: params.protocolVersion,
        serverInfo: { name: 'synthetic-cad', version: '1' },
      };
      break;
    }
    case 'tools/list': {
      result = {
        tools: ['inspect', 'write'].map((name) => ({
          inputSchema: { properties: {}, type: 'object' },
          name,
        })),
      };
      break;
    }
    case 'tools/call': {
      if (params.arguments?.rejectArguments) {
        process.stdout.write(
          JSON.stringify({
            error: { code: -32602, message: 'Invalid drawing argument' },
            id,
            jsonrpc: '2.0',
          }) + '\n',
        );
        continue;
      }
      calls++;
      result = {
        content: [{ text: 'factory-r03.dxf', type: 'text' }],
        structuredContent: { calls },
      };
      break;
    }
    default: {
      result = {};
    }
  }
  const response = JSON.stringify({ id, jsonrpc: '2.0', result }) + '\n';
  if (method === 'tools/call' && params.arguments?.exitAfterReply) {
    process.stdout.write(response, () => process.exit(0));
  } else {
    process.stdout.write(response);
  }
}
