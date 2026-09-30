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

// Containing-block reads made by registry validation; each one is a forced style/layout in a browser.
let offsetParentReads = 0

beforeEach(() => {
  interactMock.interact.mockClear()
  interactMock.interactables.clear()
  offsetParentReads = 0
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      // Only the registry's reads count; drag handling reads offsetParent for pointer math too.
      if (new Error().stack?.includes('item-registry')) offsetParentReads++
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
      // The drag placeholder is a decorative GridItem that carries the dragged item's id.
      if (this.$.type !== GridItem || this.$props.decorative) return
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
    // The moved item gets its new box as a direct style write, not through a GridItem render.
    expect(delta(updates, before, 'b')).toBe(0)
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
    // Drag steps only move the dragged item's box: written to the element, no GridItem render.
    expect(delta(updates, before, 'b')).toBe(0)
    expect(itemElement(wrapper, 'b').attributes('style')).toContain('translate3d(')

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
    // `c` is pulled up by the compactor: its box changes, its render output does not.
    expect(delta(updates, before, 'c')).toBe(0)
    expect(itemElement(wrapper, 'c').attributes('style')).toMatch(/translate3d\(403(\.\d+)?px, 0px/)
    wrapper.unmount()
  })

  it('the layout root style is not rewritten when the container height is unchanged', async () => {
    const { wrapper, model } = await mountGrid(twoItems())
    const root = wrapper.find<HTMLElement>('.vgl-layout')
    // The style object bound to the root element in GridLayout's last render.
    const layoutInstance = wrapper.findComponent(GridLayout).vm.$
    const rootStyle = () => layoutInstance.subTree.props?.style
    const height = root.element.style.height
    const style = rootStyle()

    model.value = [
      { i: 'a', x: 0, y: 0, w: 2, h: 2 },
      { i: 'b', x: 6, y: 0, w: 2, h: 2 },
    ]
    await flush()

    expect(root.element.style.height).toBe(height)
    expect(rootStyle()).toBe(style)

    model.value = [
      { i: 'a', x: 0, y: 0, w: 2, h: 2 },
      { i: 'b', x: 6, y: 0, w: 2, h: 4 },
    ]
    await flush()

    expect(root.element.style.height).not.toBe(height)
    expect(rootStyle()).not.toBe(style)
    wrapper.unmount()
  })
})

describe('GridItem position style is written to the element', () => {
  it('an external layout update validates once, not once more for the moved item', async () => {
    const { wrapper, model } = await mountGrid(twoItems())
    offsetParentReads = 0

    model.value = [
      { i: 'a', x: 0, y: 0, w: 2, h: 2 },
      { i: 'b', x: 6, y: 0, w: 2, h: 2 },
    ]
    await flush()

    expect(itemElement(wrapper, 'b').attributes('style')).toContain('translate3d(605px')
    // The synchronous pass after the external commit reads each of the two items once.
    expect(offsetParentReads).toBe(2)
    wrapper.unmount()
  })

  it('drag steps do not start a registry validation pass', async () => {
    const { wrapper, model } = await mountGrid([
      { i: 'a', x: 0, y: 0, w: 2, h: 2 },
      { i: 'b', x: 4, y: 0, w: 2, h: 2 },
      { i: 'c', x: 4, y: 2, w: 2, h: 2 },
    ])
    const b = itemElement(wrapper, 'b').element
    const moveTo = trackPointer(b, 403, 450)
    const listener = interactMock.interactables.get(b).listeners.get('dragstart')!

    listener(dragEvent('dragstart', b, 450, 20))
    moveTo(460)
    listener(dragEvent('dragmove', b, 460, 20))
    await flush()
    offsetParentReads = 0

    for (const x of [480, 560, 700, 850]) {
      moveTo(x)
      listener(dragEvent('dragmove', b, x, 20))
      await flush()
    }

    expect(offsetParentReads).toBe(0)
    listener(dragEvent('dragend', b, 850, 20))
    await flush()

    // Positive control: the stack filter does see registry reads, so the zero above is not an
    // artefact of how the stack names the registry module.
    offsetParentReads = 0
    model.value = model.value.map(item => (item.i === 'a' ? { ...item, y: 6 } : item))
    await flush()
    expect(offsetParentReads).toBeGreaterThan(0)
    wrapper.unmount()
  })

  it('keeps the current box when a fallthrough style and class re-render the item', async () => {
    const flag = ref(false)
    const model = ref<Layout>(twoItems())
    const wrapper = mount(
      () =>
        h(
          GridLayout,
          {
            layout: model.value,
            'onUpdate:layout': (next: Layout) => (model.value = next),
            width: 1200,
            colNum: 12,
            rowHeight: 30,
          },
          {
            default: () =>
              model.value.map(item =>
                h(
                  GridItem,
                  {
                    key: item.i,
                    i: item.i,
                    class: flag.value ? 'marked' : 'plain',
                    style: { outline: flag.value ? '2px solid red' : '1px solid red' },
                  },
                  () => h('span', String(item.i)),
                ),
              ),
          },
        ),
      { attachTo: document.body },
    )
    await flush()

    model.value = [
      { i: 'a', x: 0, y: 0, w: 2, h: 2 },
      { i: 'b', x: 6, y: 0, w: 2, h: 2 },
    ]
    await flush()
    flag.value = true
    await flush()

    const b = itemElement(wrapper, 'b')
    expect(b.classes()).toContain('marked')
    expect(b.element.style.outline).toContain('2px')
    expect(b.element.style.transform).toMatch(/^translate3d\(605px, 0px, 0(px)?\)$/)
    expect(b.element.style.width).not.toBe('')
    wrapper.unmount()
  })

  it('the exposed style state and the element agree after moves and a reset', async () => {
    const { wrapper, model } = await mountGrid(twoItems())
    const b = wrapper.findAllComponents(GridItem).find(item => item.props('i') === 'b')!
    const state = (b.vm as unknown as { state: { style: Record<string, string> } }).state

    model.value = [
      { i: 'a', x: 0, y: 0, w: 2, h: 2 },
      { i: 'b', x: 6, y: 2, w: 3, h: 2 },
    ]
    await flush()

    const element = b.element as HTMLElement
    for (const [key, value] of Object.entries(state.style)) {
      expect(element.style.getPropertyValue(key)).toBe(value)
    }

    // A key that the next style no longer has is removed from the element.
    state.style = { position: 'absolute', transform: 'translate3d(1px, 2px, 0)' }
    await flush()
    expect(element.style.transform).toMatch(/^translate3d\(1px, 2px, 0(px)?\)$/)
    expect(element.style.width).toBe('')
    wrapper.unmount()
  })

  it('the placeholder follows the drag through direct writes', async () => {
    const { wrapper } = await mountGrid(twoItems())
    const b = itemElement(wrapper, 'b').element
    const moveTo = trackPointer(b, 403, 450)
    const listener = interactMock.interactables.get(b).listeners.get('dragstart')!

    listener(dragEvent('dragstart', b, 450, 20))
    for (const x of [600, 750]) {
      moveTo(x)
      listener(dragEvent('dragmove', b, x, 20))
      await flush()
    }
    const placeholder = wrapper.find<HTMLElement>('.vgl-item--placeholder').element
    expect(placeholder.style.transform).toMatch(/^translate3d\([\d.]+px, [\d.]+px, 0(px)?\)$/)
    expect(placeholder.style.transform).not.toMatch(/^translate3d\(403px, 0px/)

    listener(dragEvent('dragend', b, 750, 20))
    await flush()
    wrapper.unmount()
  })
})
