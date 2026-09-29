import { describe, expect, it } from 'vitest'

import { gridToPixelRect } from '../src/core/utils'
import { roundedStrategy, transformStrategy, v1PixelStrategy } from '../src'

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
