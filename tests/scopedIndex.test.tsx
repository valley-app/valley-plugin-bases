import { afterEach, expect, it, vi } from 'vitest'
import * as React from 'react'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { FILE_TREE_CONTEXT_ITEM_V1, type PluginIndexPage } from '@valley/plugin-sdk'
import { createMockValleyApi } from '@valley/plugin-testkit'
import { register } from '../src/index'
import { currentSession } from '../src/runtime'
import { useBaseController } from '../src/controller'
import { EMPTY_BASE } from '../src/files'
import BaseEditor from '../src/BaseEditor'

const entry = (index: number) => ({ relPath: `Grove/${index}.md`, title: `Unused ${index}`, kind: 'note' as const, mtimeMs: 1000, ctimeMs: 100, size: index, frontmatter: { price: index }, tags: ['trees'], links: ['tree'], linkPaths: ['Tree.md'], embedPaths: ['Tree.png'], aliases: ['unused'] })
const cleanups: (() => unknown)[] = []
const releases: (() => void)[] = []
afterEach(async () => { for (const release of releases.splice(0)) release(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.restoreAllMocks() })

it('opens linked properties and resolves cover assets without the legacy index snapshot', async () => {
  const mock = createMockValleyApi({ manifest: { id: 'bases', indexState: 'scoped' }, indexEntries: [
    { ...entry(0), frontmatter: { related: '[[Named target|Linked target]]', cover: 'Fern.png' } },
    { ...entry(1), aliases: ['Named target'] },
    { relPath: 'Images/Fern.png', title: 'Fern', kind: 'asset', mtimeMs: 1 }
  ] })
  vi.spyOn(mock.api.workspace, 'resolveWikilink').mockImplementation(() => { throw new Error('Legacy index resolver is unavailable') })
  cleanups.push(register(mock.api))
  const mounted = render(<BaseEditor relPath="Values.base" source={'views:\n  - type: cards\n    name: Values\n    image: cover\n    order: [file.name, related]\n'} />)
  cleanups.push(mounted.unmount)
  fireEvent.click(await screen.findByText('Linked target'))
  expect(mock.api.workspace.openFile).toHaveBeenCalledWith('Grove/1.md', undefined, expect.anything())
  const cover = mounted.container.querySelector('.base-card-cover img')
  expect(decodeURIComponent(cover?.getAttribute('src') ?? '')).toContain('Images/Fern.png')
  expect(mock.api.getState().indexEntries).toEqual([])
})

function hold(mock: ReturnType<typeof createMockValleyApi>, offset: number) {
  const observe = mock.api.index.observe
  let captured: PluginIndexPage | undefined
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  releases.push(release)
  const disposed = vi.fn()
  vi.spyOn(mock.api.index, 'observe').mockImplementation(async (scope, listener) => {
    const owner = await observe(scope, listener)
    return { read: async request => {
      const page = await owner.read(request)
      if (request?.offset === offset && !captured) { captured = page; await gate }
      return page
    }, dispose: async () => { disposed(); await owner.dispose() } }
  })
  return { release, captured: () => captured, disposed }
}

it('keeps queries and file-context creation behind complete scoped pages', async () => {
  const mock = createMockValleyApi({ manifest: { id: 'bases', indexState: 'scoped' }, indexEntries: Array.from({ length: 129 }, (_, index) => entry(index)) })
  const held = hold(mock, 128)
  cleanups.push(register(mock.api))
  const view = renderHook(() => useBaseController({ relPath: 'Query.base', source: EMPTY_BASE }))
  cleanups.push(view.unmount)
  await waitFor(() => expect(held.captured()).toBeDefined())
  const context = mock.api.interop.extensions.providers(FILE_TREE_CONTEXT_ITEM_V1)[0].extension
  const creating = context.run('Grove/128.md')
  expect(view.result.current.rows).toEqual([])
  expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
  expect(mock.api.getState().indexEntries).toEqual([])
  await act(async () => { held.release(); await creating })
  expect(view.result.current.rows).toHaveLength(129)
  expect(mock.api.vault.writeFileGuarded).toHaveBeenCalledWith('Grove/Untitled.base', expect.any(String), null)
  await context.run('Other')
  expect(mock.api.vault.writeFileGuarded).toHaveBeenCalledWith('Other/Untitled.base', expect.any(String), null)
  const projected = currentSession().index.entries()[0]
  expect(projected).toMatchObject({ size: 0, frontmatter: { price: 0 }, linkPaths: ['Tree.md'], embedPaths: ['Tree.png'], tags: ['trees'], ctimeMs: 100, mtimeMs: 1000 })
  expect(projected.aliases).toEqual(['unused'])
  expect(mock.api.index.observe).toHaveBeenCalledOnce()
  expect(mock.api.index.observe).toHaveBeenCalledWith({ fields: ['aliases', 'ctimeMs', 'embedPaths', 'excluded', 'frontmatter', 'linkPaths', 'links', 'mtimeMs', 'size', 'tags', 'title'] }, expect.any(Function))
})

it('keeps committed property edits visible before their scoped index update arrives', async () => {
  const mock = createMockValleyApi({ manifest: { id: 'bases', indexState: 'scoped' }, indexEntries: [entry(0)], files: { 'Grove/0.md': '---\nprice: 0\n---\nBody' } })
  cleanups.push(register(mock.api))
  const source = 'views:\n  - type: table\n    name: Values\n    order: [file.name, price]\n'
  const view = renderHook(() => useBaseController({ relPath: 'Query.base', source }))
  cleanups.push(view.unmount)
  await waitFor(() => expect(view.result.current.rows).toHaveLength(1))
  await act(async () => { await view.result.current.editProperty('Grove/0.md', 'price', 99) })
  expect(view.result.current.rows[0].raw['note.price']).toBe(99)
  expect(mock.api.getState().indexEntries).toEqual([])
})

it('joins observation reads and releases once when its owning session closes', async () => {
  const mock = createMockValleyApi({ manifest: { id: 'bases', indexState: 'scoped' }, indexEntries: [entry(0)] })
  const held = hold(mock, 0)
  const dispose = register(mock.api)
  cleanups.push(dispose)
  const index = currentSession().index
  const readiness = expect(index.ready()).rejects.toThrow('closed')
  await waitFor(() => expect(held.captured()).toBeDefined())
  const changed = vi.fn()
  index.subscribe(changed)
  const closing = dispose()
  const ended = vi.fn()
  void closing.then(ended)
  await readiness
  expect(ended).not.toHaveBeenCalled()
  held.release(); await closing
  expect(held.disposed).toHaveBeenCalledOnce()
  expect(changed).not.toHaveBeenCalled()
  expect(index.entries()).toEqual([])
})
