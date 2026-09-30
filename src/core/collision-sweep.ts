import type { ReadonlyLayout } from '../helpers/types'

/**
 * Whether any two items overlap. Sweeps items by top edge and keeps only those still open at
 * the current row, so a stacked (mobile) layout checks each item against a handful of others
 * instead of all of them. Edges that only touch do not overlap, and items that share an id are
 * never counted as overlapping, matching the pairwise `collides` check.
 *
 * Answers existence only: callers that report which item collides run their pairwise loop after
 * this returns `true`, so the reported index and path stay as before.
 */
export function hasAnyCollision(layout: ReadonlyLayout): boolean {
  const order = Array.from(layout.keys()).sort((a, b) => layout[a].y - layout[b].y)
  const active: number[] = []
  for (const index of order) {
    const item = layout[index]
    let kept = 0
    for (const other of active) {
      const candidate = layout[other]
      if (candidate.y + candidate.h <= item.y) continue
      active[kept++] = other
      if (
        !Object.is(candidate.i, item.i) &&
        candidate.x < item.x + item.w &&
        candidate.x + candidate.w > item.x &&
        candidate.y < item.y + item.h
      ) {
        return true
      }
    }
    active.length = kept
    active.push(index)
  }
  return false
}
