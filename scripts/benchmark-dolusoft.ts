// Side-by-side compaction benchmark: grid-layout-plus v1.1.1 `compact()` vs `compactV1` vs the
// beta compactors. Evidence for the dolusoft fork only; it does not enforce timing thresholds.
//
// Usage: pnpm run benchmark:dolusoft [-- --json <file>] [--only <row id>[,<row id>...]]
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'

import { reactive } from 'vue'

import { compactV1, v1VerticalCompactor } from '../src/core/v1-compactor'
import { fastVerticalCompactor, verticalCompactor } from '../src/core/compactors'
import { normalizeLayout } from '../src/core/normalize'
import { compact as v1Compact } from '../tests/oracle/v1-1-1-common'

import type { Layout } from '../src/helpers/types'

const COLS = 12
const WARMUPS = 1
const SAMPLES = 5

interface Cell {
  medianMs: number
  checksum: number
}

interface Row {
  id: string
  shape: string
  n: number
  cells: Record<string, Cell>
}

function readOption(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index < 0) return undefined
  const value = process.argv[index + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${name} needs a value`)
  return value
}

const jsonPath = readOption('--json')
const only = readOption('--only')?.split(',')

function rng(seed: number) {
  let state = seed >>> 0
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

function clone(layout: Layout): Layout {
  return layout.map(item => ({ ...item }))
}

/** Desktop dashboard: 12 columns, widths 3/4/6, heights 2..5, packed by v1 `compact()`. */
function desktop(n: number): Layout {
  const random = rng(1)
  const widths = [3, 4, 6]
  const layout: Layout = []
  let x = 0
  let y = 0
  let rowHeight = 0
  for (let i = 0; i < n; i++) {
    const w = widths[Math.floor(random() * widths.length)]
    const h = 2 + Math.floor(random() * 4)
    if (x + w > COLS) {
      x = 0
      y += rowHeight
      rowHeight = 0
    }
    layout.push({ i, x, y, w, h })
    x += w
    rowHeight = Math.max(rowHeight, h)
  }
  v1Compact(layout, true)
  return layout
}

/** Mobile transition: every item full width, desktop `y` kept, so compaction must re-stack. */
function mobileFromDesktop(n: number): Layout {
  return desktop(n).map(item => ({ ...item, x: 0, w: COLS }))
}

/** Mobile steady state: already stacked in one column. */
function mobileStacked(n: number): Layout {
  let y = 0
  return desktop(n).map(item => {
    const stacked = { ...item, x: 0, w: COLS, y }
    y += item.h
    return stacked
  })
}

function checksum(layout: Layout): number {
  let sum = 0
  for (let index = 0; index < layout.length; index++) {
    sum = (sum + layout[index].x * 31 + layout[index].y * 17 + index) >>> 0
  }
  return sum
}

function collectGarbage(): void {
  ;(globalThis as { gc?: () => void }).gc?.()
}

/** Median of `SAMPLES` timed runs after `WARMUPS`; `run` returns the layout it produced. */
function measure(prepare: () => Layout, run: (layout: Layout) => Layout): Cell {
  let result: Layout = []
  for (let k = 0; k < WARMUPS; k++) run(prepare())
  const durations: number[] = []
  for (let k = 0; k < SAMPLES; k++) {
    const input = prepare()
    collectGarbage()
    const start = performance.now()
    result = run(input)
    durations.push(performance.now() - start)
  }
  durations.sort((a, b) => a - b)
  return {
    medianMs: Number(durations[Math.floor(durations.length / 2)].toFixed(2)),
    checksum: checksum(result),
  }
}

const COLUMNS: Record<string, (base: Layout) => Cell> = {
  'v1 raw': base =>
    measure(
      () => clone(base),
      layout => {
        v1Compact(layout, true)
        return layout
      },
    ),
  'v1 reactive()': base =>
    measure(
      () => reactive(clone(base)),
      layout => {
        v1Compact(layout, true)
        return layout
      },
    ),
  compactV1: base =>
    measure(
      () => base,
      layout => compactV1(layout, true),
    ),
  verticalCompactor: base =>
    measure(
      () => base,
      layout => verticalCompactor.compact(layout, COLS),
    ),
  fastVerticalCompactor: base =>
    measure(
      () => base,
      layout => fastVerticalCompactor.compact(layout, COLS),
    ),
  'normalizeLayout + v1': base =>
    measure(
      () => base,
      layout =>
        normalizeLayout(layout, {
          cols: COLS,
          collisionMode: 'push',
          compactor: v1VerticalCompactor,
        }),
    ),
}

const SHAPES: Array<{ id: string; shape: string; make: (n: number) => Layout; sizes: number[] }> = [
  { id: 'desktop', shape: 'desktop, 12 columns', make: desktop, sizes: [300, 1000] },
  {
    id: 'mobile-desktop-y',
    shape: 'mobile, desktop y kept',
    make: mobileFromDesktop,
    sizes: [100, 300, 500, 1000],
  },
  {
    id: 'mobile-stacked',
    shape: 'mobile, already stacked',
    make: mobileStacked,
    sizes: [300, 1000],
  },
]

const rows: Row[] = []
for (const { id, shape, make, sizes } of SHAPES) {
  for (const n of sizes) {
    const rowId = `${id}-n${n}`
    if (only && !only.includes(rowId)) continue
    const base = make(n)
    const cells: Record<string, Cell> = {}
    for (const [name, column] of Object.entries(COLUMNS)) {
      cells[name] = column(base)
    }
    rows.push({ id: rowId, shape, n, cells })
    console.error(`done ${rowId}`)
  }
}

if (only && rows.length === 0) throw new Error(`--only matched no row: ${only.join(',')}`)

const columnNames = Object.keys(COLUMNS)
const lines = [
  `Compaction, median ms of ${SAMPLES} samples after ${WARMUPS} warmup (node ${process.version}).`,
  'Checksum mark: = same result as v1 raw, ≠ different result.',
  '',
  `| row | ${columnNames.join(' | ')} |`,
  `| --- | ${columnNames.map(() => '---:').join(' | ')} |`,
]
const mismatches: string[] = []
for (const row of rows) {
  const reference = row.cells['v1 raw'].checksum
  const values = columnNames.map(name => {
    const cell = row.cells[name]
    const same = cell.checksum === reference
    if (!same && name === 'compactV1') mismatches.push(row.id)
    return `${cell.medianMs} ${same ? '=' : '≠'}`
  })
  lines.push(`| ${row.id} | ${values.join(' | ')} |`)
}
console.log(lines.join('\n'))

if (jsonPath) {
  const target = resolve(jsonPath)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(
    target,
    `${JSON.stringify(
      { node: process.version, warmups: WARMUPS, samples: SAMPLES, cols: COLS, rows },
      null,
      2,
    )}\n`,
  )
  console.log(`\nJSON written to ${target}`)
}

if (mismatches.length > 0) {
  console.error(`compactV1 differs from v1 raw on: ${mismatches.join(', ')}`)
  process.exitCode = 1
}
