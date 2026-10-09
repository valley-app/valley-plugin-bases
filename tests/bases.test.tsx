import Ajv from 'ajv'
import * as React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMockValleyApi } from '@valley/plugin-testkit'
import { parse } from 'yaml'
import { PLUGIN_SURFACE_V1, WORKSPACE_DETAILS_V1 } from '@valley/plugin-sdk'
import BaseEditor from '../src/BaseEditor'
import { register } from '../src/index'
import { initRuntime } from '../src/runtime'
import { baseStore } from '../src/store'
import { changeBase, createBase, EMPTY_BASE, newNoteDefaults, replaceInlineBase } from '../src/files'

afterEach(() => vi.useRealTimers())

describe('Base documents', () => {
  it('declares the create result and observes its file and guarded restoration', async () => {
    const mock = createMockValleyApi({ manifest: { id: 'bases' }, files: { 'Untitled.base': 'keep' } })
    const registrations = vi.spyOn(mock.api.commands, 'register')
    const dispose = register(mock.api)
    try {
      const command = registrations.mock.calls.map(([value]) => value as typeof value & { outputSchema: Record<string, unknown> }).find(value => value.id === 'create')!
      const validate = new Ajv({ strict: false, strictSchema: true }).compile(command.outputSchema)
      const result = await mock.api.commands.execute('bases:create', {})
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(JSON.stringify(result))
      expect(validate(result.value), JSON.stringify(validate.errors)).toBe(true)
      expect(validate({ relPath: 'Untitled.base', unexpected: true })).toBe(false)
      expect(await mock.api.vault.readFile('Untitled 1.base')).toBe(EMPTY_BASE)
      await mock.busUndo.at(-1)!.undo()
      expect(await mock.api.vault.stat('Untitled 1.base')).toBeNull()
      expect(await mock.api.vault.readFile('Untitled.base')).toBe('keep')
    } finally { await dispose() }
  })

  it('allows sandbox hydration before a file opens without exposing an incomplete bookmark', async () => {
    const mock = createMockValleyApi({ manifest: { id: 'bases' } })
    const dispose = register(mock.api)
    const provider = mock.api.interop.extensions.providers(PLUGIN_SURFACE_V1)[0].extension
    expect(provider.getSnapshot()).toMatchObject({ title: 'Bases', view: {} })
    expect(provider.getSnapshot().bookmark).toBeUndefined()
    expect(provider.getSnapshot().bookmarkView).toBeUndefined()
    await dispose()
  })

  it('shares scoped file refreshes and ignores unrelated saves', async () => {
    const mock = createMockValleyApi({ manifest: { id: 'bases' }, files: { 'Test.base': EMPTY_BASE } })
    initRuntime(mock.api)
    const store = baseStore('Test.base')
    expect(baseStore('Test.base')).toBe(store)
    await waitFor(() => expect(store.snapshot.loaded).toBe(true))
    const read = vi.spyOn(mock.api.vault, 'readFileBaseline')
    mock.emitVaultChanged({ changes: [{ relPath: 'Other.md', kind: 'change' }] })
    expect(read).not.toHaveBeenCalled()
    mock.emitVaultChanged({ changes: [{ relPath: 'Test.base', kind: 'change' }] })
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    await store.load()
    read.mockClear()
    mock.emitVaultChanged({ full: true })
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1))
    store.dispose()
  })

  it('merges changes during a read and never publishes the older base', async () => {
    const mock = createMockValleyApi({ manifest: { id: 'bases' }, files: { 'Test.base': EMPTY_BASE } })
    initRuntime(mock.api)
    const store = baseStore('Test.base')
    await waitFor(() => expect(store.snapshot.loaded).toBe(true))
    const original = store.snapshot.file!
    let complete!: (file: typeof original) => void
    const read = vi.spyOn(mock.api.vault, 'readFileBaseline')
    read.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    read.mockResolvedValueOnce({ ...original, content: EMPTY_BASE.replace('Table', 'Newest') })
    const published: string[] = []
    store.subscribe(() => published.push(store.snapshot.content))
    const pending = store.load()
    for (let index = 0; index < 20; index++) mock.emitVaultChanged({ changes: [{ relPath: 'Test.base', kind: 'change' }] })
    expect(read).toHaveBeenCalledTimes(1)
    complete({ ...original, content: EMPTY_BASE.replace('Table', 'Stale') })
    await pending
    expect(read).toHaveBeenCalledTimes(2)
    expect(published).toEqual([EMPTY_BASE.replace('Table', 'Newest')])
    store.dispose()
  })

  it('retains an edit made during a pending file read and stops reading after disposal', async () => {
    const mock = createMockValleyApi({ manifest: { id: 'bases' }, files: { 'Test.base': EMPTY_BASE } })
    initRuntime(mock.api)
    const store = baseStore('Test.base')
    await waitFor(() => expect(store.snapshot.loaded).toBe(true))
    const original = store.snapshot.file!
    let complete!: (file: typeof original) => void
    const read = vi.spyOn(mock.api.vault, 'readFileBaseline')
    read.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
    const pending = store.load()
    store.edit(EMPTY_BASE.replace('Table', 'Draft'))
    complete({ ...original, content: EMPTY_BASE.replace('Table', 'External') })
    await pending
    expect(store.snapshot.content).toContain('Draft')
    expect(store.snapshot.file).toEqual(original)
    store.dispose()
    mock.emitVaultChanged({ full: true })
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('creates a real base without replacing an existing file and has guarded undo', async () => {
    const mock = createMockValleyApi({
      manifest: { id: 'bases' },
      files: { 'Untitled.base': 'original' },
    })
    const result = await createBase(mock.api)
    expect(result.value.relPath).toBe('Untitled 1.base')
    expect(await mock.api.vault.readFile('Untitled.base')).toBe('original')
    expect(parse(await mock.api.vault.readFile(result.value.relPath))).toMatchObject({
      views: [{ type: 'table' }],
    })
    expect(mock.api.workspace.openFile).toHaveBeenCalledWith(result.value.relPath)
    expect(result.revert).toBeTruthy()
  })

  it.each(['../escape', '/absolute', 'folder/../escape'])(
    'rejects invalid creation folder %s',
    async (folder) => {
      const mock = createMockValleyApi({ manifest: { id: 'bases' } })
      await expect(createBase(mock.api, folder)).rejects.toThrow('vault folder')
      expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
    },
  )

  it('edits an inline Base without changing the rest of its note and supports guarded undo', async () => {
    const fence = String.fromCharCode(96).repeat(3)
    const content = '# Review\n\n' + fence + 'base\n' + EMPTY_BASE + fence + '\n\nKeep the rest.\n'
    const mock = createMockValleyApi({ manifest: { id: 'bases' }, files: { 'Review.md': content } })
    initRuntime(mock.api)
    const store = baseStore('Review.md', EMPTY_BASE)
    await waitFor(() => expect(store.snapshot.file).toBeTruthy())
    store.edit(EMPTY_BASE.replace('Table', 'Inline'))
    await store.flush()
    expect(await mock.api.vault.readFile('Review.md')).toBe(content.replace('Table', 'Inline'))
    expect(await mock.undoActions[0].undo()).toMatchObject({ ok: true })
    expect(await mock.api.vault.readFile('Review.md')).toBe(content)
    expect(() => replaceInlineBase(content + content, EMPTY_BASE, 'new')).toThrow('uniquely')
    expect(() => replaceInlineBase(content, 'changed elsewhere', 'new')).toThrow('changed')
    store.dispose()
  })

  it('keeps YAML comments and unknown fields when resizing or configuring a view', () => {
    const source =
      '# Keep this comment\ncustom: preserve\nviews:\n  - name: Table\n    type: table\n    pluginOption: keep\n'
    const result = changeBase(source, 0, { columnSize: { 'file.name': 220 } })
    expect(result).toContain('# Keep this comment')
    expect(parse(result)).toMatchObject({
      custom: 'preserve',
      views: [{ pluginOption: 'keep', columnSize: { 'file.name': 220 } }],
    })
    expect(() => changeBase('views: [', 0, {})).toThrow('Invalid base YAML')
  })

  it('inherits only deterministic filter values when creating a note', () => {
    expect(
      newNoteDefaults(
        [
          {
            and: [
              'file.inFolder("Plants")',
              'status == "active"',
              'price == 12',
              'file.hasTag("plant/fern")',
              { or: ['owner == "A"', 'owner == "B"'] },
            ],
          },
        ],
        'Review.base',
      ),
    ).toEqual({
      folder: 'Plants',
      properties: { status: 'active', price: 12, tags: ['plant/fern'] },
    })
  })

  it('retains a conflicting draft and never overwrites newer disk content', async () => {
    const mock = createMockValleyApi({
      manifest: { id: 'bases' },
      files: { 'Test.base': EMPTY_BASE },
    })
    initRuntime(mock.api)
    const store = baseStore('Test.base')
    await waitFor(() => expect(store.snapshot.loaded).toBe(true))
    store.edit(EMPTY_BASE.replace('Table', 'Draft'))
    vi.mocked(mock.api.vault.writeFileGuarded).mockResolvedValueOnce({
      ok: false,
      reason: 'conflict',
      current: null,
    })
    await expect(store.flush()).rejects.toThrow('draft is preserved')
    await store.load()
    expect(store.snapshot.content).toContain('Draft')
    expect(await mock.api.vault.readFile('Test.base')).toBe(EMPTY_BASE)
  })

  it('undoes and redoes view edits and rejects undo after a newer change', async () => {
    const mock = createMockValleyApi({
      manifest: { id: 'bases' },
      files: { 'Test.base': EMPTY_BASE },
    })
    initRuntime(mock.api)
    const store = baseStore('Test.base')
    await waitFor(() => expect(store.snapshot.loaded).toBe(true))
    store.edit(EMPTY_BASE.replace('Table', 'Renamed'))
    await store.flush()
    expect(mock.undoActions).toHaveLength(1)
    expect(await mock.undoActions[0].undo()).toEqual({ ok: true })
    expect(await mock.api.vault.readFile('Test.base')).toBe(EMPTY_BASE)
    expect(await mock.undoActions[0].redo!()).toEqual({ ok: true })
    expect(await mock.api.vault.readFile('Test.base')).toContain('Renamed')
    store.edit(EMPTY_BASE.replace('Table', 'Newer'))
    expect(await mock.undoActions[0].undo()).toMatchObject({ ok: false })
    store.dispose()
  })

  it('flushes an edit arriving while the first write is in flight before unload completes', async () => {
    const mock = createMockValleyApi({
      manifest: { id: 'bases' },
      files: { 'Test.base': EMPTY_BASE },
    })
    const dispose = register(mock.api)
    const store = baseStore('Test.base')
    await waitFor(() => expect(store.snapshot.loaded).toBe(true))
    const write = vi.mocked(mock.api.vault.writeFileGuarded).getMockImplementation()!
    let finish!: () => void
    const blocked = new Promise<void>((resolve) => {
      finish = resolve
    })
    vi.mocked(mock.api.vault.writeFileGuarded).mockImplementationOnce(async (...args) => {
      await blocked
      return write(...args)
    })
    store.edit(EMPTY_BASE.replace('Table', 'First'))
    const unload = mock.runBeforeUnload()
    await waitFor(() => expect(mock.api.vault.writeFileGuarded).toHaveBeenCalledTimes(1))
    store.edit(EMPTY_BASE.replace('Table', 'Newest'))
    finish()
    await unload
    expect(await mock.api.vault.readFile('Test.base')).toContain('Newest')
    expect(mock.api.vault.writeFileGuarded).toHaveBeenCalledTimes(2)
    dispose()
  })
})

