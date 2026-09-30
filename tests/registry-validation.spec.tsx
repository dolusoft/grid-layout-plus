import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, onUpdated, ref, watch } from 'vue'

import { GridItem, GridLayout } from '../src'
import { createGridItemRegistry } from '../src/components/grid-layout/item-registry'

import type { PropType } from 'vue'
import type { GridLayoutRuntimeError } from '../src/composables/useGridLayout'
import type { GridItemRegistration } from '../src/helpers/internal-types'
import type { Layout, LayoutItem } from '../src/helpers/types'

/**
 * Counts the work of GridLayout's item registry from the outside: a full validation pass is the
 * only caller of `getRoot`, and it asks `hasLayoutItem` once per registered item. `getLayoutItem`
 * is the linear layout search; the registry and the injected item lookup must not depend on it.
 */
const counters = vi.hoisted(() => ({ passes: 0, membership: 0, linearSearches: 0 }))

vi.mock('../src/components/grid-layout/item-registry', async importOriginal => {
  const original =
    await importOriginal<typeof import('../src/components/grid-layout/item-registry')>()
  return {
    ...original,
    createGridItemRegistry: (options: Parameters<typeof original.createGridItemRegistry>[0]) =>
      original.createGridItemRegistry({
        ...options,
        getRoot: () => {
          counters.passes += 1
          return options.getRoot()
        },
        hasLayoutItem: id => {
          counters.membership += 1
          return options.hasLayoutItem(id)
        },
      }),
  }
})

vi.mock('../src/helpers/common', async importOriginal => {
  const original = await importOriginal<typeof import('../src/helpers/common')>()
  return {
    ...original,
    getLayoutItem: ((layout: Layout, id: LayoutItem['i']) => {
      counters.linearSearches += 1
      return original.getLayoutItem(layout, id)
    }) as typeof original.getLayoutItem,
  }
})

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

// Per-element override: `detached` reports no containing block, `throws` makes the read throw.
const offsetParentOverrides = new Map<Element, 'detached' | 'throws'>()

