import { describe, expect, it } from 'vitest'

import { compact as oracleCompact } from './oracle/v1-1-1-common'
import {
  compactV1,
  createV1Compactor,
  v1NoVerticalCompactor,
  v1VerticalCompactor,
} from '../src/core/v1-compactor'
import {
  v1NoVerticalCompactor as rootNoVertical,
  v1VerticalCompactor as rootVertical,
} from '../src'

import type { Layout as OracleLayout } from './oracle/v1-1-1-types'
import type { Layout, LayoutItem } from '../src'

function rng(seed: number) {
  let state = seed >>> 0
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

interface Shape {
  cols: number
  count: number
  staticRate: number
  maxY: number
}

function randomLayout(seed: number, shape: Shape): Layout {
  const random = rng(seed)
  return Array.from({ length: shape.count }, (_, i) => {
    const w = 1 + Math.floor(random() * shape.cols)
    return {
      i,
      x: Math.floor(random() * (shape.cols - w + 1)),
      y: Math.floor(random() * shape.maxY),
      w,
      h: 1 + Math.floor(random() * 5),
      ...(random() < shape.staticRate ? { static: true } : {}),
    }
  })
}

function oracleYs(layout: Layout, vertical: boolean): number[] {
  const copy: OracleLayout = layout.map(item => ({ ...item }))
  oracleCompact(copy, vertical)
  return copy.map(item => item.y)
}

function deepFreeze(layout: Layout): Layout {
  layout.forEach(item => Object.freeze(item))
  return Object.freeze(layout) as Layout
}

const SHAPES: Shape[] = [
  { cols: 12, count: 40, staticRate: 0, maxY: 30 },
  { cols: 12, count: 60, staticRate: 0.08, maxY: 40 },
  { cols: 1, count: 50, staticRate: 0.05, maxY: 60 },
  { cols: 36, count: 80, staticRate: 0.1, maxY: 20 },
  { cols: 5, count: 25, staticRate: 0.2, maxY: 8 },
]

describe('compactV1 matches grid-layout-plus v1.1.1 compact()', () => {
  for (const vertical of [true, false]) {
    it(`random layouts, vertical=${vertical}`, () => {
      let checked = 0
      for (const shape of SHAPES) {
        for (let seed = 1; seed <= 400; seed++) {
          const layout = randomLayout(seed * 7919 + shape.cols, shape)
          const expected = oracleYs(layout, vertical)
          const actual = compactV1(deepFreeze(layout.map(item => ({ ...item }))), vertical).map(
            i => i.y,
          )
          expect(actual, `cols ${shape.cols} seed ${seed}`).toEqual(expected)
          checked++
        }
      }
      expect(checked).toBe(2000)
    })
  }

  // The v1 oracle is cubic on this shape: ~0.4 s normally, ~13 s under `test:cover` (v8 block
  // coverage slows its hot loop), so the default 10 s timeout is too short for CI.
  it('mobile transition shape: desktop y kept, everything full width', { timeout: 60_000 }, () => {
    for (let seed = 1; seed <= 50; seed++) {
      const desktop = randomLayout(seed, { cols: 12, count: 300, staticRate: 0, maxY: 200 })
      const mobile = desktop.map(item => ({ ...item, x: 0, w: 12 }))
      expect(compactV1(mobile, true).map(i => i.y)).toEqual(oracleYs(mobile, true))
    }
  })

  it('ties on the same (x, y) keep input order like v1', () => {
    const layout: Layout = [
      { i: 'b', x: 0, y: 3, w: 2, h: 1 },
      { i: 'a', x: 0, y: 3, w: 2, h: 1 },
      { i: 'c', x: 0, y: 3, w: 2, h: 2 },
    ]
    expect(compactV1(layout, true).map(i => i.y)).toEqual(oracleYs(layout, true))
  })

  it('edge inputs: empty, single, all static, huge y', () => {
    expect(compactV1([], true)).toEqual([])
    expect(compactV1([{ i: 1, x: 0, y: 9, w: 1, h: 1 }], true)[0].y).toBe(0)
    const statics: Layout = [
      { i: 1, x: 0, y: 5, w: 2, h: 2, static: true },
      { i: 2, x: 0, y: 5, w: 2, h: 2, static: true },
    ]
    expect(compactV1(statics, true).map(i => i.y)).toEqual([5, 5])
    const far: Layout = [{ i: 1, x: 0, y: 1_000_000, w: 1, h: 1 }]
    expect(compactV1(far, true)[0].y).toBe(0)
  })
})

describe('compactor contract', () => {
  it('never mutates its input and returns detached items differing only in y', () => {
    const input = deepFreeze([
      { i: 1, x: 0, y: 4, w: 2, h: 1, moved: true, meta: { tag: 'x' } } as LayoutItem,
      { i: 2, x: 0, y: 0, w: 2, h: 1 },
    ])
    const output = v1VerticalCompactor.compact(input, 12)
    expect(output).not.toBe(input)
    expect(output[0]).not.toBe(input[0])
    expect(output.map(i => i.i)).toEqual([1, 2])
    expect(output[0]).toEqual({ ...input[0], y: 1 })
    expect(output[0].moved).toBe(true)
  })

  it('is exported from the package root', () => {
    expect(rootVertical).toBe(v1VerticalCompactor)
    expect(rootNoVertical).toBe(v1NoVerticalCompactor)
    expect(createV1Compactor({ vertical: true }).type).toBe('vertical')
  })
})
