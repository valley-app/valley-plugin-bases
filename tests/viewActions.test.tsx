import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor, fireEvent } from '@testing-library/react'
import { createMockValleyApi } from '@valley/plugin-testkit'
import { parse } from 'yaml'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import Ajv from 'ajv'
import type { MountedPluginView } from '@valley/plugin-sdk'
import { register } from '../src/index'
import BaseEditor from '../src/BaseEditor'
import { baseStore } from '../src/store'
import { currentSession } from '../src/runtime'

const mapOwners = vi.hoisted(() => ({ values: [] as any[] }))
vi.mock('maplibre-gl', () => ({
  addProtocol: vi.fn(),
  Map: class {
    zoom: number; min: number; max: number; container: HTMLElement; events = new Map<string, () => void>(); center = [0, 0]
    constructor(options: any) { this.zoom = options.zoom; this.min = options.minZoom; this.max = options.maxZoom; this.container = options.container; mapOwners.values.push(this) }
    on(event: string, callback: any) { if (typeof callback === 'function') this.events.set(event, callback); return this }
    once(_event: string, callback: () => void) { queueMicrotask(callback) }
    getContainer() { return this.container }
    getCanvas() { return this.container }
    getZoom() { return this.zoom }
    getCenter() { return { toArray: () => this.center } }
    setCenter(value: any) { this.center = value }
    setZoom(value: number) { this.zoom = value; this.events.get('moveend')?.() }
    setMinZoom(value: number) { this.min = value }
    setMaxZoom(value: number) { this.max = value }
    zoomIn() { this.setZoom(Math.min(this.max, this.zoom + 1)) }
    zoomOut() { this.setZoom(Math.max(this.min, this.zoom - 1)) }
    hasImage() { return true }
    getSource() { return { setData() {} } }
    fitBounds() {}
    remove() {}
  },
  LngLatBounds: class { extend() {} getCenter() { return [8, 47] } },
}))