describe('Base source editor', () => {
  it('switches the selected tab through footer details and preserves raw edits across views', async () => {
    const mock = createMockValleyApi({ manifest: { id: 'bases' }, files: { 'Test.base': EMPTY_BASE } })
    vi.spyOn(mock.api.ui, 'registerCatalogs').mockImplementation((catalogs) => {
      vi.spyOn(mock.api.ui, 't').mockImplementation((key) => catalogs.en[key] ?? key)
      return () => {}
    })
    const dispose = register(mock.api)
    const rendered = render(<><BaseEditor relPath="Test.base" tab={{ id: 'left' }} /><BaseEditor relPath="Test.base" tab={{ id: 'right' }} /></>)
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Table' })).toHaveLength(2))
    const provider = mock.api.interop.extensions.providers(WORKSPACE_DETAILS_V1)[0].extension
    const context = { filePath: 'Test.base', instanceId: 'left', selectedItemIds: ['view'] }
    expect(provider.defaultItems).toContain('view')
    expect(provider.getSnapshot(context).items.view.value).toBe('preview')
    await act(async () => { await provider.invoke!(context, 'view', 'source') })
    const editor = screen.getByRole('textbox', { name: 'Base source editor' })
    expect(screen.getAllByRole('button', { name: 'Table' })).toHaveLength(1)
    const content = '# Retain this comment\n' + EMPTY_BASE.replace('Table', 'Plants')
    fireEvent.change(editor, { target: { value: content } })
    await act(async () => { await baseStore('Test.base').flush() })
    expect(await mock.api.vault.readFile('Test.base')).toBe(content)
    await act(async () => { await provider.invoke!(context, 'view', 'preview') })
    expect(screen.getAllByRole('button', { name: 'Plants' })).toHaveLength(2)
    await act(async () => { await provider.invoke!(context, 'view', 'source') })
    fireEvent.change(screen.getByRole('textbox', { name: 'Base source editor' }), { target: { value: 'views: [' } })
    await act(async () => { await provider.invoke!(context, 'view', 'preview') })
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0)
    await act(async () => { await provider.invoke!(context, 'view', 'source') })
    expect(screen.getByRole('textbox', { name: 'Base source editor' })).toHaveValue('views: [')
    fireEvent.change(screen.getByRole('textbox', { name: 'Base source editor' }), { target: { value: content } })
    await act(async () => { await baseStore('Test.base').flush() })
    rendered.unmount()
    expect(provider.getSnapshot(context).items).toEqual({})
    await dispose()
  })
})

