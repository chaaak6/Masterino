import { describe, expect, it } from 'vitest';
import { parseCatalogMcp } from './catalogImport';

describe('MCP JSON import', () => {
  it('Given Yuandian JSON, When imported, Then the URL and Bearer header are retained', () => {
    expect(parseCatalogMcp(JSON.stringify({ mcpServers: { 'yuandian-law': { type: 'http', url: 'https://open.chineselaw.com/mcp', headers: { Authorization: 'Bearer test-key', Accept: 'application/json, text/event-stream' } } } }))).toEqual({ identifier: 'yuandian-law', url: 'https://open.chineselaw.com/mcp', headers: { Authorization: 'Bearer test-key', Accept: 'application/json, text/event-stream' } });
  });
  it('Given multiple servers, Then the administrator must import one explicitly', () => {
    expect(() => parseCatalogMcp('{"mcpServers":{"a":{},"b":{}}}')).toThrow('一个');
  });
});
