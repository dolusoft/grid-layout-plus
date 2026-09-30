import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'

import { GridItem, GridLayout } from '../src'
import { sameStyle } from '../src/helpers/style-equality'

import type { ComponentPublicInstance, PropType } from 'vue'
import type { Layout, LayoutItem } from '../src/helpers/types'

const interactMock = vi.hoisted(() => {
  const interactables = new Map<Element, any>()
  const interact = vi.fn((element: Element) => {
    const listeners = new Map<string, (event: any) => void>()
    const instance: Record<string, any> = { listeners }

    instance.draggable = vi.fn(() => instance)
    instance.resizable = vi.fn(() => instance)
    instance.styleCursor = vi.fn(() => instance)
    instance.unset = vi.fn(() => instance)
    instance.on = vi.fn((types: string, listener: (event: any) => void) => {
      for (const type of types.split(' ')) listeners.set(type, listener)
      return instance
    })

    interactables.set(element, instance)
    return instance
  })

  Object.assign(interact, { modifiers: { aspectRatio: vi.fn(() => ({})) } })

  return { interact, interactables }
})

vi.mock('interactjs', () => ({ default: interactMock.interact }))

// happy-dom has no layout, so `offsetParent` is null; GridLayout registers a hand-placed GridItem
// only when its containing block is the layout root, which `.vgl-layout { position: relative }`
// guarantees in a browser.
const offsetParentDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetParent',
)

