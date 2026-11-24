import type { UIChatMessage } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import { mergeHistoryPage, sharesOlderHistory } from './useMessageHistory';

const row = (id: string, createdAt: number, updatedAt = createdAt): UIChatMessage => ({
  content: id,
  createdAt,
  id,
  role: 'user',
  updatedAt,
});

describe('chat history pages', () => {
  it('preserves older pages and newer local edits when the newest page refreshes', () => {
    const earlier = row('earlier', 1);
    const displaced = row('displaced', 2);
    const localEdit = { ...row('latest', 3, 10), content: 'Local edit' };
    const result = mergeHistoryPage(
      [earlier, displaced, localEdit],
      {
        messages: [row('latest', 3), row('new', 4)],
        nextCursor: { createdAt: '1970-01-01T00:00:00.003Z', id: 'latest' },
      },
      new Set(['displaced', 'latest']),
      true,
    );
    expect(result).toEqual([earlier, displaced, localEdit, row('new', 4)]);
  });

  it('keeps older history when a fork only affects the refreshed window', () => {
    const older = row('older', 1);
    const recent = row('recent-fork', 3);
    const unselected = row('inactive-branch', 4);
    const selected = row('selected-branch', 5);
    const page = {
      branchSelections: { [recent.id]: selected.id },
      messages: [recent, selected],
      nextCursor: { createdAt: '1970-01-01T00:00:00.003Z', id: recent.id },
    };

    expect(sharesOlderHistory({}, page)).toBe(true);
    expect(
      mergeHistoryPage([older, recent, unselected], page, new Set([unselected.id]), true),
    ).toEqual([older, recent, selected]);
    expect(sharesOlderHistory({ [recent.id]: unselected.id }, page)).toBe(false);
    expect(sharesOlderHistory({}, { ...page, branchSelections: { [older.id]: selected.id } })).toBe(
      false,
    );
  });

  it('deduplicates a prepended page and preserves newer writes', () => {
    const current = { ...row('overlap', 2, 7), content: 'Current content' };
    const result = mergeHistoryPage(
      [current, row('recent', 4)],
      { messages: [row('older', 1), row('overlap', 2)] },
      new Set(),
      false,
    );
    expect(result).toEqual([row('older', 1), current, row('recent', 4)]);
  });
});
