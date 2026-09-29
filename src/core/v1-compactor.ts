import type { Compactor, Layout, ReadonlyLayout } from '../helpers/types'

/** Options for {@link createV1Compactor}. */
export interface V1CompactorOptions {
  /** v1 `verticalCompact`: move each item up into free rows before resolving overlaps. */
  readonly vertical: boolean
}

/**
 * grid-layout-plus v1.1.1 `compact(layout, verticalCompact)` semantics, without mutating input.
 *
 * Items are visited in row, then column order (ties keep input order). Static items stay where
 * they are and are obstacles from the start. Each other item first moves up while it is free
 * (only when `vertical`), stopping at the first row that overlaps an earlier item or at row 0,
 * then moves down to the lowest free row at or below that point. v1 walks one row at a time
 * and rescans all earlier items on every step; this computes the same stops directly with one
 * scan of the earlier items that share a column, which is why it is linear-ish instead of
 * cubic on a single-column (mobile) layout.
 *
 * Unlike the library's own compactors, the input is not validated: v1 accepted any record and
 * so does this. Returned items are shallow copies that differ from the input only in `y`.
 *
 * @param layout - The layout to compact; never mutated.
 * @param vertical - v1 `verticalCompact`; `false` only resolves overlaps downwards.
 * @returns A new layout in input order.
 */
export function compactV1(layout: ReadonlyLayout, vertical: boolean): Layout {
  const count = layout.length
  const xs = new Float64Array(count)
  const ys = new Float64Array(count)
  const ws = new Float64Array(count)
  const hs = new Float64Array(count)
  for (let k = 0; k < count; k++) {
    const item = layout[k]
    xs[k] = item.x
    ys[k] = item.y
    ws[k] = item.w
    hs[k] = item.h
  }

  // v1 sortLayoutItemsByRowCol: by y, then x; Array.prototype.sort is stable, so ties keep input order
  const order = Array.from({ length: count }, (_, k) => k).sort((a, b) =>
    ys[a] === ys[b] ? xs[a] - xs[b] : ys[a] - ys[b],
  )

  const placed: number[] = []
  for (let k = 0; k < count; k++) {
    if (layout[k].static) placed.push(k)
  }

  const candidates: number[] = []
  for (const k of order) {
    if (layout[k].static) continue
    const left = xs[k]
    const right = left + ws[k]
    const height = hs[k]

    candidates.length = 0
    for (const p of placed) {
      if (xs[p] < right && xs[p] + ws[p] > left) candidates.push(p)
    }

    let y = ys[k]
    if (vertical && y > 0) {
      let overlapsAtStart = false
      for (const p of candidates) {
        if (ys[p] < y + height && ys[p] + hs[p] > y) {
          overlapsAtStart = true
          break
        }
      }
      if (!overlapsAtStart) {
        // v1 steps up while free and stops on the first overlapping row: the highest row below
        // the start that overlaps some candidate, or 0 when none does.
        let stop = 0
        for (const p of candidates) {
          const highest = Math.min(y - 1, ys[p] + hs[p] - 1)
          if (highest >= ys[p] - height + 1 && highest > stop) stop = highest
        }
        y = stop
      }
    }

    // v1 jumps below each overlapping item until free; a jump never skips a free row, so the
    // result is the lowest free row >= y. Candidates sorted by top find it in one pass.
    candidates.sort((a, b) => ys[a] - ys[b])
    for (const p of candidates) {
      if (ys[p] >= y + height) break
      if (ys[p] + hs[p] > y) y = ys[p] + hs[p]
    }

    ys[k] = y
    placed.push(k)
  }

  return layout.map((item, k) => ({ ...item, y: ys[k] }))
}

/**
 * Creates a compactor with grid-layout-plus v1.1.1 `compact()` semantics.
 *
 * The `cols` argument of {@link Compactor.compact} is ignored, as it was in v1.
 */
export function createV1Compactor(options: V1CompactorOptions): Compactor {
  const vertical = options.vertical
  return Object.freeze({
    type: 'vertical' as const,
    compact: (layout: ReadonlyLayout) => compactV1(layout, vertical),
  })
}

/** v1.1.1 with `verticalCompact: true`. */
export const v1VerticalCompactor: Compactor = createV1Compactor({ vertical: true })

/** v1.1.1 with `verticalCompact: false`: overlaps are resolved downwards, gaps stay. */
export const v1NoVerticalCompactor: Compactor = createV1Compactor({ vertical: false })
