export function parseCatalogMcp(value: string): { identifier: string; url: string; headers: Record<string, string> } {
  const json = JSON.parse(value);
  const servers = json.mcpServers || json;
  const entries = Object.entries(servers);
  if (entries.length !== 1) throw new Error('每次请导入一个 MCP 服务');
  const [identifier, config] = entries[0] as [string, any];
  if (!config.url || (config.type && config.type !== 'http')) throw new Error('目前支持远程 Streamable HTTP MCP');
  new URL(config.url);
  return { identifier, url: config.url, headers: config.headers || {} };
}
