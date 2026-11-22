// Where a tab lands when it is dragged or moved with the keyboard. Pure module (no Obsidian
// imports) so it is testable.

/**
 * The list with the item at `from` moved in front of the item that was at `before`; `before`
 * equal to the length puts it last. The same list comes back when nothing moves.
 */
export function moveBefore<T>(items: readonly T[], from: number, before: number): readonly T[] {
  if (from < 0 || from >= items.length || before < 0 || before > items.length) return items;
  if (before === from || before === from + 1) return items;
  const moved = items.filter((_, i) => i !== from);
  moved.splice(before > from ? before - 1 : before, 0, items[from]);
  return moved;
}

/** Whether a drop at `x` goes in front of a tab spanning `left` to `right`, rather than after it. */
export function dropsBefore(x: number, left: number, right: number): boolean {
  return x < (left + right) / 2;
}