beforeEach(() => {
  offsetParentOverrides.clear()
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      const override = offsetParentOverrides.get(this)
      if (override === 'throws') throw new Error('offsetParent read failed')
      if (override === 'detached') return null
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

function resetCounters() {
  counters.passes = 0
  counters.membership = 0
  counters.linearSearches = 0
}

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

const size = 300
// Desktop: 12 columns, six 2x2 cells per row.
const desktop = (): Layout =>
  Array.from({ length: size }, (_, k) => ({
    i: `c${k}`,
    x: (k % 6) * 2,
    y: Math.floor(k / 6) * 2,
    w: 2,
    h: 2,
  }))
// Mobile: one column, the same cells stacked.
const mobile = (): Layout =>
  Array.from({ length: size }, (_, k) => ({ i: `c${k}`, x: 0, y: k * 2, w: 1, h: 2 }))

async function mountGrid() {
  const view = ref({ layout: desktop(), colNum: 12, width: 1200 })
  const errors: GridLayoutRuntimeError[] = []

  const host = () =>
    h(
      GridLayout,
      {
        layout: view.value.layout,
        colNum: view.value.colNum,
        width: view.value.width,
        'onUpdate:layout': (next: Layout) => (view.value = { ...view.value, layout: next }),
        onError: (error: GridLayoutRuntimeError) => errors.push(error),
        rowHeight: 30,
        isDraggable: false,
        isResizable: false,
      },
      { default: () => view.value.layout.map(item => h(Cell, { key: item.i, id: item.i })) },
    )

  const wrapper = mount(host, { attachTo: document.body })
  return { wrapper, view, errors }
}

describe('registry validation cost with 300 cells', () => {
  it('mount validates every cell a bounded number of times, not once per cell', async () => {
    resetCounters()
    const { wrapper, errors } = await mountGrid()
    await flush()

    // Before coalescing: one pass per registration and per re-render, 601 for 300 cells. Now:
    // the shared pass of all registrations, GridLayout's own mount pass, and the shared pass of
    // the re-render that the registered state triggers. The count does not grow with the cells.
    expect(counters.passes).toBeLessThanOrEqual(3)
    expect(counters.membership).toBeLessThanOrEqual(3 * size)
    expect(counters.linearSearches).toBeLessThan(size)
    expect(wrapper.findAll('.vgl-item:not(.vgl-item--placeholder)').length).toBe(size)
    expect(errors).toEqual([])
    wrapper.unmount()
  })

  it('a width and colNum switch shares one deferred pass among all updated cells', async () => {
    const { wrapper, view, errors } = await mountGrid()
    await flush()

    for (const next of [
      { layout: mobile(), colNum: 1, width: 390 },
      { layout: desktop(), colNum: 12, width: 1200 },
    ]) {
      resetCounters()
      view.value = next
      await flush()

      // The synchronous pass after the external layout commit, then one deferred pass for the
      // 300 re-rendered cells (before: 1 + 300).
      expect(counters.passes).toBe(2)
      expect(counters.membership).toBe(2 * size)
      expect(counters.linearSearches).toBeLessThan(size)
    }
    expect(errors).toEqual([])
    wrapper.unmount()
  })
})

/**
 * Cells are rendered from their own list, so the layout can drop an id while its cell stays
 * mounted. The app `errorHandler` collects errors Vue routes to it.
 */
async function mountCells(ids: string[]) {
  const layout = ref<Layout>(ids.map((i, k) => ({ i, x: k * 2, y: 0, w: 2, h: 2 })))
  const cells = ref(ids)
  const errors: GridLayoutRuntimeError[] = []
  const appErrors: unknown[] = []

  const host = () =>
    h(
      GridLayout,
      {
        layout: layout.value,
        'onUpdate:layout': (next: Layout) => (layout.value = next),
        onError: (error: GridLayoutRuntimeError) => errors.push(error),
        colNum: 12,
        width: 1200,
        rowHeight: 30,
        isDraggable: false,
        isResizable: false,
      },
      { default: () => cells.value.map(id => h(Cell, { key: id, id })) },
    )

  const wrapper = mount(host, {
    attachTo: document.body,
    global: { config: { errorHandler: error => void appErrors.push(error) } },
  })
  await flush()
  const element = (id: string) =>
    wrapper
      .findAll<HTMLElement>('.vgl-item')
      .find(item => item.text().trim() === id)!.element
  const move = (id: string, x: number) =>
    (layout.value = layout.value.map(item => (item.i === id ? { ...item, x } : item)))
  return { wrapper, layout, errors, appErrors, element, move }
}

describe('registry validation inside GridLayout', () => {
  it('reports an invalid registration in the same flush, before a later nextTick', async () => {
    const { wrapper, errors, element, move } = await mountCells(['a', 'b'])
    offsetParentOverrides.set(element('a'), 'detached')

    move('a', 6)
    // One nextTick awaits exactly the flush that re-renders `a`.
    await nextTick()

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      code: 'invalid-registration',
      cause: { reason: 'invalid-containing-block', id: 'a' },
    })
    wrapper.unmount()
  })

  it('an id removed by an external layout update is missing-id through the index', async () => {
    const { wrapper, layout, errors } = await mountCells(['a', 'b'])
    resetCounters()

    layout.value = layout.value.filter(item => item.i !== 'b')
    await flush()

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      code: 'invalid-registration',
      cause: { reason: 'missing-id', id: 'b' },
    })
    expect(counters.passes).toBeGreaterThan(0)
    expect(counters.linearSearches).toBe(0)
    wrapper.unmount()
  })

  it('a throwing deferred pass goes to the app errorHandler and does not stop later hooks', async () => {
    const { wrapper, appErrors, element, move } = await mountCells(['a', 'b'])
    offsetParentOverrides.set(element('a'), 'throws')

    move('a', 6)
    await flush()
    offsetParentOverrides.clear()

    // Every pass that ran while the read failed reported to the app, none escaped.
    expect(appErrors.length).toBeGreaterThan(0)
    for (const error of appErrors) {
      expect(error).toMatchObject({ message: 'offsetParent read failed' })
    }

    // Vue runs post-flush callbacks without try/finally: a throw from one would leave the
    // scheduler stuck and silence every later `updated` hook and `flush: 'post'` watcher.
    const probe = ref(0)
    const seen = { updated: 0, postWatcher: 0 }
    // A separate app: the probe shares only Vue's scheduler with the grid.
    const other = mount(
      {
        setup() {
          onUpdated(() => (seen.updated += 1))
          return () => h('i', probe.value)
        },
      },
      { attachTo: document.body },
    )
    watch(probe, () => (seen.postWatcher += 1), { flush: 'post' })
    probe.value += 1
    await flush()

    expect(seen).toEqual({ updated: 1, postWatcher: 1 })
    other.unmount()
    wrapper.unmount()
  })
})

function fakeItem(i: LayoutItem['i'], wrapper: HTMLElement): GridItemRegistration {
  return {
    i,
    wrapper,
    state: { registered: false, style: {} },
    resetInteractionState: vi.fn(),
    finishDragInteraction: vi.fn(),
    finishResizeInteraction: vi.fn(),
    refreshPositionStyle: vi.fn(),
    disableInteractionBinding: vi.fn(),
  }
}

function createFixture(ids: LayoutItem['i'][]) {
  const root = document.createElement('div')
  root.className = 'vgl-layout'
  document.body.append(root)
  const scheduled: (() => void)[] = []
  const errors: GridLayoutRuntimeError[] = []
  const layoutIds = new Set(ids)
  let activeId: LayoutItem['i'] | null = null
  const calls: string[] = []
  const registry = createGridItemRegistry({
    itemInstances: new Map(),
    registeredItems: new Set(),
    registrationEpisodes: new WeakMap(),
    isUnavailable: () => false,
    getRoot: () => root,
    hasLayoutItem: id => layoutIds.has(id),
    getActiveInteractionId: () => activeId,
    prepareActiveForTerminal: () => calls.push('prepare'),
    finishActiveForExternalUpdate: () => calls.push('finish'),
    scheduleValidation: callback => scheduled.push(callback),
    nextEvaluationId: () => 0,
    emitError: error => {
      calls.push('error')
      errors.push(error)
    },
  })
  const item = (id: LayoutItem['i']) => {
    const node = document.createElement('div')
    root.append(node)
    return fakeItem(id, node)
  }
  const runScheduled = () => scheduled.splice(0).forEach(callback => callback())
  return {
    root,
    registry,
    scheduled,
    errors,
    calls,
    item,
    runScheduled,
    setActive: (id: LayoutItem['i'] | null) => (activeId = id),
  }
}

