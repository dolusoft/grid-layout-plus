import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'

import { GridLayoutValidationError } from '../src/core/errors'
import { gridToPixelRect } from '../src/core/utils'
import { snapshotPositionStrategy } from '../src/core/validation'
import { GridLayout, roundedStrategy, transformStrategy, v1PixelStrategy } from '../src'

import type { Layout, PositionStrategy } from '../src'

// grid-layout-plus v1.1.1 grid-item.vue calcPosition(), verbatim arithmetic order
function v1Box(
  width: number,
  cols: number,
  margin: number,
  rowHeight: number,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const colWidth = (width - margin * (cols + 1)) / cols
  return {
    left: Math.round(colWidth * x + margin * (x + 1)),
    top: Math.round(rowHeight * y + margin * (y + 1)),
    width: Math.round(colWidth * w + Math.max(0, w - 1) * margin),
    height: Math.round(rowHeight * h + Math.max(0, h - 1) * margin),
  }
}

describe('pixel geometry matches v1.1.1 once rounded', () => {
  it('every column start, span and row across widths, grids and margins', () => {
    let mismatches = 0
    let checked = 0
    for (const [cols, margin] of [
      [36, 10],
      [12, 6],
      [12, 10],
      [36, 6],
    ] as const) {
      for (let width = 300; width <= 2600; width++) {
        const colWidth = (width - margin * (cols + 1)) / cols
        if (colWidth <= 0) continue
        const rowHeight = Math.max(Math.round(colWidth), 1)
        for (let x = 0; x < cols; x++) {
          const w = 1 + ((x * 7) % (cols - x))
          const y = x % 9
          const h = 1 + (x % 5)
          const rect = gridToPixelRect(
            { i: 0, x, y, w, h },
            {
              width,
              cols,
              rowHeight,
              gap: [margin, margin],
              containerPadding: [margin, margin],
              rtl: false,
              effectiveScale: 1,
            },
          )
          const expected = v1Box(width, cols, margin, rowHeight, x, y, w, h)
          const actual = {
            left: Math.round(rect.inlineStart),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          }
          checked++
          if (JSON.stringify(actual) !== JSON.stringify(expected)) mismatches++
        }
      }
    }
    expect(checked).toBeGreaterThan(200_000)
    expect(mismatches).toBe(0)
  })

  it('roundedStrategy rounds every value and keeps the base strategy flags', () => {
    const style = v1PixelStrategy.getStyle(10.4, 227.49999999999997, 99.5, 40.5)
    expect(style).toEqual(transformStrategy.getStyle(10, 227, 100, 41))
    expect(v1PixelStrategy.usesCssTransforms).toBe(transformStrategy.usesCssTransforms)
    expect(roundedStrategy(transformStrategy).getRtlStyle(1.5, 2.5, 3.5, 4.5)).toEqual(
      transformStrategy.getRtlStyle(2, 3, 4, 5),
    )
  })
})

describe('v1PixelStrategy inside GridLayout', () => {
  // 1063px, 12 columns and a 10px margin give a fractional column width (78.4166...px).
  const width = 1063
  const cols = 12
  const margin = 10
  const rowHeight = 30
  const layout: Layout = [
    { i: 'a', x: 0, y: 0, w: 3, h: 2 },
    { i: 'b', x: 3, y: 0, w: 5, h: 3 },
    { i: 'c', x: 8, y: 0, w: 4, h: 1 },
    { i: 'd', x: 1, y: 3, w: 7, h: 2 },
    { i: 'e', x: 11, y: 1, w: 1, h: 4 },
  ]

  async function mountGrid(positionStrategy: PositionStrategy, errors: unknown[]) {
    const wrapper = mount(GridLayout, {
      props: {
        layout,
        colNum: cols,
        rowHeight,
        gap: [margin, margin],
        containerPadding: [margin, margin],
        width,
        positionStrategy,
        onError: (error: unknown) => errors.push(error),
      },
      slots: {
        item: ({ item }: { item: { i: string | number } }) => h('span', String(item.i)),
      },
      attachTo: document.body,
    })
    await nextTick()
    await nextTick()
    await nextTick()
    return wrapper
  }

  it('positions every item with v1 pixels on a fractional column width and emits no error', async () => {
    const errors: unknown[] = []
    const wrapper = await mountGrid(v1PixelStrategy, errors)

    expect(errors).toEqual([])
    const items = wrapper.findAll('.vgl-item:not(.vgl-item--placeholder)')
    expect(items).toHaveLength(layout.length)
    for (const [index, item] of layout.entries()) {
      const box = v1Box(width, cols, margin, rowHeight, item.x, item.y, item.w, item.h)
      const style = items[index].attributes('style') ?? ''
      expect(style).toContain(`transform: translate3d(${box.left}px, ${box.top}px, 0)`)
      expect(style).toContain(`width: ${box.width}px`)
      expect(style).toContain(`height: ${box.height}px`)
    }
    wrapper.unmount()
  })

  it('still rejects a rounding strategy that writes pixels other than the rounded geometry', async () => {
    const errors: Array<{ code?: unknown }> = []
    const shifted: PositionStrategy = {
      ...v1PixelStrategy,
      getStyle: (top, left, itemWidth, itemHeight) =>
        v1PixelStrategy.getStyle(top, left + 1, itemWidth, itemHeight),
    }
    const wrapper = await mountGrid(shifted, errors)

    expect(errors.map(error => error.code)).toContain('extension-invalid-result')
    wrapper.unmount()
  })

  it('still rejects rounded pixels from a strategy that does not declare roundsGeometry', async () => {
    const errors: Array<{ code?: unknown }> = []
    const undeclared: PositionStrategy = {
      usesCssTransforms: true,
      getStyle: (top, left, itemWidth, itemHeight) =>
        transformStrategy.getStyle(
          Math.round(top),
          Math.round(left),
          Math.round(itemWidth),
          Math.round(itemHeight),
        ),
      getRtlStyle: transformStrategy.getRtlStyle,
    }
    const wrapper = await mountGrid(undeclared, errors)

    expect(errors.map(error => error.code)).toContain('extension-invalid-result')
    wrapper.unmount()
  })

  it('keeps roundsGeometry in the strategy snapshot and rejects a non-boolean value', () => {
    expect(snapshotPositionStrategy(v1PixelStrategy).roundsGeometry).toBe(true)
    expect(snapshotPositionStrategy(transformStrategy)).not.toHaveProperty('roundsGeometry')
    expect(() => snapshotPositionStrategy({ ...transformStrategy, roundsGeometry: 1 })).toThrow(
      GridLayoutValidationError,
    )
  })
})
