import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'

import { GridItem, GridLayout } from '../src'

import type { Layout } from '../src/helpers/types'

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
// only when its containing block is the layout root.
const offsetParentDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetParent',
)

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('vgl-item') ? this.closest('.vgl-layout') : null
    },
  })
})

afterEach(() => {
  if (offsetParentDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParentDescriptor)
  }
})

async function flush() {
  for (let tick = 0; tick < 4; tick++) await nextTick()
}

async function mountGrid(layout: Layout) {
  const width = ref(1200)
  const Host = defineComponent(() => {
    return () =>
      h(
        GridLayout,
        { layout, colNum: 12, width: width.value, rowHeight: 30, isResizable: true },
        {
          default: () => layout.map(item => h(GridItem, { key: item.i, i: item.i })),
        },
      )
  })
  const host = mount(Host, { attachTo: document.body })
  await flush()
  return { host, grid: host.findComponent(GridLayout), width }
}

// Every commit after the items are registered checks each resizable item's geometry at its
// smallest and its largest reachable size. With no `maxH` and an unbounded `maxRows` (the
// default) the largest height is Infinity; it used to be replaced by 1, which an item with
// `minH > 1` rejects (`invalid-layout` at `layoutItem.h`). The whole grid then reported
// `positionStyleReady: false` and refused every interaction.
describe('resize constraint check with an unbounded height', () => {
  it('accepts an item whose minH is above 1 when maxH and maxRows are unbounded', async () => {
    const { host, grid, width } = await mountGrid([
      { i: 'a', x: 0, y: 0, w: 4, h: 4, minH: 3 },
      { i: 'b', x: 4, y: 0, w: 4, h: 2 },
    ])
    expect((grid.vm as any).state.positionStyleReady).toBe(true)

    // A width change commits again, now with both items registered and resizable.
    width.value = 1000
    await flush()

    expect(grid.emitted('error')).toBeUndefined()
    expect((grid.vm as any).state.positionStyleReady).toBe(true)
    host.unmount()
  })

  it('accepts minW and minH above 1 next to an item with a bounded maxH', async () => {
    const { host, grid, width } = await mountGrid([
      { i: 'a', x: 0, y: 0, w: 4, h: 4, minW: 3, minH: 3 },
      { i: 'b', x: 4, y: 0, w: 4, h: 4, minH: 2, maxH: 6 },
    ])

    width.value = 1000
    await flush()

    expect(grid.emitted('error')).toBeUndefined()
    expect((grid.vm as any).state.positionStyleReady).toBe(true)
    host.unmount()
  })
})
