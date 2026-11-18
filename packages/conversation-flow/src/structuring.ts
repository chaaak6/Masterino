import type { HelperMaps, IdNode } from './types';

/**
 * Phase 2: Structuring
 * Converts flat parent-child relationships into a tree structure
 * Separates main flow from threaded conversations
 *
 * @param helperMaps - Maps built in indexing phase
 * @returns Root nodes of the main conversation flow (idTree)
 */
export function buildIdTree(helperMaps: HelperMaps): IdNode[] {
  const { childrenMap, messageMap } = helperMaps;

  const mainFlowNodes = (ids: string[]): IdNode[] =>
    ids
      .filter((id) => messageMap.has(id) && !messageMap.get(id)?.threadId)
      .map((id) => ({ children: [], id }));

  const roots = mainFlowNodes(childrenMap.get(null) ?? []);
  const pending = [...roots];

  while (pending.length) {
    const node = pending.pop()!;
    node.children = mainFlowNodes(childrenMap.get(node.id) ?? []);
    for (const child of node.children) pending.push(child);
  }

  return roots;
}