describe('Base editor', () => {
  function presentPopovers(mock: ReturnType<typeof createMockValleyApi>) {
    vi.spyOn(mock.api.ui, 'openPopover').mockImplementation((content, _target, options) => new Promise((resolve) => {
      const panel = render(<div role="dialog" aria-label={options?.ariaLabel}>{content({ close })}</div>)
      function close() { queueMicrotask(() => panel.unmount()); resolve() }
    }))
  }

  function mount(
    source = 'views:\n  - type: table\n    name: Table\n    order: [file.name, price, done]\n',
    props: { viewName?: string; thisPath?: string } = {},
  ) {
    const mock = createMockValleyApi({
      manifest: { id: 'bases' },
      files: {
        'Test.base': source,
        'Fern.md': '---\nprice: 12\ndone: false\n---\n# Fern\n',
      },
      indexEntries: [
        {
          relPath: 'Fern.md',
          title: 'Fern',
          kind: 'note',
          mtimeMs: 1000,
          frontmatter: { price: 12, done: false },
        },
      ],
    })
    vi.spyOn(mock.api.ui, 'registerCatalogs').mockImplementation((catalogs) => {
      vi.spyOn(mock.api.ui, 't').mockImplementation((key) => catalogs.en[key] ?? key)
      return () => {}
    })
    register(mock.api)
    presentPopovers(mock)
    return { mock, ...render(<BaseEditor relPath="Test.base" {...props} />) }
  }

  const popover = (container: HTMLElement): HTMLElement => {
    const node = container.ownerDocument.querySelector('.base-popover')
    if (!(node instanceof HTMLElement)) throw new Error('No open menu')
    return node
  }
  const priceCell = async (): Promise<HTMLElement> => (await screen.findByText('12')).closest('.base-td') as HTMLElement

  it('renders the same model in a file and a note context', async () => {
    const { mock } = mount(
      'formulas:\n  context: this.file.name\nviews:\n  - type: table\n    name: Table\n    order: [file.name, formula.context]\n',
    )
    expect(await screen.findByText('Test.base')).toBeTruthy()
    const inline = render(
      <BaseEditor
        relPath="Test.base"
        thisPath="Review.md"
        source={'formulas:\n  context: this.file.name\nviews:\n  - type: list\n    name: List\n    order: [formula.context]'}
      />,
    )
    expect(await inline.findAllByText(/Review/)).not.toHaveLength(0)
    expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
  })

  it('highlights the displayed view in the view menu', async () => {
    const { container } = mount(
      'views:\n  - type: table\n    name: Context\n    order: [file.name]\n  - type: table\n    name: Same date\n    order: [file.name]\n  - type: table\n    name: Backlinks\n    order: [file.name]\n',
      { viewName: 'Backlinks' },
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Backlinks' }))
    const menu = await waitFor(() => popover(container))
    const selected = within(menu).getByRole('button', { name: 'Backlinks' })
    expect(selected).toHaveAttribute('aria-current', 'true')
    expect(selected.closest('.base-view-row')).toHaveClass('is-active')
    expect(within(menu).getByRole('button', { name: 'Context' })).not.toHaveAttribute('aria-current')
  })

  it('clears a view search and keeps focus in the popup', async () => {
    const { container } = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Table' }))
    const menu = await waitFor(() => popover(container))
    const search = within(menu).getByRole('textbox', { name: 'Search' })
    fireEvent.change(search, { target: { value: 'missing' } })
    expect(within(menu).getByRole('status')).toHaveTextContent('No results')
    fireEvent.click(within(menu).getByRole('button', { name: 'Clear' }))
    expect(search).toHaveValue('')
    expect(search).toHaveFocus()
    expect(within(menu).getByRole('button', { name: 'Table' })).toBeTruthy()
  })

  it('reopens a popup after the host dismisses it and closes it on unmount', async () => {
    const { mock, unmount } = mount()
    let dismiss!: () => void
    vi.mocked(mock.api.ui.openPopover).mockImplementation((_render, _target, _options) => new Promise((resolve) => { dismiss = resolve }))
    const anchor = await screen.findByRole('button', { name: 'Table' })
    fireEvent.click(anchor)
    expect(mock.api.ui.openPopover).toHaveBeenCalledWith(expect.any(Function), { anchor, align: 'start', gap: 4 }, expect.objectContaining({ width: 260, ariaLabel: 'Table' }))
    await act(async () => dismiss())
    const close = vi.fn()
    vi.mocked(mock.api.ui.openPopover).mockImplementation((content) => { content({ close }); return new Promise(() => {}) })
    fireEvent.click(anchor)
    expect(mock.api.ui.openPopover).toHaveBeenCalledTimes(2)
    unmount()
    expect(close).toHaveBeenCalledOnce()
  })

  it('keeps a manual view during index refreshes and follows a requested view moved within the same view count', async () => {
    const mock = createMockValleyApi({ manifest: { id: 'bases' } })
    presentPopovers(mock)
    initRuntime(mock.api)
    const source = (names: string[]): string => `views:\n${names.map((name) => `  - type: table\n    name: ${name}\n    order: [file.name]\n`).join('')}`
    const editor = render(<BaseEditor relPath="Test.base" source={source(['First', 'Second', 'Third'])} viewName="Second" />)
    fireEvent.click(await within(editor.container).findByRole('button', { name: 'Second' }))
    fireEvent.click(within(await waitFor(() => popover(editor.container))).getByRole('button', { name: 'Third' }))
    expect(within(editor.container).getByRole('button', { name: 'Third' })).toBeTruthy()
    act(() => mock.emitState({ indexEntries: [] }))
    expect(within(editor.container).getByRole('button', { name: 'Third' })).toBeTruthy()
    editor.rerender(<BaseEditor relPath="Test.base" source={source(['Second', 'First', 'Third'])} viewName="Second" />)
    expect(await within(editor.container).findByRole('button', { name: 'Second' })).toBeTruthy()
  })

  it('writes numeric and checkbox cells into frontmatter while preserving body text', async () => {
    const { mock } = mount()
    fireEvent.click(await priceCell())
    const input = screen.getByRole('textbox', { name: 'price' })
    fireEvent.change(input, { target: { value: '18.5' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(async () => expect(await mock.api.vault.readFile('Fern.md')).toContain('price: 18.5'))
    fireEvent.click(screen.getByRole('checkbox', { name: 'done' }))
    await waitFor(async () => expect(await mock.api.vault.readFile('Fern.md')).toContain('done: true'))
    expect(await mock.api.vault.readFile('Fern.md')).toContain('# Fern')
  })

  it('rejects invalid numeric input without corrupting frontmatter', async () => {
    const { mock } = mount()
    fireEvent.click(await priceCell())
    const input = screen.getByRole('textbox', { name: 'price' })
    fireEvent.change(input, { target: { value: 'not a number' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByRole('alert')).toHaveTextContent('valid number')
    fireEvent.blur(input)
    expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
    expect(await mock.api.vault.readFile('Fern.md')).toContain('price: 12')
  })

  it('undoes a property edit without overwriting a later note change', async () => {
    const { mock } = mount()
    fireEvent.click(await priceCell())
    const input = screen.getByRole('textbox', { name: 'price' })
    fireEvent.change(input, { target: { value: '18' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mock.undoActions).toHaveLength(1))
    await act(async () => {
      expect(await mock.undoActions[0].undo()).toMatchObject({ ok: true })
    })
    expect(await mock.api.vault.readFile('Fern.md')).toContain('price: 12')
    await act(async () => {
      expect(await mock.undoActions[0].redo!()).toMatchObject({ ok: true })
    })
    const current = await mock.api.vault.readFileBaseline('Fern.md')
    await mock.api.vault.writeFileGuarded('Fern.md', current!.content + 'Later change', current!.baseline)
    expect(await mock.undoActions[0].undo()).toMatchObject({ ok: false })
  })

  it('renders sanitized HTML and shows NaN for an undefined division', async () => {
    const { container } = mount(
      `formulas:\n  rich: 'html("<b>Bold</b><img src=x onerror=alert(1)><script>alert(1)</script>")'\n  invalid: 0 / 0\nviews:\n  - type: table\n    name: Table\n    order: [formula.rich, formula.invalid]\n`,
    )
    await waitFor(() => expect(container.querySelector('b')?.textContent).toBe('Bold'))
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('.base-value-html img')?.hasAttribute('onerror')).toBe(false)
    expect(screen.getAllByText('NaN')).not.toHaveLength(0)
  })

  it('saves a completed pointer resize and discards a cancelled one', async () => {
    const { mock } = mount()
    const resize = await screen.findByRole('separator', { name: 'Resize column name' })
    const start = Number(resize.getAttribute('aria-valuenow'))
    fireEvent.pointerDown(resize, { button: 0, pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(resize, { pointerId: 1, clientX: 140 })
    fireEvent.pointerUp(resize, { pointerId: 1, clientX: 140 })
    await act(async () => {
      await baseStore('Test.base').flush()
    })
    expect(parse(await mock.api.vault.readFile('Test.base')).views[0].columnSize['file.name']).toBe(start + 40)
    const saved = await screen.findByRole('separator', { name: 'Resize column name' })
    fireEvent.pointerDown(saved, { button: 0, pointerId: 2, clientX: 100 })
    fireEvent.pointerMove(saved, { pointerId: 2, clientX: 180 })
    fireEvent.pointerCancel(saved, { pointerId: 2 })
    await waitFor(() => expect(saved.getAttribute('aria-valuenow')).toBe(String(start + 40)))
    expect(mock.undoActions).toHaveLength(1)
  })

  it('cancels a cell edit without saving and keeps arrow keys in the input', async () => {
    const { mock } = mount()
    fireEvent.click(await priceCell())
    const input = screen.getByRole('textbox', { name: 'price' })
    fireEvent.change(input, { target: { value: '99' } })
    fireEvent.keyDown(input, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
  })

  it('persists keyboard column resizing and survives a remount', async () => {
    const { mock, unmount } = mount()
    const resize = await screen.findByRole('separator', { name: 'Resize column name' })
    const start = Number(resize.getAttribute('aria-valuenow'))
    fireEvent.keyDown(resize, { key: 'ArrowRight' })
    await act(async () => {
      await baseStore('Test.base').flush()
    })
    expect(parse(await mock.api.vault.readFile('Test.base')).views[0].columnSize['file.name']).toBe(start + 10)
    unmount()
    render(<BaseEditor relPath="Test.base" />)
    expect((await screen.findByRole('separator', { name: 'Resize column name' })).getAttribute('aria-valuenow')).toBe(String(start + 10))
  })

  it('renders summaries and filters visible rows with search', async () => {
    const { container } = mount(
      'views:\n  - type: table\n    name: Table\n    order: [file.name, price]\n    summaries:\n      price: Sum\n',
    )
    await waitFor(() => expect(container.querySelector('.base-table-footer .base-summary-content')?.textContent).toBe('Sum12'))
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), {
      target: { value: 'unknown' },
    })
    await waitFor(() => expect(screen.queryByText('Fern')).toBeNull())
    expect(screen.getByText(/^Showing/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(await screen.findByText('Fern')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveFocus()
  })
})