describe('item registry scheduling', () => {
  it('coalesces registrations and same-id updates into one deferred pass', () => {
    const fixture = createFixture(['a', 'b'])
    const a = fixture.item('a')
    const b = fixture.item('b')

    fixture.registry.increase(a)
    fixture.registry.increase(b)
    expect(fixture.scheduled).toHaveLength(1)
    fixture.runScheduled()
    expect(a.state.registered).toBe(true)
    expect(b.state.registered).toBe(true)

    fixture.registry.update(a, 'a')
    fixture.registry.update(b, 'b')
    fixture.registry.update(a, 'a')
    expect(fixture.scheduled).toHaveLength(1)
  })

  it('reports an invalid registration from the deferred pass, not inside the update call', () => {
    const fixture = createFixture(['a'])
    const a = fixture.item('a')
    fixture.registry.increase(a)
    fixture.runScheduled()

    document.body.append(a.wrapper!)
    fixture.registry.update(a, 'a')
    // The update itself (GridItem's onUpdated) no longer validates synchronously.
    expect(fixture.errors).toEqual([])
    expect(a.state.registered).toBe(true)

    fixture.runScheduled()
    expect(a.state.registered).toBe(false)
    expect(fixture.errors).toHaveLength(1)
    expect(fixture.errors[0]).toMatchObject({
      code: 'invalid-registration',
      cause: { reason: 'outside-root', id: 'a' },
    })
  })

  it('a synchronous validation consumes the pending deferred pass', () => {
    const fixture = createFixture(['a'])
    const a = fixture.item('a')
    fixture.registry.increase(a)
    fixture.runScheduled()

    document.body.append(a.wrapper!)
    fixture.registry.update(a, 'a')
    fixture.registry.validate()
    expect(fixture.errors).toHaveLength(1)

    fixture.runScheduled()
    expect(fixture.errors).toHaveLength(1)

    // A later request schedules a new pass.
    fixture.registry.update(a, 'a')
    expect(fixture.scheduled).toHaveLength(1)
  })

  it('an id change still cancels the active interaction of the old id synchronously', () => {
    const fixture = createFixture(['a', 'b'])
    const a = fixture.item('a')
    fixture.registry.increase(a)
    fixture.runScheduled()
    fixture.setActive('a')

    a.i = 'b'
    fixture.registry.update(a, 'a')
    expect(fixture.calls).toEqual(['prepare', 'finish'])
    expect(fixture.scheduled).toHaveLength(1)
  })

  it('an active item invalidated by the deferred pass keeps prepare, error, finish order', () => {
    const fixture = createFixture(['a'])
    const a = fixture.item('a')
    fixture.registry.increase(a)
    fixture.runScheduled()
    fixture.setActive('a')

    document.body.append(a.wrapper!)
    fixture.registry.update(a, 'a')
    expect(fixture.calls).toEqual([])
    fixture.runScheduled()
    expect(fixture.calls).toEqual(['prepare', 'error', 'finish'])
    expect(a.refreshPositionStyle).toHaveBeenCalledTimes(1)
  })

  it('a lasting error is reported once and again only after it recovered', () => {
    const fixture = createFixture(['a'])
    const a = fixture.item('a')
    fixture.registry.increase(a)
    fixture.runScheduled()
    const node = a.wrapper!

    document.body.append(node)
    for (let pass = 0; pass < 3; pass++) {
      fixture.registry.update(a, 'a')
      fixture.runScheduled()
    }
    expect(fixture.errors).toHaveLength(1)

    fixture.root.append(node)
    fixture.registry.update(a, 'a')
    fixture.runScheduled()
    expect(a.state.registered).toBe(true)

    document.body.append(node)
    fixture.registry.update(a, 'a')
    fixture.runScheduled()
    expect(fixture.errors).toHaveLength(2)
  })

  it('the other item with a duplicate id takes over when the first owner is removed', () => {
    const fixture = createFixture(['a'])
    const first = fixture.item('a')
    const second = fixture.item('a')
    fixture.registry.increase(first)
    fixture.registry.increase(second)
    fixture.runScheduled()
    expect(first.state.registered).toBe(true)
    expect(second.state.registered).toBe(false)
    expect(fixture.errors[0]).toMatchObject({ cause: { reason: 'duplicate', id: 'a' } })

    fixture.registry.decrease(first)
    fixture.runScheduled()
    expect(second.state.registered).toBe(true)
    expect(fixture.registry.get('a')).toBe(second)
  })
})
