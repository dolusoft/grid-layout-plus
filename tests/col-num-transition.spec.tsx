import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'

import { GridItem, GridLayout } from '../src'

import type { PropType } from 'vue'
import type { GridLayoutRuntimeError } from '../src/composables/useGridLayout'
import type { Layout, LayoutItem } from '../src/helpers/types'

vi.mock('interactjs', () => {
  const interact = vi.fn(() => {
    const instance: Record<string, any> = {}
    for (const name of ['draggable', 'resizable', 'styleCursor', 'unset', 'on']) {
      instance[name] = vi.fn(() => instance)
    }
    return instance
  })
  Object.assign(interact, { modifiers: { aspectRatio: vi.fn(() => ({})) } })
  return { default: interact }
})

// happy-dom has no layout, so `offsetParent` is null; GridLayout registers a hand-placed GridItem
// only when its containing block is the layout root (see tests/style-equality.spec.tsx).
const offsetParentDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetParent',
)

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement?.closest('.vgl-layout') ?? null
    },
  })
})

afterEach(() => {
  if (offsetParentDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParentDescriptor)
  }
  document.body.innerHTML = ''
})

async function flush() {
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  for (let index = 0; index < 4; index++) await nextTick()
}

/** One component per cell that places its own GridItem, as Dolusoft frontendx does. */
const Cell = defineComponent({
  props: { id: { type: [String, Number] as PropType<LayoutItem['i']>, required: true } },
  setup: props => () =>
    h(GridItem, { i: props.id }, { default: () => h('span', String(props.id)), $stable: true }),
})

/** Parent that swaps layout and colNum in one assignment, like a mobile/desktop switch. */
async function mountGrid(layout: Layout, colNum: number) {
  const view = ref({ layout, colNum })
  const errors: GridLayoutRuntimeError[] = []

  const host = () =>
    h(
      GridLayout,
      {
        layout: view.value.layout,
        colNum: view.value.colNum,
        'onUpdate:layout': (next: Layout) => (view.value = { ...view.value, layout: next }),
        onError: (error: GridLayoutRuntimeError) => errors.push(error),
        width: 1200,
        rowHeight: 30,
        isDraggable: false,
        isResizable: false,
      },
      { default: () => view.value.layout.map(item => h(Cell, { key: item.i, id: item.i })) },
    )

  const wrapper = mount(host, { attachTo: document.body })
  await flush()
  return { wrapper, view, errors }
}

function geometry(layout: Layout) {
  return layout.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }))
}

function itemStyle(wrapper: ReturnType<typeof mount>, id: string) {
  return wrapper
    .findAll<HTMLElement>('.vgl-item')
    .find(element => element.text().trim() === id)!
    .attributes('style')
}

// Desktop: 12 columns, two half-width items side by side, plus `d` only on desktop.
const desktop = (): Layout => [
  { i: 'a', x: 0, y: 0, w: 6, h: 2 },
  { i: 'b', x: 6, y: 0, w: 6, h: 2 },
  { i: 'd', x: 0, y: 2, w: 12, h: 2 },
]
// Mobile: 1 column, stacked, plus `m` only on mobile.
const mobile = (): Layout => [
  { i: 'a', x: 0, y: 0, w: 1, h: 2 },
  { i: 'b', x: 0, y: 2, w: 1, h: 2 },
  { i: 'm', x: 0, y: 4, w: 1, h: 2 },
]

describe('colNum and layout changing in the same tick', () => {
  it('mobile to desktop (1 -> 12) emits no error and draws the new layout', async () => {
    const { wrapper, view, errors } = await mountGrid(mobile(), 1)
    expect(errors).toEqual([])

    view.value = { layout: desktop(), colNum: 12 }
    await flush()

    expect(errors).toEqual([])
    expect(geometry(view.value.layout)).toEqual(geometry(desktop()))
    // 1200px, 12 columns, 10px gap, no padding: column step 605/6px, a 6-column item spans 595px.
    expect(itemStyle(wrapper, 'b')).toContain('translate3d(605px, 0px')
    expect(itemStyle(wrapper, 'b')).toContain('width: 595px')
    expect(itemStyle(wrapper, 'd')).toContain('translate3d(0px, 80px')
    expect(itemStyle(wrapper, 'd')).toContain('width: 1200px')
    wrapper.unmount()
  })

  it('desktop to mobile (12 -> 1) emits no error and draws the new layout', async () => {
    const { wrapper, view, errors } = await mountGrid(desktop(), 12)
    expect(errors).toEqual([])

    view.value = { layout: mobile(), colNum: 1 }
    await flush()

    expect(errors).toEqual([])
    expect(geometry(view.value.layout)).toEqual(geometry(mobile()))
    // One column spans the full 1200px; rows step 30px + 10px gap.
    expect(itemStyle(wrapper, 'b')).toContain('translate3d(0px, 80px')
    expect(itemStyle(wrapper, 'm')).toContain('translate3d(0px, 160px')
    expect(itemStyle(wrapper, 'm')).toContain('width: 1200px')
    wrapper.unmount()
  })

  it('a layout that does not fit the new colNum is still rejected', async () => {
    const { wrapper, view, errors } = await mountGrid(mobile(), 1)

    // `b` ends at column 14 of 12.
    view.value = {
      layout: [
        { i: 'a', x: 0, y: 0, w: 6, h: 2 },
        { i: 'b', x: 8, y: 0, w: 6, h: 2 },
      ],
      colNum: 12,
    }
    await flush()

    expect(errors.some(error => error.code === 'invalid-layout')).toBe(true)
    wrapper.unmount()
  })

  it('a layout that does not fit an unchanged colNum is still rejected', async () => {
    const { wrapper, view, errors } = await mountGrid(desktop(), 12)

    view.value = { ...view.value, layout: [{ i: 'a', x: 10, y: 0, w: 6, h: 2 }] }
    await flush()

    expect(errors.some(error => error.code === 'invalid-layout')).toBe(true)
    wrapper.unmount()
  })
})