afterEach(cleanup)
const target: MountedPluginView = { mountId: 'base-mount', generation: 1, area: 'main', paneId: 'canopy', tabId: 'base-tab', filePath: 'Canopy.base', pluginId: 'bases' }
const source = '# keep\ncustom: preserved\nviews:\n  - name: Table\n    type: table\n    order: [file.name]\n    extra: retained\n'
async function fixture(content = source) {
  const mock = createMockValleyApi({ manifest: { id: 'bases' }, files: { 'Canopy.base': content, 'Fern.md': '---\nprice: 12\ndone: false\ncoordinates: [47, 8]\n---\n# Fern\n' }, indexEntries: [{ relPath: 'Fern.md', title: 'Fern', kind: 'note', mtimeMs: 1000, frontmatter: { price: 12, done: false, coordinates: [47, 8] } }] })
  vi.spyOn(mock.api.ui, 'openPopover').mockImplementation((content, _target, options) => new Promise(resolve => { const element = document.body.appendChild(document.createElement('div')); const panel = createRoot(element); panel.render(<div role="dialog" aria-label={options?.ariaLabel}>{content({ close })}</div>); function close() { queueMicrotask(() => { panel.unmount(); element.remove() }); resolve() } }))
  const dispose = register(mock.api)
  const rendered = render(<><BaseEditor relPath={target.filePath} tab={{ id: target.tabId }} mountedView={target} /><BaseEditor relPath={target.filePath} tab={{ id: 'other' }} mountedView={{ ...target, mountId: 'other-mount', tabId: 'other' }} /></>)
  await waitFor(() => expect(baseStore(target.filePath).snapshot.loaded).toBe(true))
  const command = (id: string) => { const entry = mock.commands.find(command => command.id === id || command.id === `bases:${id}`); if (!entry) throw new Error(`Missing ${id}`); return entry }
  const inspect = (selected = target) => command('view-inspect').run(command('view-inspect').input!.parse({ target: selected }), { caller: 'agent' }) as { revision: string; search: string; source: string; actions: { id: string; schema: Record<string, unknown> }[] }
  const run = async (action: string, value: unknown, expectedRevision = inspect().revision, context = {}, effect = 'write') => {
    const entry = command(effect === 'read' ? 'view-read' : effect === 'execute' ? 'view-execute' : 'view-action')
    let result: unknown
    await act(async () => { result = await entry.run(entry.input!.parse({ target, expectedRevision, action, value }), { caller: 'agent', ...context }) })
    return result
  }
  await waitFor(() => expect(inspect().actions.length).toBeGreaterThan(30))
  return { mock, dispose, rendered, command, inspect, run }
}
describe('exact mounted Base actions', () => {
  it('changes native configuration through the existing owner and preserves unknown source fields', async () => {
    const h = await fixture()
    const originalRevision = h.inspect().revision
    await h.run('cards-size', 260)
    await h.run('source-save', null)
    expect(parse(await h.mock.api.vault.readFile(target.filePath))).toMatchObject({ custom: 'preserved', views: [{ extra: 'retained', cardSize: 260 }] })
    expect(await h.mock.api.vault.readFile(target.filePath)).toContain('# keep')
    await expect(h.run('cards-size', 270, originalRevision)).rejects.toMatchObject({ outcome: 'not-applied' })
    await h.run('search-query', 'Fern')
    expect(h.inspect().search).toBe('Fern')
    expect(h.inspect({ ...target, mountId: 'other-mount', tabId: 'other' }).search).toBe('')
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('inspects, validates and runs mounted actions without string evaluation, as the plugin sandbox policy requires', async () => {
    const h = await fixture()
    const original = { Function: globalThis.Function, eval: globalThis.eval }
    const refuse = (): never => { throw new EvalError('Evaluating a string as JavaScript violates the plugin Content Security Policy.') }
    try {
      globalThis.Function = new Proxy(original.Function, { construct: refuse, apply: refuse })
      globalThis.eval = refuse
      expect(h.inspect().search).toBe('')
      await h.run('search-query', 'Fern')
      expect(h.inspect().search).toBe('Fern')
      await expect(h.run('cards-size', '260')).rejects.toMatchObject({ outcome: 'not-applied' })
    } finally { Object.assign(globalThis, original) }
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('refuses invalid schemas and final cancellation or revocation without altering the draft', async () => {
    const h = await fixture()
    for (const value of [0, 801, '260']) await expect(h.run('cards-size', value)).rejects.toMatchObject({ outcome: 'not-applied' })
    for (const reason of ['cancel', 'deny', 'replace'] as const) {
      const cancellation = new AbortController()
      const before = h.inspect().source
      await expect(h.run('cards-size', 280, h.inspect().revision, { cancellation: cancellation.signal, validateBeforeRun: async () => {
        if (reason === 'cancel') cancellation.abort()
        if (reason === 'replace') h.rendered.unmount()
        return reason !== 'deny'
      } })).rejects.toMatchObject({ outcome: 'not-applied' })
      expect(baseStore(target.filePath).snapshot.content).toBe(before)
    }
    await h.dispose()
  })
  it('preserves false, zero, empty strings and empty property lists', async () => {
    const h = await fixture()
    await h.run('list-indent-properties', false)
    await h.run('map-min-zoom', 0)
    await h.run('list-separator', '')
    await h.run('property-order', [])
    await h.run('source-save', null)
    expect(parse(await h.mock.api.vault.readFile(target.filePath))).toMatchObject({ views: [{ indentProperties: false, minZoom: 0, order: [] }] })
    await expect(h.run('sort-add', { property: 'file.name', direction: 'ASC', extra: true })).rejects.toMatchObject({ outcome: 'not-applied' })
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
})

const configured = '# keep\ncustom: preserved\nviews:\n  - name: Table\n    type: table\n    order: [file.name, price, done, coordinates]\n    extra: retained\n  - name: Second\n    type: table\n    order: [file.name]\n'
const options: Array<[string, unknown, string, unknown]> = [
  ['view-layout', 'list', 'type', 'list'], ['table-row-height', 'tall', 'rowHeight', 'tall'],
  ['cards-size', 400, 'cardSize', 400], ['cards-image-property', 'price', 'image', 'price'], ['cards-image-fit', 'contain', 'imageFit', 'contain'], ['cards-image-aspect-ratio', 0.5, 'imageAspectRatio', 0.5],
  ['list-markers', 'none', 'markers', 'none'], ['list-indent-properties', false, 'indentProperties', false], ['list-separator', '', 'separator', ''],
  ['map-height', 600, 'mapHeight', 600], ['map-center', '[47, 8]', 'center', '[47, 8]'], ['map-default-zoom', 6, 'defaultZoom', 6], ['map-min-zoom', 0, 'minZoom', 0], ['map-max-zoom', 20, 'maxZoom', 20],
  ['map-coordinate-property', 'coordinates', 'coordinates', 'note.coordinates'], ['map-marker-icon-property', 'price', 'markerIcon', 'note.price'], ['map-marker-color-property', 'price', 'markerColor', 'note.price'],
  ['results-limit', 1, 'limit', 1], ['column-width', { property: 'price', width: 40 }, 'columnSize', { 'note.price': 40 }], ['column-summary', { property: 'price', summary: 'Sum' }, 'summaries', { price: 'Sum' }],
]
describe('Base action effects', () => {
  it.each(['views', 'results', 'sort', 'filter', 'properties'])('opens the actual %s popover on its own toolbar', async menu => {
    const h = await fixture(configured)
    await h.run('menu-open', menu)
    await waitFor(() => expect(document.querySelector(menu === 'views' ? '.base-view-row' : `.base-${menu}-menu`)).not.toBeNull())
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('observes native search visibility, source mode and explicit source draft saving', async () => {
    const h = await fixture(configured)
    await h.run('search-visibility', true); expect(h.rendered.container.querySelector('.base-search-row')).not.toBeNull()
    await h.run('search-query', 'Fern'); await h.run('search-visibility', false); expect(h.inspect().search).toBe(''); expect(h.rendered.container.querySelector('.base-search-row')).toBeNull()
    const mounted = h.rendered.container.children[0]
    await h.run('view-mode', 'source'); expect(mounted.querySelector('.base-source-editor')).not.toBeNull(); expect(mounted.querySelector('.base-toolbar')).toBeNull()
    const changed = `${configured}sourceProof: changed\n`
    await h.run('source-draft-edit', changed); expect(baseStore(target.filePath).snapshot.content).toBe(changed)
    await h.run('source-save', null); expect(await h.mock.api.vault.readFile(target.filePath)).toBe(changed)
    await h.run('view-mode', 'preview'); expect(mounted.querySelector('.base-toolbar')).not.toBeNull()
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('observes both explicit column sort directions and the full native sort cycle', async () => {
    const h = await fixture(configured)
    for (const [direction, expected] of [['ASC', 'ASC'], ['DESC', 'DESC'], ['NONE', 'NONE'], ['TOGGLE', 'ASC'], ['TOGGLE', 'DESC'], ['TOGGLE', 'NONE']]) {
      await h.run('column-sort', { property: 'price', direction }); await h.run('source-save', null)
      const actual = parse(await h.mock.api.vault.readFile(target.filePath)).views[0].sort
      expect(expected === 'NONE' ? actual : actual?.[0]).toEqual(expected === 'NONE' ? undefined : { property: 'price', direction: expected })
    }
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('retries a known refused source save through its existing owner and preserves its draft', async () => {
    const h = await fixture(configured)
    const changed = `${configured}retryProof: retained\n`
    await h.run('source-draft-edit', changed)
    vi.spyOn(h.mock.api.vault.editors, 'save').mockRejectedValueOnce(Object.assign(new Error('Known refused save'), { outcome: 'not-applied' }))
    await expect(h.run('source-save', null)).rejects.toMatchObject({ outcome: 'not-applied' })
    expect(baseStore(target.filePath).snapshot.content).toBe(changed); expect(await h.mock.api.vault.readFile(target.filePath)).toBe(configured)
    await h.run('source-save', null); expect(await h.mock.api.vault.readFile(target.filePath)).toBe(changed)
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it.each(options)('persists %s in the owning configuration with no source loss', async (action, value, key, expected) => {
    const h = await fixture(configured)
    await h.run(action, value)
    await h.run('source-save', null)
    expect(parse(await h.mock.api.vault.readFile(target.filePath)).views[0][key]).toEqual(expected)
    expect(parse(await h.mock.api.vault.readFile(target.filePath))).toMatchObject({ custom: 'preserved', views: [{ extra: 'retained' }, { name: 'Second' }] })
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('uses indexed view lifecycle and retains two same-file local selections', async () => {
    const h = await fixture(configured)
    await h.run('view-rename', { index: 1, name: 'Renamed' }); await h.run('view-duplicate', { index: 1, name: 'Copy' })
    await h.run('view-add', { name: 'Added', type: 'cards' }); await h.run('view-reorder', { from: 3, to: 1 })
    await h.run('view-default', 2); await h.run('view-delete', 3); await h.run('view-select', 1)
    expect((h.inspect() as any).view).toBe(1); expect((h.inspect({ ...target, mountId: 'other-mount', tabId: 'other' }) as any).view).toBe(0)
    await h.run('source-save', null)
    expect(parse(await h.mock.api.vault.readFile(target.filePath)).views.map((view: any) => view.name)).toEqual(['Renamed', 'Table', 'Added'])
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('observes grouping, sort rules, column controls, display names and formulas in saved bytes', async () => {
    const h = await fixture(configured)
    await h.run('group-property', 'note.done'); await h.run('group-direction', 'DESC')
    await h.run('sort-add', { property: 'price', direction: 'ASC' }); await h.run('sort-add', { property: 'done', direction: 'ASC' })
    await h.run('sort-property', { index: 1, property: 'file.name' }); await h.run('sort-direction', { index: 0, direction: 'DESC' }); await h.run('sort-reorder', { from: 0, to: 1 }); await h.run('sort-remove', 0)
    await h.run('property-visibility', { property: 'price', visible: false }); await h.run('property-order', ['done', 'file.name']); await h.run('property-display-name', { property: 'done', name: 'Complete' })
    await h.run('formula-add', { name: 'cost', expression: 'price * 2' }); await h.run('formula-expression', { name: 'cost', expression: 'price * 3' }); await h.run('formula-rename', { name: 'cost', newName: 'triple' })
    await h.run('source-save', null)
    const saved = parse(await h.mock.api.vault.readFile(target.filePath)); expect(saved).toMatchObject({ formulas: { triple: 'price * 3' }, properties: { done: { displayName: 'Complete' } } }); expect(saved.views[0]).toMatchObject({ groupBy: { property: 'done', direction: 'DESC' }, sort: [{ property: 'price', direction: 'DESC' }] })
    await h.run('formula-delete', 'triple'); await h.run('group-remove', null); await h.run('column-sort', { property: 'done', direction: 'TOGGLE' }); await h.run('column-sort', { property: 'done', direction: 'NONE' }); await h.run('properties-hide-all', null); await h.run('results-show-all', null)
    await h.run('source-save', null)
    const parsed = parse(await h.mock.api.vault.readFile(target.filePath)); expect(parsed.formulas).toEqual({}); expect(parsed.views[0].groupBy).toBeUndefined(); expect(parsed.views[0].order).toEqual([]); expect(parsed.views[0].limit).toBeUndefined()
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('uses the actual mounted menus and refuses overwriting native typing', async () => {
    const h = await fixture(configured)
    await h.run('menu-open', 'views'); await waitFor(() => expect(h.inspect().actions.some(action => action.id === 'configure-view-open')).toBe(true))
    await h.run('view-picker-search', 'Second'); expect(document.querySelectorAll('.base-view-row')).toHaveLength(1)
    await h.run('configure-view-open', 1); await waitFor(() => expect(h.inspect().actions.some(action => action.id === 'configure-view-back')).toBe(true))
    await h.run('cards-size', 350); await h.run('configure-view-back', null); await h.run('source-save', null)
    expect(parse(await h.mock.api.vault.readFile(target.filePath)).views.map((view: any) => view.cardSize)).toEqual([undefined, 350])
    const input = document.querySelector('.base-menu-search input') as HTMLInputElement
    act(() => { fireEvent.focus(input); fireEvent.change(input, { target: { value: 'native' } }) })
    await expect(h.run('view-picker-search', 'replacement')).rejects.toMatchObject({ outcome: 'not-applied' }); expect(input.value).toBe('native')
    act(() => fireEvent.blur(input))
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('mutates filter tree through actual mounted filter callbacks with explicit simple/advanced mode', async () => {
    const h = await fixture(configured)
    await h.run('menu-open', 'filter'); await waitFor(() => expect(h.inspect().actions.some(action => action.id === 'filter:view:rule-add')).toBe(true))
    await h.run('filter-section:all', true); await h.run('filter-section:view', true); await h.run('filter:view:rule-add', null); await h.run('filter:view:kind', 'or')
    await h.run('filter:view.0:property', 'note.price'); await h.run('filter:view.0:operator', '>'); await h.run('filter:view.0:value', '10')
    await h.run('filter:view.0:mode', 'advanced'); await h.run('filter:view.0:expression', 'price >= 8'); await h.run('filter:view.0:mode', 'simple'); await h.run('filter:view:group-add', null)
    await h.run('source-save', null)
    expect(parse(await h.mock.api.vault.readFile(target.filePath)).views[0].filters.or[0]).toBe('price >= 8')
    await h.run('filter:view.1:remove', null); await h.run('filter:view.0:remove', null); await h.run('source-save', null)
    expect(parse(await h.mock.api.vault.readFile(target.filePath)).views[0].filters).toBeUndefined()
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('uses mounted property picker callbacks and observes opened row targets, clipboard and CSV export', async () => {
    const h = await fixture(configured)
    const clipboard = vi.fn(async (_text: string) => {}); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } })
    const open = vi.spyOn(h.mock.api.workspace, 'openFile'); const download = vi.spyOn(h.mock.api.files, 'downloadFile').mockResolvedValue('Downloads/Canopy.csv')
    await h.run('row-open', { row: 0, newTab: true }, undefined, {}, 'execute'); expect(open).toHaveBeenCalledWith('Fern.md', undefined, { newTab: true })
    await h.run('results-copy-markdown', null, undefined, {}, 'execute'); expect(clipboard.mock.calls[0][0]).toContain('|'); expect(clipboard.mock.calls[0][0]).toContain('Fern'); expect(h.mock.api.ui.writeClipboardText).toHaveBeenCalledWith(clipboard.mock.calls[0][0])
    const exported = await h.run('results-export-csv', null, undefined, {}, 'execute'); expect(download.mock.calls[0][1]).toContain('Fern')
    expect(exported).toMatchObject({ status: 'acknowledged', result: { path: 'Downloads/Canopy.csv' } })
    expect(new Ajv({ strict: false, allowUnionTypes: true }).compile(h.command('view-execute').outputSchema!)(exported)).toBe(true)
    download.mockResolvedValueOnce(null)
    await expect(h.run('results-export-csv', null, undefined, {}, 'execute')).rejects.toMatchObject({ outcome: 'not-applied' })
    await h.run('menu-open', 'properties'); await waitFor(() => expect(h.inspect().actions.some(action => action.id === 'properties-query')).toBe(true))
    await h.run('properties-query', 'brand'); await h.run('property-create-from-query', 'brand'); await h.run('property-options-open', 'note.price'); await waitFor(() => expect(h.inspect().actions.some(action => action.id === 'property-options-back')).toBe(true)); await h.run('property-options-back', null)
    await h.run('source-save', null); expect(parse(await h.mock.api.vault.readFile(target.filePath)).views[0].order).toContain('brand')
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('requires observed note bytes and rechecks authorization immediately before native cell saving', async () => {
    const h = await fixture(configured)
    const selected = { row: 'Fern.md', column: 'note.price' }
    const inspected = await h.run('cell-inspect', selected, undefined, {}, 'read') as { result: { rawRevision: string } }
    let checks = 0
    await expect(h.run('cell-property-save', { ...selected, expectedRawRevision: inspected.result.rawRevision, value: 0 }, undefined, { validateBeforeRun: async () => ++checks === 1 })).rejects.toMatchObject({ outcome: 'not-applied' })
    expect(await h.mock.api.vault.readFile('Fern.md')).toContain('price: 12')
    await h.run('cell-property-save', { ...selected, expectedRawRevision: inspected.result.rawRevision, value: 0 })
    expect(await h.mock.api.vault.readFile('Fern.md')).toContain('price: 0')
    await expect(h.run('cell-property-save', { ...selected, expectedRawRevision: inspected.result.rawRevision, value: 99 })).rejects.toMatchObject({ outcome: 'not-applied' })
    await h.run('cell-focus', { ...selected, edit: false }); expect(document.activeElement).toHaveAttribute('data-property', 'note.price')
    await h.run('cell-focus', { ...selected, edit: true }); expect(h.rendered.container.children[0].querySelector('.base-td.is-editing')).not.toBeNull()
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('closes an open inline editor through its commit path when cell-focus moves away without OS window focus', async () => {
    const h = await fixture(configured)
    const selected = { row: 'Fern.md', column: 'note.price' }, root = h.rendered.container.children[0]
    const writes = vi.spyOn(h.mock.api.vault, 'writeTextDocumentGuarded')
    const swallow = (event: Event) => event.stopImmediatePropagation()
    for (const type of ['blur', 'focusout']) window.addEventListener(type, swallow, true)
    try {
      await h.run('cell-focus', { ...selected, edit: true })
      expect(root.querySelector('.base-td.is-editing input')).not.toBeNull()
      expect(h.inspect().actions.find(action => action.id === 'cell-focus')).toMatchObject({ state: selected })
      await h.run('cell-focus', { row: 'Fern.md', column: 'note.done', edit: false })
      expect(root.querySelector('.base-td.is-editing')).toBeNull()
      expect(h.inspect().actions.find(action => action.id === 'cell-focus')).toMatchObject({ state: null })
      expect(document.activeElement).toHaveAttribute('data-property', 'note.done')
      await h.run('cell-focus', { ...selected, edit: true })
      await h.run('cell-focus', { ...selected, edit: false })
      expect(root.querySelector('.base-td.is-editing')).toBeNull()
    } finally { for (const type of ['blur', 'focusout']) window.removeEventListener(type, swallow, true) }
    await h.run('cell-focus', { ...selected, edit: true })
    await h.run('cell-focus', { row: 'Fern.md', column: 'note.done', edit: false })
    expect(root.querySelector('.base-td.is-editing')).toBeNull()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(writes).not.toHaveBeenCalled()
    expect(await h.mock.api.vault.readFile('Fern.md')).toContain('price: 12')
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
})

describe('Base media and guarded file effects', () => {
  it('pairs inspected raw property values with the same file revision while the index lags', async () => {
    const h = await fixture(configured)
    await h.mock.api.vault.writeFile('Fern.md', '---\nprice: 74\n---\n# External fern\n')
    const inspected = await h.run('cell-inspect', { row: 'Fern.md', column: 'note.price' }, undefined, {}, 'read') as { result: { value: unknown; rawRevision: string } }
    expect(inspected.result.value).toBe(74)
    await h.run('cell-property-save', { row: 'Fern.md', column: 'note.price', expectedRawRevision: inspected.result.rawRevision, value: 75 })
    expect(await h.mock.api.vault.readFile('Fern.md')).toContain('price: 75')
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('keeps a committed property write unknown after a lost save acknowledgement and refuses replay', async () => {
    const h = await fixture(configured)
    const selected = { row: 'Fern.md', column: 'note.price' }
    const inspected = await h.run('cell-inspect', selected, undefined, {}, 'read') as { result: { rawRevision: string } }
    const originalWrite = h.mock.api.vault.writeTextDocumentGuarded
    const write = vi.spyOn(h.mock.api.vault, 'writeTextDocumentGuarded').mockImplementationOnce(async (...args) => { await originalWrite(...args); return { ok: false, reason: 'error' } })
    const revision = h.inspect().revision
    const value = { ...selected, expectedRawRevision: inspected.result.rawRevision, value: 88 }
    await expect(h.run('cell-property-save', value, revision)).rejects.toMatchObject({ outcome: 'unknown', retryable: false })
    expect(await h.mock.api.vault.readFile('Fern.md')).toContain('price: 88')
    await expect(h.run('cell-property-save', value, revision)).rejects.toMatchObject({ outcome: 'not-applied' })
    expect(write).toHaveBeenCalledTimes(1)
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('preserves accepted note creation as unknown when subsequent navigation is refused', async () => {
    const h = await fixture(configured)
    vi.spyOn(h.mock.api.workspace, 'openFile').mockRejectedValueOnce(Object.assign(new Error('Known navigation refusal'), { outcome: 'not-applied' }))
    const create = vi.spyOn(h.mock.api.vault, 'writeFileGuarded')
    const revision = h.inspect().revision
    await expect(h.run('new-note', { path: 'Untitled.md', expectedRevision: null }, revision)).rejects.toMatchObject({ outcome: 'unknown', retryable: false })
    expect((await h.mock.api.vault.readFileBaseline('Untitled.md'))?.baseline).toEqual(expect.objectContaining({ hash: expect.any(String) }))
    await expect(h.run('new-note', { path: 'Untitled.md', expectedRevision: null }, revision)).rejects.toMatchObject({ outcome: 'not-applied' })
    expect(create).toHaveBeenCalledTimes(1)
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('addresses actual per-copy map camera owners and copies only observed marker coordinates', async () => {
    const before = mapOwners.values.length
    const h = await fixture(configured.replace('type: table', 'type: map').replace('order: [file.name, price, done, coordinates]', 'order: [file.name, price, done, coordinates]\n    coordinates: note.coordinates\n    defaultZoom: 5'))
    await waitFor(() => expect(mapOwners.values.length).toBe(before + 2))
    await act(async () => { await Promise.resolve() })
    const owned = mapOwners.values[before], other = mapOwners.values[before + 1]
    await h.run('map-zoom-in', null); expect(owned.zoom).toBe(6); expect(other.zoom).toBe(5)
    await h.run('map-zoom-out', null); expect(owned.zoom).toBe(5)
    await expect(h.run('map-zoom-in', null, undefined, { validateBeforeRun: async () => false })).rejects.toMatchObject({ outcome: 'not-applied' }); expect(owned.zoom).toBe(5)
    const clipboard = vi.fn(async (_text: string) => {}); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clipboard } })
    await h.run('map-copy-coordinates', 'Fern.md', undefined, {}, 'execute'); expect(clipboard).toHaveBeenCalledWith('47, 8'); expect(clipboard).toHaveBeenCalledTimes(1); expect(h.mock.api.ui.writeClipboardText).toHaveBeenCalledWith('47, 8')
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('creates a note with native filter defaults and checks the concrete destination at the final boundary', async () => {
    const h = await fixture(configured.replace('custom: preserved', 'custom: preserved\nfilters: price == 18'))
    const checks: unknown[] = []
    const value = { path: 'Untitled.md', expectedRevision: null }
    const admission = h.command('view-action').fileTargets!({ target, expectedRevision: h.inspect().revision, action: 'new-note', value })
    await h.run('new-note', value, undefined, { validateBeforeRun: async (files: unknown) => { checks.push(files); expect(files).toEqual(admission); return true } })
    expect(await h.mock.api.vault.readFile('Untitled.md')).toContain('price: 18')
    expect(checks).toContainEqual(expect.arrayContaining([{ kind: 'file', path: 'Untitled.md', fileOperation: 'write' }]))
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('refuses an occupied exact new-note destination without silently selecting another path', async () => {
    const h = await fixture(configured)
    await h.mock.api.vault.writeFile('Untitled.md', '# Existing fern\n')
    await expect(h.run('new-note', { path: 'Untitled.md', expectedRevision: null })).rejects.toMatchObject({ outcome: 'not-applied' })
    expect(await h.mock.api.vault.readFile('Untitled.md')).toBe('# Existing fern\n')
    expect((await h.mock.api.vault.readFileBaseline('Untitled 1.md'))?.baseline ?? null).toBeNull()
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('refuses cell saving after a native view change during final authorization', async () => {
    const h = await fixture(configured)
    const selected = { row: 'Fern.md', column: 'note.price' }
    const inspected = await h.run('cell-inspect', selected, undefined, {}, 'read') as { result: { rawRevision: string } }
    const write = vi.spyOn(h.mock.api.vault, 'writeTextDocumentGuarded')
    let checks = 0
    await expect(h.run('cell-property-save', { ...selected, expectedRawRevision: inspected.result.rawRevision, value: 91 }, undefined, { validateBeforeRun: async () => {
      if (++checks === 2) await act(async () => { baseStore(target.filePath).edit(configured.replace('name: Table', 'name: Changed'), true, target) })
      return true
    } })).rejects.toMatchObject({ outcome: 'not-applied' })
    expect(write).not.toHaveBeenCalled()
    expect(await h.mock.api.vault.readFile('Fern.md')).toContain('price: 12')
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('refuses old cell eligibility after the native view selector changes during final authorization', async () => {
    const h = await fixture(configured)
    await h.run('menu-open', 'views')
    await waitFor(() => expect(document.querySelectorAll('.base-view-row')).toHaveLength(2))
    const selected = { row: 'Fern.md', column: 'note.price' }
    const inspected = await h.run('cell-inspect', selected, undefined, {}, 'read') as { result: { rawRevision: string } }
    const write = vi.spyOn(h.mock.api.vault, 'writeTextDocumentGuarded')
    let checks = 0
    await expect(h.run('cell-property-save', { ...selected, expectedRawRevision: inspected.result.rawRevision, value: 92 }, undefined, { validateBeforeRun: async () => {
      if (++checks === 2) await act(async () => { fireEvent.click(document.querySelectorAll('.base-view-row .base-menu-item')[1]) })
      return true
    } })).rejects.toMatchObject({ outcome: 'not-applied' })
    expect(write).not.toHaveBeenCalled()
    expect((h.inspect() as any).view).toBe(1)
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('refuses old cell eligibility after the native index refresh changes its property widget', async () => {
    const h = await fixture(configured)
    const raw = '---\nprice: { shade: green }\n---\n# Fern\n'
    await h.mock.api.vault.writeFile('Fern.md', raw)
    const selected = { row: 'Fern.md', column: 'note.price' }
    const inspected = await h.run('cell-inspect', selected, undefined, {}, 'read') as { result: { rawRevision: string; value: unknown } }
    expect(inspected.result.value).toEqual({ shade: 'green' })
    const write = vi.spyOn(h.mock.api.vault, 'writeTextDocumentGuarded')
    let checks = 0
    const revision = h.inspect().revision
    await expect(h.run('cell-property-save', { ...selected, expectedRawRevision: inspected.result.rawRevision, value: 93 }, revision, { validateBeforeRun: async () => {
      if (++checks === 2) {
        await act(async () => { h.mock.emitState({ indexEntries: [{ relPath: 'Fern.md', title: 'Fern', kind: 'note', mtimeMs: 2000, frontmatter: { price: { shade: 'green' } } }] }) })
        await waitFor(() => expect(currentSession().index.entries()[0].frontmatter?.price).toEqual({ shade: 'green' }))
        flushSync(() => {})
        expect(h.rendered.container.querySelector('[data-row-path="Fern.md"] [data-property="note.price"] [data-property-type]')).toHaveAttribute('data-property-type', 'unknown')
      }
      return true
    } })).rejects.toMatchObject({ outcome: 'not-applied' })
    expect(write).not.toHaveBeenCalled()
    expect(h.inspect().revision).not.toBe(revision)
    expect(await h.mock.api.vault.readFile('Fern.md')).toBe(raw)
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
  it('reports lost external acknowledgement as unknown without retrying the native effect', async () => {
    const h = await fixture(configured)
    let effects = 0
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { effects++; throw new Error('lost acknowledgement') } } })
    const observed = h.inspect().revision
    await expect(h.run('results-copy-markdown', null, observed, {}, 'execute')).rejects.toMatchObject({ outcome: 'unknown', retryable: false })
    await expect(h.run('results-copy-markdown', null, observed, {}, 'execute')).rejects.toMatchObject({ outcome: 'not-applied' }); expect(effects).toBe(1)
    await act(async () => { h.rendered.unmount(); await h.dispose() })
  })
})

it('publishes valid bounded action schemas and validates actual typed response proofs', async () => {
  const h = await fixture(configured)
  const compile = new Ajv({ strict: false, allowUnionTypes: true }).compile.bind(new Ajv({ strict: false, allowUnionTypes: true }))
  for (const action of h.inspect().actions) expect(() => compile(action.schema), action.id).not.toThrow()
  for (const id of ['view-inspect', 'view-read', 'view-action', 'view-execute']) {
    const command = h.command(id)
    const output = compile(command.outputSchema!)
    expect(output({ unrelated: true }), id).toBe(false)
    if (id === 'view-inspect') expect(output(h.inspect())).toBe(true)
    if (id === 'view-action') expect(output((await h.run('search-query', 'Fern') as { value: unknown }).value)).toBe(true)
  }
  await act(async () => { h.rendered.unmount(); await h.dispose() })
})

it('clears popover input focus when its separate popover document closes so the Base can close', async () => {
  const h = await fixture()
  const popoverDocument = document.implementation.createHTMLDocument('popover')
  vi.mocked(h.mock.api.ui.openPopover).mockImplementation((content, _target, options) => new Promise(resolve => { const element = popoverDocument.body.appendChild(popoverDocument.createElement('div')); const panel = createRoot(element); panel.render(<div role="dialog" aria-label={options?.ariaLabel}>{content({ close })}</div>); function close() { queueMicrotask(() => { panel.unmount(); element.remove() }); resolve() } }))
  const editor = vi.mocked(h.mock.api.vault.editors.register).mock.calls.filter(call => call[0].mountId === target.mountId).map(call => call[1]).at(-1)!
  await h.run('menu-open', 'views')
  await waitFor(() => expect(popoverDocument.querySelector('input')).not.toBeNull())
  act(() => { popoverDocument.querySelector('input')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true })) })
  await waitFor(async () => expect((await editor.getSnapshot()).dirty).toBe(true))
  await h.run('menu-open', 'views')
  await waitFor(() => expect(popoverDocument.querySelector('input')).toBeNull())
  expect((await editor.getSnapshot()).dirty).toBe(false)
  await act(async () => { h.rendered.unmount(); await h.dispose(); await new Promise(resolve => setTimeout(resolve, 50)) })
})

it('clears search input focus when the search row closes so the Base can close', async () => {
  const h = await fixture()
  const editor = vi.mocked(h.mock.api.vault.editors.register).mock.calls.filter(call => call[0].mountId === target.mountId).map(call => call[1]).at(-1)!
  await h.run('search-visibility', true)
  const input = await waitFor(() => { const value = h.rendered.container.querySelector<HTMLInputElement>('.base-search-row input'); expect(value).not.toBeNull(); return value! })
  act(() => { input.dispatchEvent(new FocusEvent('focusin', { bubbles: true })) })
  await waitFor(async () => expect((await editor.getSnapshot()).dirty).toBe(true))
  await h.run('search-visibility', false)
  await waitFor(() => expect(h.rendered.container.querySelector('.base-search-row')).toBeNull())
  await waitFor(async () => expect((await editor.getSnapshot()).dirty).toBe(false))
  await act(async () => { h.rendered.unmount(); await h.dispose(); await new Promise(resolve => setTimeout(resolve, 50)) })
})

it('saves one property or view option without reformatting untouched YAML and keeps a focused cell clean', async () => {
  const long = 'a canopy survey note that keeps going well beyond the default folding width of eighty characters'
  const h = await fixture(configured.replace('views:', `summary: ${long}\nviews:`))
  const editor = vi.mocked(h.mock.api.vault.editors.register).mock.calls.filter(call => call[0].mountId === target.mountId).map(call => call[1]).at(-1)!
  await h.mock.api.vault.writeFile('Fern.md', `---\nprice: 12\ndone: false\ncoordinates: [47, 8]\nnote: ${long}\n---\n# Fern\n`)
  const selected = { row: 'Fern.md', column: 'note.price' }
  const inspected = await h.run('cell-inspect', selected, undefined, {}, 'read') as { result: { rawRevision: string } }
  await h.run('cell-property-save', { ...selected, expectedRawRevision: inspected.result.rawRevision, value: 13 })
  expect(await h.mock.api.vault.readFile('Fern.md')).toBe(`---\nprice: 13\ndone: false\ncoordinates: [47, 8]\nnote: ${long}\n---\n# Fern\n`)
  await h.run('cards-size', 260); await h.run('source-save', null)
  expect(await h.mock.api.vault.readFile(target.filePath)).toContain(`summary: ${long}\n`)
  expect(await h.mock.api.vault.readFile(target.filePath)).toContain('    order: [file.name, price, done, coordinates]\n')
  await h.run('cell-focus', { ...selected, edit: false })
  expect(document.activeElement).toHaveAttribute('data-property', 'note.price')
  expect((await editor.getSnapshot()).dirty).toBe(false)
  await act(async () => { h.rendered.unmount(); await h.dispose(); await new Promise(resolve => setTimeout(resolve, 50)) })
})
