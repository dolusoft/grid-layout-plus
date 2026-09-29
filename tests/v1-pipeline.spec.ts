import { describe, expect, it } from 'vitest'
import { effectScope } from 'vue'

import {
  compact as oracleCompact,
  correctBounds as oracleCorrectBounds,
} from './oracle/v1-1-1-common'
import { useGridLayout } from '../src/composables/useGridLayout'
import {
  createCompleteResponsiveLayouts,
  snapshotResponsiveConfig,
} from '../src/helpers/responsive'
import { normalizeLayout } from '../src/core/normalize'
import { verticalCompactor } from '../src/core/compactors'
import { v1NoVerticalCompactor, v1VerticalCompactor } from '../src/core/v1-compactor'
import { GridLayoutExtensionError } from '../src'

import type { Layout as OracleLayout } from './oracle/v1-1-1-types'
import type { Layout } from '../src'

function rng(seed: number) {
  let state = seed >>> 0
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

function collidingLayout(seed: number): { cols: number; layout: Layout } {
  const random = rng(seed)
  const cols = 1 + Math.floor(random() * 12)
  const count = 3 + Math.floor(random() * 25)
  const layout = Array.from({ length: count }, (_, i) => {
    const w = 1 + Math.floor(random() * cols)
    return {
      i,
      x: Math.floor(random() * (cols - w + 1)),
      y: Math.floor(random() * 12),
      w,
      h: 1 + Math.floor(random() * 4),
    }
  })
  return { cols, layout }
}

function oracle(layout: Layout, vertical: boolean): Array<[number, number]> {
  const copy: OracleLayout = layout.map(item => ({ ...item }))
  oracleCompact(copy, vertical)
  return copy.map(item => [item.x, item.y])
}

const positions = (layout: Layout) => layout.map(item => [item.x, item.y] as [number, number])

describe('normalizeLayout with a v1 compactor', () => {
  it('equals v1 compact() on colliding input (vertical)', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const { cols, layout } = collidingLayout(seed)
      const result = normalizeLayout(layout, {
        cols,
        collisionMode: 'push',
        compactor: v1VerticalCompactor,
      })
      expect(positions(result), `seed ${seed}`).toEqual(oracle(layout, true))
    }
  })

  it('equals v1 compact() on colliding input (no vertical compaction)', () => {
    for (let seed = 1; seed <= 500; seed++) {
      const { cols, layout } = collidingLayout(seed)
      const result = normalizeLayout(layout, {
        cols,
        collisionMode: 'push',
        compactor: v1NoVerticalCompactor,
      })
      expect(positions(result), `seed ${seed}`).toEqual(oracle(layout, false))
    }
  })

  it('mobile transition: full-width copies of a desktop layout', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const random = rng(seed)
      const layout = Array.from({ length: 300 }, (_, i) => ({
        i,
        x: 0,
        y: Math.floor(random() * 400),
        w: 12,
        h: 1 + Math.floor(random() * 8),
      }))
      const result = normalizeLayout(layout, {
        cols: 12,
        collisionMode: 'push',
        compactor: v1VerticalCompactor,
      })
      expect(positions(result), `seed ${seed}`).toEqual(oracle(layout, true))
    }
  })

  it('leaves the built-in compactors on the push pre-pass (upstream behaviour unchanged)', () => {
    const layout: Layout = [
      { i: 0, x: 2, y: 11, w: 3, h: 2 },
      { i: 1, x: 1, y: 4, w: 2, h: 3 },
      { i: 2, x: 1, y: 8, w: 3, h: 2 },
      { i: 3, x: 0, y: 8, w: 5, h: 1 },
      { i: 4, x: 0, y: 7, w: 2, h: 1 },
      { i: 5, x: 2, y: 2, w: 3, h: 2 },
      { i: 6, x: 1, y: 2, w: 4, h: 4 },
    ]
    const result = normalizeLayout(layout, {
      cols: 5,
      collisionMode: 'push',
      compactor: verticalCompactor,
    })
    expect(result.map(i => i.y)).toMatchSnapshot()
  })

  it('reports colliding statics as an extension error, not a silent overlap', () => {
    const layout: Layout = [
      { i: 1, x: 0, y: 0, w: 2, h: 2, static: true },
      { i: 2, x: 1, y: 1, w: 2, h: 2, static: true },
    ]
    expect(() =>
      normalizeLayout(layout, { cols: 4, collisionMode: 'push', compactor: v1VerticalCompactor }),
    ).toThrow(GridLayoutExtensionError)
  })

  it('snapshots and compares the flag in engine config', async () => {
    const { snapshotCompactor } = await import('../src/core/validation')
    expect(snapshotCompactor(v1VerticalCompactor).resolvesCollisions).toBe(true)
    expect(snapshotCompactor(verticalCompactor).resolvesCollisions).toBeUndefined()
    expect(() => snapshotCompactor({ compact: () => [], resolvesCollisions: 'yes' })).toThrow()
  })
})

describe('v1 compactor through the responsive and engine paths', () => {
  function desktopLayout(seed: number): Layout {
    const random = rng(seed)
    return Array.from({ length: 20 }, (_, i) => {
      const w = 1 + Math.floor(random() * 12)
      return {
        i,
        x: Math.floor(random() * (12 - w + 1)),
        y: Math.floor(random() * 20),
        w,
        h: 1 + Math.floor(random() * 4),
      }
    })
  }

  // v1 generateResponsiveLayout: correctBounds, then compact
  function oracleResponsive(layout: Layout, cols: number): Array<[number, number, number]> {
    const copy: OracleLayout = layout.map(item => ({ ...item }))
    oracleCorrectBounds(copy, { cols })
    oracleCompact(copy, true)
    return copy.map(item => [item.x, item.y, item.w])
  }

  it('derives a 6-column layout from a 12-column one like v1', () => {
    const config = snapshotResponsiveConfig<'lg' | 'md'>({ lg: 996, md: 0 }, { lg: 12, md: 6 })
    for (let seed = 1; seed <= 200; seed++) {
      const lg = desktopLayout(seed)
      const complete = createCompleteResponsiveLayouts({ lg }, [], config, {
        maxRows: Infinity,
        collisionMode: 'push',
        compactor: v1VerticalCompactor,
      })
      expect(
        complete.md.map(item => [item.x, item.y, item.w]),
        `seed ${seed}`,
      ).toEqual(oracleResponsive(lg, 6))
    }
  })

  it('setLayout on useGridLayout places items like v1', () => {
    const scope = effectScope()
    const api = scope.run(() =>
      useGridLayout({ layout: [], cols: 12, compactor: v1VerticalCompactor }),
    )
    if (!api) throw new Error('effect scope did not run')
    try {
      for (let seed = 1; seed <= 50; seed++) {
        const layout = desktopLayout(seed)
        expect(api.setLayout(layout).status, `seed ${seed}`).toBe('accepted')
        expect(positions(api.layout.value as Layout), `seed ${seed}`).toEqual(oracle(layout, true))
      }
    } finally {
      scope.stop()
    }
  })
})
