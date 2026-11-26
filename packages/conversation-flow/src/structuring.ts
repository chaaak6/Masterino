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

  const mainFlowNodes = (ids: string[] | undefined): IdNode[] => {
    const nodes: IdNode[] = [];
    for (const id of ids ?? []) {
      const message = messageMap.get(id);
      if (message && !message.threadId) nodes.push({ children: [], id });
    }
    return nodes;
  };

  const roots = mainFlowNodes(childrenMap.get(null));
  const pending = [...roots];

  while (pending.length) {
    const node = pending.pop()!;
    const children = childrenMap.get(node.id);
    if (!children?.length) continue;
    node.children = mainFlowNodes(children);
    for (const child of node.children) pending.push(child);
  }

  return roots;
}
