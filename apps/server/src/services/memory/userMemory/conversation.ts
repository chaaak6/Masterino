const MAX_MESSAGE_CHARACTERS = 32_000;

/** Tool outputs may contain entire documents and are not user conversation. */
export const prepareMemoryConversationMessage = (row: {
  content: string | null;
  role: string | null;
}) => {
  if (row.role !== 'user' && row.role !== 'assistant') return undefined;
  if (typeof row.content !== 'string' || !row.content.trim()) return undefined;

  return {
    content:
      row.content.length > MAX_MESSAGE_CHARACTERS
        ? `${row.content.slice(0, MAX_MESSAGE_CHARACTERS / 2)}\n…\n${row.content.slice(-MAX_MESSAGE_CHARACTERS / 2)}`
        : row.content,
    role: row.role,
  };
};