beforeEach(() => {
  interactMock.interact.mockClear()
  interactMock.interactables.clear()
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

describe('sameStyle', () => {
  it('compares keys and values, not identity', () => {
    expect(sameStyle({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true)
    expect(sameStyle({ a: '1' }, { a: '1', b: '2' })).toBe(false)
    expect(sameStyle({ a: '1' }, { a: '2' })).toBe(false)
    expect(sameStyle({}, {})).toBe(true)
    expect(sameStyle({ height: undefined }, { height: undefined })).toBe(true)
    expect(sameStyle({ height: undefined }, { width: undefined })).toBe(false)
  })
})

/**
 * Records GridItem re-renders through the `updated` hook, keyed by item id. A slot counter is not
 * used: the question is whether GridItem itself re-renders, and only its own lifecycle hook
 * answers that.
 */
function createRenderProbe() {
  const updates: Record<string, number> = {}
  const mixin = {
    updated(this: ComponentPublicInstance) {
      if (this.$.type !== GridItem) return
      const id = String(this.$props.i)
      updates[id] = (updates[id] ?? 0) + 1
    },
  }
  return { updates, mixin }
}

function createRect(left: number, top: number, right: number, bottom: number): DOMRect {
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    width: right - left,
    x: left,
    y: top,
    toJSON: () => ({}),
  }
}

function dragEvent(type: string, target: HTMLElement, clientX: number, clientY: number) {
  const event = new MouseEvent(type, { clientX, clientY })
  Object.defineProperty(event, 'target', { configurable: true, value: target })
  return event
}

/** Drag candidates are batched to the next animation frame; wait for it and for Vue's queue. */
async function flush() {
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  for (let index = 0; index < 4; index++) await nextTick()
}

/** Gives `element` a bounding rect that follows the pointer from `originX`, as a browser would. */
function trackPointer(element: HTMLElement, left: number, originX: number) {
  let pointerX = originX
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => createRect(left + pointerX - originX, 0, left + pointerX - originX + 200, 70),
  })
  return (x: number) => (pointerX = x)
}

function itemElement(wrapper: ReturnType<typeof mount>, id: string) {
  return wrapper
    .findAll<HTMLElement>('.vgl-item')
    .find(
      element =>
        !element.classes().includes('vgl-item--placeholder') && element.text().trim() === id,
    )!
}

/**
 * One component per cell that places its own GridItem, as Dolusoft frontendx does
 * (`DashboardGridCell`). `$stable` marks the slot the way a compiled template does, so GridItem
 * re-renders only for its own reactive state, never because the cell or the layout re-rendered.
 * The cell takes the id only: the layout emitted after a commit carries new item objects, and a
 * slot that read such an object would re-render GridItem for a reason outside the library.
 */
const Cell = defineComponent({
  props: { id: { type: [String, Number] as PropType<LayoutItem['i']>, required: true } },
  setup: props => () =>
    h(GridItem, { i: props.id }, { default: () => h('span', String(props.id)), $stable: true }),
})

async function mountGrid(layout: Layout) {
  const probe = createRenderProbe()
  const model = ref<Layout>(layout)

  const host = () =>
    h(
      GridLayout,
      {
        layout: model.value,
        'onUpdate:layout': (next: Layout) => (model.value = next),
        width: 1200,
        colNum: 12,
        rowHeight: 30,
        isResizable: false,
      },
      { default: () => model.value.map(item => h(Cell, { key: item.i, id: item.i })) },
    )

  const wrapper = mount(host, { attachTo: document.body, global: { mixins: [probe.mixin] } })
  await flush()

  const root = wrapper.find<HTMLElement>('.vgl-layout').element
  Object.defineProperty(root, 'getBoundingClientRect', {
    configurable: true,
    value: () => createRect(0, 0, 1200, 600),
  })

  return { wrapper, model, ...probe }
}

function delta(after: Record<string, number>, before: Record<string, number>, id: string) {
  return (after[id] ?? 0) - (before[id] ?? 0)
}

const twoItems = (): Layout => [
  { i: 'a', x: 0, y: 0, w: 2, h: 2 },
  { i: 'b', x: 4, y: 0, w: 2, h: 2 },
]

describe('GridItem style writes', () => {
  it('an item whose box did not change is not re-rendered when a neighbour moves', async () => {
    const { wrapper, model, updates } = await mountGrid(twoItems())
    const before = { ...updates }

    model.value = [
      { i: 'a', x: 0, y: 0, w: 2, h: 2 },
      { i: 'b', x: 6, y: 0, w: 2, h: 2 },
    ]
    await flush()

    expect(itemElement(wrapper, 'b').attributes('style')).toContain('translate3d(605px')
    expect(delta(updates, before, 'a')).toBe(0)
    expect(delta(updates, before, 'b')).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('an item whose box did not change is not re-rendered during drag steps of a neighbour', async () => {
    const { wrapper, model, updates } = await mountGrid(twoItems())
    const b = itemElement(wrapper, 'b').element
    const moveTo = trackPointer(b, 403, 450)
    const listener = interactMock.interactables.get(b).listeners.get('dragstart')!

    listener(dragEvent('dragstart', b, 450, 20))
    moveTo(460)
    listener(dragEvent('dragmove', b, 460, 20))
    await flush()
    const before = { ...updates }

    // Pixel steps inside one column and steps that cross into the next columns.
    for (const x of [480, 500, 520, 560, 600, 700]) {
      moveTo(x)
      listener(dragEvent('dragmove', b, x, 20))
      await flush()
    }

    expect(itemElement(wrapper, 'b').classes()).toContain('vgl-item--dragging')
    expect(model.value.find(item => item.i === 'b')!.x).toBeGreaterThan(4)
    expect(delta(updates, before, 'a')).toBe(0)
    expect(delta(updates, before, 'b')).toBeGreaterThan(0)

    listener(dragEvent('dragend', b, 700, 20))
    await flush()
    wrapper.unmount()
  })

  it('an item whose box did not change is not re-rendered by a drop and its compaction', async () => {
    // `c` sits under `b`; dragging `b` away lets the vertical compactor pull `c` up. `a` keeps its box.
    const { wrapper, model, updates } = await mountGrid([
      { i: 'a', x: 0, y: 0, w: 2, h: 2 },
      { i: 'b', x: 4, y: 0, w: 2, h: 2 },
      { i: 'c', x: 4, y: 2, w: 2, h: 2 },
    ])
    const b = itemElement(wrapper, 'b').element
    const moveTo = trackPointer(b, 403, 450)
    const listener = interactMock.interactables.get(b).listeners.get('dragstart')!
    const before = { ...updates }

    listener(dragEvent('dragstart', b, 450, 20))
    for (const x of [470, 600, 750, 850]) {
      moveTo(x)
      listener(dragEvent('dragmove', b, x, 20))
      await flush()
    }
    listener(dragEvent('dragend', b, 850, 20))
    await flush()

    const byId = Object.fromEntries(model.value.map(item => [item.i, [item.x, item.y]]))
    expect(byId.b![0]).toBeGreaterThan(5)
    expect(byId.c).toEqual([4, 0])
    expect(byId.a).toEqual([0, 0])
    expect(delta(updates, before, 'a')).toBe(0)
    expect(delta(updates, before, 'c')).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('the layout root style is not rewritten when the container height is unchanged', async () => {
    const { wrapper, model } = await mountGrid(twoItems())
    const root = wrapper.find<HTMLElement>('.vgl-layout')
    const layoutState = (wrapper.findComponent(GridLayout).vm as any).state
    const height = root.element.style.height
    const mergedStyle = layoutState.mergedStyle

    model.value = [
      { i: 'a', x: 0, y: 0, w: 2, h: 2 },
      { i: 'b', x: 6, y: 0, w: 2, h: 2 },
    ]
    await flush()

    expect(root.element.style.height).toBe(height)
    expect(layoutState.mergedStyle).toBe(mergedStyle)

    model.value = [
      { i: 'a', x: 0, y: 0, w: 2, h: 2 },
      { i: 'b', x: 6, y: 0, w: 2, h: 4 },
    ]
    await flush()

    expect(root.element.style.height).not.toBe(height)
    expect(layoutState.mergedStyle).not.toBe(mergedStyle)
    wrapper.unmount()
  })
})
