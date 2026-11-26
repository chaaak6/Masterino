export type Traversal = Generator<Traversal, void, void>;

/** Run one continuation at a time while retaining the order of depth-first traversal. */
export function runTraversal(root: Traversal): void {
  const first = root.next();
  if (first.done) return;

  const pending = [root, first.value];
  try {
    while (pending.length) {
      const step = pending.at(-1)!.next();
      if (step.done) pending.pop();
      else pending.push(step.value);
    }
  } finally {
    // Unwind any temporary children-map overrides on failure.
    while (pending.length) pending.pop()!.return();
  }
}
