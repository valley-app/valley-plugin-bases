import { describe, expect, it, vi } from 'vitest'
import { createMockValleyApi } from '@valley/plugin-testkit'
import type { MountedPluginView, PluginEditorProvider, PluginFileDraftSnapshot } from '@valley/plugin-sdk'
import { initRuntime } from '../src/runtime'
import { baseStore } from '../src/store'
import { EMPTY_BASE, createBase } from '../src/files'
import { createPropertyMutations } from '../src/propertyMutations'
import { register } from '../src/index'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useBaseController } from '../src/controller'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
const fixture = () => createMockValleyApi({ manifest: { id: 'bases' }, files: { 'Test.base': EMPTY_BASE, 'Note.md': '---\nprice: 1\n---\nKeep body\n' } })

describe('mounted Base draft admission', () => {
  const view = (mountId: string): MountedPluginView => ({ mountId, generation: 1, area: 'main', paneId: mountId, tabId: mountId, filePath: 'Test.base', pluginId: 'bases' })
  it('rejects retained native source callbacks after the exact mounted controller detaches', async () => {
    const mock = fixture()
    const session = initRuntime(mock.api)
    const hook = renderHook(() => useBaseController({ relPath: 'Test.base', mountedView: view('native') }))
    await act(async () => { await hook.result.current.store!.load(); await session.index.ready() })
    const previous = hook.result.current
    const final = previous.store!.snapshot.content
    hook.unmount()
    expect(() => previous.editSource(EMPTY_BASE.replace('Table', 'Late'))).toThrow('closed')
    await expect(previous.flushSource()).rejects.toThrow('closed')
    expect(previous.store!.snapshot.content).toBe(final)
    expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
    await previous.store!.dispose()
  })
  it.each([false, true])('reports its actual terminal draft after unregister with final dirty=%s and rejects late setters', async dirty => {
    const mock = fixture()
    const session = initRuntime(mock.api)
    const store = baseStore('Test.base', undefined, session)
    await store.load()
    let provider!: PluginEditorProvider
    Object.assign(mock.api.vault, { editors: { register: (_view: MountedPluginView, value: PluginEditorProvider) => { provider = value; return () => {} }, save: vi.fn() } })
    const mounted = view('terminal'), raw = { revision: 0, dirty: false, active: true }
    const off = store.attachEditor(mounted, () => raw, () => {})
    expect(await provider.getSnapshot()).toMatchObject({ dirty: false, readiness: 'ready' })
    if (dirty) store.edit(EMPTY_BASE.replace('Table', 'Final unreported'), true, mounted)
    raw.active = false
    off()
    const terminal = await provider.getSnapshot()
    expect(terminal).toMatchObject({ dirty, readiness: 'ready' })
    const final = store.snapshot.content
    expect(() => store.edit(EMPTY_BASE.replace('Table', 'Late'), true, mounted)).toThrow('closed')
    expect(store.snapshot.content).toBe(final)
    await store.dispose()
    expect(await provider.getSnapshot()).toEqual(terminal)
    expect(() => provider.prepare(terminal.revision, { operationId: 'late', fenceId: 'late', deadline: Date.now() + 5000, ownSave: false })).toThrow('changed or is unavailable')
    expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
  })
  it('refuses raw configuration drafts and holds programmatic edits until Main releases the lease', async () => {
    const mock = fixture()
    const session = initRuntime(mock.api)
    const store = baseStore('Test.base', undefined, session)
    await store.load()
    let provider!: PluginEditorProvider
    Object.assign(mock.api.vault, { editors: { register: (_view: MountedPluginView, value: PluginEditorProvider) => { provider = value; return () => {} }, save: vi.fn() } })
    const raw = { revision: 0, dirty: true, active: true }
    const freeze = vi.fn()
    const off = store.attachEditor(view('left'), () => raw, freeze)
    const dirty = await provider.getSnapshot()
    expect(() => provider.prepare(dirty.revision, { operationId: 'background', fenceId: 'fence', deadline: Date.now() + 5000, ownSave: false })).toThrow('changed or is unavailable')
    raw.dirty = false; raw.revision++
    const clean = await provider.getSnapshot()
    const lease = await provider.prepare(clean.revision, { operationId: 'background', fenceId: 'fence', deadline: Date.now() + 5000, ownSave: false })
    expect(() => store.edit(EMPTY_BASE.replace('Table', 'Blocked'), true, view('left'))).toThrow('prepared for another operation')
    expect(store.snapshot.content).toBe(EMPTY_BASE)
    expect(await lease.validate()).toEqual(clean)
    await lease.release()
    expect(freeze).toHaveBeenLastCalledWith(false)
    off(); await store.dispose()
    expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
  })
  it('saves one original pending payload and retains independent alias refusal in the opposite copy', async () => {
    const mock = fixture()
    const session = initRuntime(mock.api)
    const store = baseStore('Test.base', undefined, session)
    await store.load()
    const providers = new Map<string, PluginEditorProvider>()
    const write = mock.api.vault.writeFileGuarded
    const save = vi.fn(async (target: MountedPluginView, content: string, expected: Parameters<typeof write>[2], revision: string) => {
      const source = providers.get(target.mountId)!
      const own = await source.prepare(revision, { operationId: 'save', fenceId: 'own', deadline: Date.now() + 5000, ownSave: true })
      const other = providers.get('right')!
      const observed = await other.getSnapshot()
      expect(observed).toMatchObject({ dirty: false, readiness: 'ready' })
      const opposite = await other.prepare(observed.revision, { operationId: 'save', fenceId: 'own', deadline: Date.now() + 5000, ownSave: false })
      try { await own.validate(); await opposite.validate(); return await write(target.filePath, content, expected) }
      finally { await opposite.release(); await own.release() }
    })
    Object.assign(mock.api.vault, { editors: { register: (target: MountedPluginView, value: PluginEditorProvider) => { providers.set(target.mountId, value); return () => { providers.delete(target.mountId) } }, save } })
    const left = view('left'), right = view('right')
    const offLeft = store.attachEditor(left, () => ({ revision: 0, dirty: false, active: true }), () => {})
    const offRight = store.attachEditor(right, () => ({ revision: 0, dirty: false, active: true }), () => {})
    store.edit(EMPTY_BASE.replace('Table', 'Exact pending'), true, left)
    await store.flush()
    expect(save).toHaveBeenCalledOnce()
    expect(await mock.api.vault.readFile('Test.base')).toContain('Exact pending')
    expect(await providers.get('left')!.getSnapshot()).toMatchObject({ dirty: false })
    offLeft(); offRight(); await store.dispose()
  })
  it('passes beforeSave on a retry without changing the observed error, then writes the retained draft once', async () => {
    const mock = fixture()
    const session = initRuntime(mock.api)
    const store = baseStore('Test.base', undefined, session)
    await store.load()
    const write = vi.mocked(mock.api.vault.writeFileGuarded)
    write.mockResolvedValueOnce({ ok: false } as Awaited<ReturnType<typeof write>>)
    store.edit(EMPTY_BASE.replace('Table', 'Retried draft'))
    await expect(store.flush()).rejects.toThrow('draft is preserved')
    const failure = store.snapshot.error
    expect(failure).toContain('draft is preserved')
    let emits = 0
    const off = store.subscribe(() => { emits++ })
    const beforeSave = vi.fn(async () => {
      expect(emits).toBe(0)
      expect(store.snapshot.error).toBe(failure)
    })
    await store.flush(true, undefined, beforeSave)
    off()
    expect(beforeSave).toHaveBeenCalledOnce()
    expect(write).toHaveBeenCalledTimes(2)
    expect(await mock.api.vault.readFile('Test.base')).toContain('Retried draft')
    expect(store.snapshot.error).toBe('')
    await store.dispose()
  })
})

describe('durable Base recovery', () => {
  it('holds fresh API hydration until the predecessor journal physically settles', async () => {
    const fileDrafts = new Map<string, PluginFileDraftSnapshot>()
    const options = { manifest: { id: 'bases' }, files: { 'Test.base': EMPTY_BASE }, fileDrafts }
    const first = createMockValleyApi(options)
    initRuntime(first.api)
    const original = baseStore('Test.base')
    await original.load()
    const held = deferred()
    const write = first.api.vault.drafts.write
    const journal = vi.spyOn(first.api.vault.drafts, 'write').mockImplementationOnce(async (...args) => { await held.promise; return write(...args) })
    original.edit(EMPTY_BASE.replace('Table', 'Held recovery'))
    await vi.waitFor(() => expect(journal).toHaveBeenCalledOnce())
    const fresh = createMockValleyApi(options)
    const read = vi.spyOn(fresh.api.vault.drafts, 'read')
    initRuntime(fresh.api)
    const recovered = baseStore('Test.base')
    await Promise.resolve()
    expect(read).not.toHaveBeenCalled()
    expect(recovered.snapshot.loaded).toBe(false)
    held.resolve()
    await recovered.load()
    expect(recovered.snapshot.content).toContain('Held recovery')
    await recovered.dispose()
  })

  it('restores a fresh runtime before edits and clears only its saved journal revision', async () => {
    const fileDrafts = new Map<string, PluginFileDraftSnapshot>()
    const options = { manifest: { id: 'bases' }, files: { 'Test.base': EMPTY_BASE }, fileDrafts }
    const original = createMockValleyApi(options)
    initRuntime(original.api)
    const first = baseStore('Test.base')
    await first.load()
    first.edit(EMPTY_BASE.replace('Table', 'Recovered ä ö ü'))
    await first.dispose()
    expect(fileDrafts.size).toBe(1)
    expect(original.api.vault.writeFileGuarded).not.toHaveBeenCalled()
    const fresh = createMockValleyApi(options)
    initRuntime(fresh.api)
    const recovered = baseStore('Test.base')
    await recovered.load()
    expect(recovered.snapshot.content).toContain('Recovered ä ö ü')
    expect(recovered.snapshot.file?.baseline).toEqual(first.snapshot.file?.baseline)
    await recovered.flush()
    expect(await fresh.api.vault.readFile('Test.base')).toContain('Recovered ä ö ü')
    expect(fileDrafts.size).toBe(0)
    await recovered.dispose()
  })

  it('journals the newest edit through a held write before disposal completes', async () => {
    const mock = fixture()
    initRuntime(mock.api)
    const store = baseStore('Test.base')
    await store.load()
    const held = deferred()
    const write = mock.api.vault.drafts.write
    const journal = vi.spyOn(mock.api.vault.drafts, 'write').mockImplementationOnce(async (...args) => { await held.promise; return write(...args) })
    store.edit(EMPTY_BASE.replace('Table', 'First'))
    await vi.waitFor(() => expect(journal).toHaveBeenCalledOnce())
    for (let index = 0; index < 20; index++) store.edit(EMPTY_BASE.replace('Table', `Latest ${index}`))
    const ended = vi.fn()
    const closing = store.dispose().then(ended)
    await Promise.resolve()
    expect(ended).not.toHaveBeenCalled()
    held.resolve()
    await closing
    expect(journal).toHaveBeenCalledTimes(2)
    expect((await mock.api.vault.drafts.read('Test.base', 'editor'))?.draft.content).toContain('Latest 19')
    expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
  })

  it('blocks editing until recovery reads finish and fails closed on a journal read error', async () => {
    const mock = fixture()
    const held = deferred()
    vi.spyOn(mock.api.vault.drafts, 'read').mockImplementationOnce(async () => { await held.promise; throw new Error('Journal unavailable') })
    initRuntime(mock.api)
    const store = baseStore('Test.base')
    expect(() => store.edit(EMPTY_BASE.replace('Table', 'Unsafe'))).toThrow('still loading')
    held.resolve()
    await store.load()
    expect(store.snapshot.error).toContain('Journal unavailable')
    expect(() => store.edit(EMPTY_BASE.replace('Table', 'Unsafe'))).toThrow('still loading')
    expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
    await store.dispose()
  })

  it('does not overwrite another journal writer or renew its revision after conflict', async () => {
    const mock = fixture()
    initRuntime(mock.api)
    const store = baseStore('Test.base')
    await store.load()
    await mock.api.vault.drafts.write('Test.base', 'editor', { content: 'Other owner', baseline: null }, null)
    const read = vi.spyOn(mock.api.vault.drafts, 'read')
    store.edit(EMPTY_BASE.replace('Table', 'Local preserved'))
    await expect(store.flush()).rejects.toThrow('another session')
    await expect(store.flush(true)).rejects.toThrow('another session')
    expect(read).not.toHaveBeenCalled()
    expect(store.snapshot.content).toContain('Local preserved')
    expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
    await store.dispose()
  })

  it('keeps an uncertain journal write without retrying it or writing the file', async () => {
    const mock = fixture()
    initRuntime(mock.api)
    const store = baseStore('Test.base')
    await store.load()
    const write = mock.api.vault.drafts.write
    const journal = vi.spyOn(mock.api.vault.drafts, 'write').mockImplementationOnce(async (...args) => {
      await write(...args)
      throw Object.assign(new Error('Journal acknowledgement lost'), { outcomeUnknown: true, retryable: false })
    })
    store.edit(EMPTY_BASE.replace('Table', 'Uncertain preserved'))
    await expect(store.flush()).rejects.toThrow('acknowledgement lost')
    await expect(store.flush(true)).rejects.toThrow('acknowledgement lost')
    expect(journal).toHaveBeenCalledOnce()
    expect((await mock.api.vault.drafts.read('Test.base', 'editor'))?.draft.content).toContain('Uncertain preserved')
    expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
    await store.dispose()
  })

  it('restores independent inline fences from one stable journal without replacing surrounding text', async () => {
    const fileDrafts = new Map<string, PluginFileDraftSnapshot>()
    const second = EMPTY_BASE.replace('Table', 'Second')
    const fence = String.fromCharCode(96).repeat(3)
    const note = `Before\n${fence}base\n${EMPTY_BASE}${fence}\nBetween\n${fence}base\n${second}${fence}\nAfter\n`
    const options = { manifest: { id: 'bases' }, files: { 'Note.md': note }, fileDrafts }
    const mock = createMockValleyApi(options)
    initRuntime(mock.api)
    const a = baseStore('Note.md', EMPTY_BASE)
    const b = baseStore('Note.md', second)
    await Promise.all([a.load(), b.load()])
    a.edit(EMPTY_BASE.replace('Table', 'First recovered'))
    b.edit(second.replace('Second', 'Second recovered'))
    await Promise.all([a.dispose(), b.dispose()])
    const fresh = createMockValleyApi(options)
    initRuntime(fresh.api)
    const recoveredA = baseStore('Note.md', EMPTY_BASE)
    const recoveredB = baseStore('Note.md', second)
    await Promise.all([recoveredA.load(), recoveredB.load()])
    expect(recoveredA.snapshot.content).toContain('First recovered')
    expect(recoveredB.snapshot.content).toContain('Second recovered')
    await recoveredA.flush()
    expect(await fresh.api.vault.readFile('Note.md')).toBe(note.replace('Table', 'First recovered'))
    await expect(recoveredB.flush()).rejects.toThrow('draft is preserved')
    expect((await fresh.api.vault.drafts.read('Note.md', 'inline'))?.draft.content).toContain('Second recovered')
    await Promise.all([recoveredA.dispose(), recoveredB.dispose()])
  })
})

describe('captured Base document lifetimes', () => {
  it('rejects stale configuration callbacks after an external reload while retaining repeated local edits', async () => {
    const mock = fixture()
    initRuntime(mock.api)
    const hook = renderHook(() => useBaseController({ relPath: 'Test.base' }))
    await waitFor(() => expect(hook.result.current.snapshot?.loaded).toBe(true))
    const savedPatch = hook.result.current.patch
    act(() => savedPatch({ name: 'First' }))
    await act(async () => { await hook.result.current.store!.flush() })
    act(() => savedPatch({ name: 'Second' }))
    await act(async () => { await hook.result.current.store!.flush() })
    expect(await mock.api.vault.readFile('Test.base')).toContain('Second')
    await act(async () => {
      const current = await mock.api.vault.readFileBaseline('Test.base')
      await mock.api.vault.writeFileGuarded('Test.base', EMPTY_BASE.replace('Table', 'External'), current!.baseline)
      await hook.result.current.store!.load()
    })
    const writes = vi.mocked(mock.api.vault.writeFileGuarded).mock.calls.length
    act(() => savedPatch({ name: 'Stale popover' }))
    await act(async () => { await hook.result.current.store!.flush() })
    expect(hook.result.current.error).toContain('Reopen its configuration')
    expect(mock.api.vault.writeFileGuarded).toHaveBeenCalledTimes(writes)
    expect(await mock.api.vault.readFile('Test.base')).toContain('External')
    hook.unmount()
  })

  it('drains the accepted save on its origin and cancels the next draft write after A→B→A', async () => {
    const a = fixture()
    const session = initRuntime(a.api)
    const store = baseStore('Test.base')
    await store.load()
    const held = deferred()
    const write = vi.mocked(a.api.vault.writeFileGuarded).getMockImplementation()!
    vi.mocked(a.api.vault.writeFileGuarded).mockImplementationOnce(async (...args) => { await held.promise; return write(...args) })
    store.edit(EMPTY_BASE.replace('Table', 'First'))
    const pending = store.flush().then(() => 'saved', () => 'cancelled')
    await vi.waitFor(() => expect(a.api.vault.writeFileGuarded).toHaveBeenCalledTimes(1))
    store.edit(EMPTY_BASE.replace('Table', 'Newest'))
    const published = vi.fn()
    store.subscribe(published)
    let drained = false
    const dispose = session.dispose().then(() => { drained = true })
    const b = fixture()
    initRuntime(b.api)
    initRuntime(a.api)
    const recovered = baseStore('Test.base')
    expect(recovered).not.toBe(store)
    await Promise.resolve()
    expect(drained).toBe(false)
    held.resolve()
    await dispose
    expect(await pending).toBe('cancelled')
    expect(a.api.vault.writeFileGuarded).toHaveBeenCalledTimes(1)
    expect(b.api.vault.writeFileGuarded).not.toHaveBeenCalled()
    expect(await a.api.vault.readFile('Test.base')).toContain('First')
    expect(store.snapshot.content).toContain('Newest')
    expect(published).not.toHaveBeenCalled()
    await recovered.load()
    expect(recovered.snapshot.content).toContain('Newest')
    expect(recovered.snapshot.file?.content).toContain('First')
    expect(recovered.snapshot.file?.baseline).toEqual((await a.api.vault.readFileBaseline('Test.base'))?.baseline)
    await recovered.flush()
    expect(await a.api.vault.readFile('Test.base')).toContain('Newest')
    expect(a.api.vault.writeFileGuarded).toHaveBeenCalledTimes(2)
    await recovered.dispose()
  })

  it('keeps recovery reachable when an unhydrated replacement is replaced again', async () => {
    const mock = fixture()
    const session = initRuntime(mock.api)
    const original = baseStore('Test.base')
    await original.load()
    const held = deferred()
    const write = vi.mocked(mock.api.vault.writeFileGuarded).getMockImplementation()!
    vi.mocked(mock.api.vault.writeFileGuarded).mockImplementationOnce(async (...args) => { await held.promise; return write(...args) })
    original.edit(EMPTY_BASE.replace('Table', 'Accepted'))
    const saving = original.flush().catch(() => {})
    await vi.waitFor(() => expect(mock.api.vault.writeFileGuarded).toHaveBeenCalledOnce())
    original.edit(EMPTY_BASE.replace('Table', 'Retained'))
    void session.dispose()
    initRuntime(mock.api)
    const intermediate = baseStore('Test.base')
    initRuntime(mock.api)
    const recovered = baseStore('Test.base')
    held.resolve()
    await saving
    await recovered.load()
    expect(intermediate.snapshot.loaded).toBe(false)
    expect(recovered.snapshot.content).toContain('Retained')
    await recovered.flush()
    expect(await mock.api.vault.readFile('Test.base')).toContain('Retained')
    await recovered.dispose()
  })

  it('does not erase a retained draft when an unhydrated replacement closes', async () => {
    const mock = fixture()
    initRuntime(mock.api)
    const original = baseStore('Test.base')
    await original.load()
    original.edit(EMPTY_BASE.replace('Table', 'Still reachable'))
    initRuntime(mock.api)
    const intermediate = baseStore('Test.base')
    const closing = intermediate.dispose()
    initRuntime(mock.api)
    const recovered = baseStore('Test.base')
    await closing
    await recovered.load()
    expect(recovered.snapshot.content).toContain('Still reachable')
    await recovered.flush()
    expect(await mock.api.vault.readFile('Test.base')).toContain('Still reachable')
    await recovered.dispose()
  })

  it('keeps recovery and baselines separate across roots when the same runtime returns A→B→A', async () => {
    const rootA = { path: '/fixture/a', name: 'a', displayName: 'a' }
    const rootB = { path: '/fixture/b', name: 'b', displayName: 'b' }
    const mock = createMockValleyApi({ manifest: { id: 'bases' }, vault: rootA, files: { 'Test.base': EMPTY_BASE } })
    const other = createMockValleyApi({ manifest: { id: 'bases' }, vault: rootB, files: { 'Test.base': EMPTY_BASE.replace('Table', 'B original') } })
    const readA = mock.api.vault.readFileBaseline
    const writeA = vi.mocked(mock.api.vault.writeFileGuarded).getMockImplementation()!
    const draftsA = { ...mock.api.vault.drafts }
    vi.spyOn(mock.api.vault.drafts, 'read').mockImplementation((...args) => mock.api.getState().vault?.path === rootA.path ? draftsA.read(...args) : other.api.vault.drafts.read(...args))
    vi.spyOn(mock.api.vault.drafts, 'write').mockImplementation((...args) => mock.api.getState().vault?.path === rootA.path ? draftsA.write(...args) : other.api.vault.drafts.write(...args))
    vi.spyOn(mock.api.vault.drafts, 'clear').mockImplementation((...args) => mock.api.getState().vault?.path === rootA.path ? draftsA.clear(...args) : other.api.vault.drafts.clear(...args))
    vi.spyOn(mock.api.vault, 'readFileBaseline').mockImplementation((...args) => mock.api.getState().vault?.path === rootA.path ? readA(...args) : other.api.vault.readFileBaseline(...args))
    vi.mocked(mock.api.vault.writeFileGuarded).mockImplementation((...args) => mock.api.getState().vault?.path === rootA.path ? writeA(...args) : other.api.vault.writeFileGuarded(...args))
    const origin = initRuntime(mock.api)
    const first = baseStore('Test.base')
    await first.load()
    first.edit(EMPTY_BASE.replace('Table', 'A draft'))
    mock.emitState({ vault: rootB })
    initRuntime(mock.api)
    const second = baseStore('Test.base')
    await second.load()
    expect(second.snapshot.content, second.snapshot.error).toContain('B original')
    second.edit(EMPTY_BASE.replace('Table', 'B draft'))
    mock.emitState({ vault: rootA })
    initRuntime(mock.api)
    const recoveredA = baseStore('Test.base')
    await recoveredA.load()
    expect(recoveredA.snapshot.content).toContain('A draft')
    await recoveredA.flush()
    expect(await mock.api.vault.readFile('Test.base')).toContain('A draft')
    expect(await other.api.vault.readFile('Test.base')).toContain('B original')
    expect(origin.isActive()).toBe(false)
    expect(() => first.edit(EMPTY_BASE.replace('Table', 'Stale'))).toThrow('session has ended')
    mock.emitState({ vault: rootB })
    initRuntime(mock.api)
    const recoveredB = baseStore('Test.base')
    await recoveredB.load()
    expect(recoveredB.snapshot.content).toContain('B draft')
    await recoveredB.flush()
    expect(await other.api.vault.readFile('Test.base')).toContain('B draft')
    expect(await mock.api.vault.readFile('Test.base')).toContain('A draft')
    await recoveredB.dispose()
  })

  it('waits for a disposed document before reopening it in the same session', async () => {
    const mock = fixture()
    initRuntime(mock.api)
    const original = baseStore('Test.base')
    await original.load()
    const held = deferred()
    const write = vi.mocked(mock.api.vault.writeFileGuarded).getMockImplementation()!
    vi.mocked(mock.api.vault.writeFileGuarded).mockImplementationOnce(async (...args) => { await held.promise; return write(...args) })
    original.edit(EMPTY_BASE.replace('Table', 'Accepted'))
    const saving = original.flush().catch(() => {})
    await vi.waitFor(() => expect(mock.api.vault.writeFileGuarded).toHaveBeenCalledOnce())
    original.edit(EMPTY_BASE.replace('Table', 'Newest'))
    const disposing = original.dispose()
    const recovered = baseStore('Test.base')
    await Promise.resolve()
    expect(recovered.snapshot.loaded).toBe(false)
    held.resolve()
    await saving
    await disposing
    await recovered.load()
    expect(recovered.snapshot.content).toContain('Newest')
    expect(recovered.snapshot.file?.content).toContain('Accepted')
    await recovered.flush()
    expect(await mock.api.vault.readFile('Test.base')).toContain('Newest')
    await recovered.dispose()
  })

  it('retains the guarded baseline and preserves a newer disk version when a recovered draft saves', async () => {
    const mock = fixture()
    initRuntime(mock.api)
    const original = baseStore('Test.base')
    await original.load()
    const baseline = original.snapshot.file!.baseline
    original.edit(EMPTY_BASE.replace('Table', 'Recovered draft'))
    await original.dispose()
    const disk = await mock.api.vault.readFileBaseline('Test.base')
    await mock.api.vault.writeFileGuarded('Test.base', EMPTY_BASE.replace('Table', 'External'), disk!.baseline)
    initRuntime(mock.api)
    const recovered = baseStore('Test.base')
    await recovered.load()
    expect(recovered.snapshot.file!.baseline).toEqual(baseline)
    await expect(recovered.flush()).rejects.toThrow('draft is preserved')
    expect(recovered.snapshot.content).toContain('Recovered draft')
    expect(await mock.api.vault.readFile('Test.base')).toContain('External')
    await recovered.dispose()
  })

  it('reopens an inline draft after an accepted save changed its fence source, preserving surrounding bytes', async () => {
    const note = '# Before\r\n\r\n```base\r\n' + EMPTY_BASE.replace(/\n/g, '\r\n') + '```\r\n\r\nAfter äöü\r\n'
    const first = EMPTY_BASE.replace('Table', 'Accepted')
    const latest = EMPTY_BASE.replace('Table', 'Recovered inline')
    const mock = createMockValleyApi({ manifest: { id: 'bases' }, files: { 'Review.md': note } })
    initRuntime(mock.api)
    const original = baseStore('Review.md', EMPTY_BASE)
    await original.load()
    const held = deferred()
    const write = vi.mocked(mock.api.vault.writeFileGuarded).getMockImplementation()!
    vi.mocked(mock.api.vault.writeFileGuarded).mockImplementationOnce(async (...args) => { await held.promise; return write(...args) })
    original.edit(first)
    const saving = original.flush().catch(() => {})
    await vi.waitFor(() => expect(mock.api.vault.writeFileGuarded).toHaveBeenCalledOnce())
    original.edit(latest)
    initRuntime(mock.api)
    const recovered = baseStore('Review.md', first)
    held.resolve()
    await saving
    await recovered.load()
    expect(recovered.snapshot.content).toBe(latest)
    expect(recovered.snapshot.file?.content).toBe(first)
    await recovered.flush()
    expect(await mock.api.vault.readFile('Review.md')).toBe(note.replace('Table', 'Recovered inline'))
    await recovered.dispose()
  })

  it('joins an accepted baseline read without publishing after session disposal', async () => {
    const mock = fixture()
    const session = initRuntime(mock.api)
    const held = deferred()
    const read = mock.api.vault.readFileBaseline
    vi.spyOn(mock.api.vault, 'readFileBaseline').mockImplementationOnce(async (...args) => { const result = await read(...args); await held.promise; return result })
    const store = baseStore('Test.base')
    const published = vi.fn()
    store.subscribe(published)
    await vi.waitFor(() => expect(mock.api.vault.readFileBaseline).toHaveBeenCalledTimes(1))
    let drained = false
    const disposing = session.dispose().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)
    held.resolve()
    await disposing
    expect(store.snapshot.loaded).toBe(false)
    expect(published).not.toHaveBeenCalled()
    await store.load()
    expect(mock.api.vault.readFileBaseline).toHaveBeenCalledTimes(1)
  })

  it('rejects saved document undo callbacks after re-registration', async () => {
    const mock = fixture()
    initRuntime(mock.api)
    const store = baseStore('Test.base')
    await store.load()
    store.edit(EMPTY_BASE.replace('Table', 'Renamed'))
    await store.flush()
    const undo = mock.undoActions[0]
    initRuntime(mock.api)
    vi.mocked(mock.api.vault.writeFileGuarded).mockClear()
    expect(await undo.undo()).toMatchObject({ ok: false })
    expect(await undo.redo!()).toMatchObject({ ok: false })
    expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
  })

  it('remembers a vault transition even when the original root returns', async () => {
    const mock = fixture()
    const session = initRuntime(mock.api)
    mock.emitState({ vault: { path: '/fixture/b', name: 'b', displayName: 'b' } })
    mock.emitState({ vault: null })
    expect(session.isActive()).toBe(false)
    await expect(session.run(() => createBase(mock.api, undefined, session))).rejects.toThrow('session has ended')
    expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
  })
})

describe('property operation ownership', () => {
  it('does not retarget saved view callbacks to a replacement controller', async () => {
    const mock = fixture()
    const session = initRuntime(mock.api)
    const hook = renderHook(({ path }) => useBaseController({ relPath: path, source: EMPTY_BASE }), { initialProps: { path: 'Test.base' } })
    await act(async () => { await session.index.ready() })
    const previous = hook.result.current
    hook.rerender({ path: 'Other.base' })
    await expect(previous.editProperty('Note.md', 'price', 8)).rejects.toThrow('editor has closed')
    previous.openFile('Note.md')
    await previous.newNote()
    expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
    expect(mock.api.vault.writeTextDocumentGuarded).not.toHaveBeenCalled()
    expect(mock.api.workspace.openFile).not.toHaveBeenCalled()
    await act(async () => { await hook.result.current.editProperty('Note.md', 'price', 9) })
    expect(await mock.api.vault.readFile('Note.md')).toContain('price: 9')
    hook.unmount()
  })

  it('stops before writing when a property read finishes after its editor closes', async () => {
    const mock = fixture()
    const session = initRuntime(mock.api)
    const publish = vi.fn()
    const owner = createPropertyMutations(session, publish)
    const held = deferred()
    const read = mock.api.vault.readTextDocument
    vi.spyOn(mock.api.vault, 'readTextDocument').mockImplementationOnce(async (...args) => { const result = await read(...args); await held.promise; return result })
    const operation = owner.editProperty('Note.md', 'price', 2).then(() => 'saved', () => 'closed')
    let drained = false
    const disposal = owner.dispose().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)
    held.resolve()
    await disposal
    expect(await operation).toBe('closed')
    expect(mock.api.vault.writeTextDocumentGuarded).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('settles an accepted property write on its origin without publishing or registering stale undo', async () => {
    const a = fixture()
    const session = initRuntime(a.api)
    const publish = vi.fn()
    const owner = createPropertyMutations(session, publish)
    const held = deferred()
    const write = vi.mocked(a.api.vault.writeTextDocumentGuarded).getMockImplementation()!
    vi.mocked(a.api.vault.writeTextDocumentGuarded).mockImplementationOnce(async (...args) => { await held.promise; return write(...args) })
    const operation = owner.editProperty('Note.md', 'price', 3)
    await vi.waitFor(() => expect(a.api.vault.writeTextDocumentGuarded).toHaveBeenCalledTimes(1))
    let drained = false
    const disposal = session.dispose().then(() => { drained = true })
    const b = fixture()
    initRuntime(b.api)
    await Promise.resolve()
    expect(drained).toBe(false)
    held.resolve()
    await operation
    await disposal
    expect(await a.api.vault.readFile('Note.md')).toContain('price: 3')
    expect(a.undoActions).toHaveLength(0)
    expect(b.api.vault.writeTextDocumentGuarded).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('captures admitted list values and preserves property undo after the view closes', async () => {
    const mock = fixture()
    const session = initRuntime(mock.api)
    const owner = createPropertyMutations(session, vi.fn())
    const held = deferred()
    const read = mock.api.vault.readTextDocument
    vi.spyOn(mock.api.vault, 'readTextDocument').mockImplementationOnce(async (...args) => { const result = await read(...args); await held.promise; return result })
    const values = ['accepted']
    const operation = owner.editProperty('Note.md', 'tags', values)
    values.push('later mutation')
    held.resolve()
    await operation
    expect(await mock.api.vault.readFile('Note.md')).toContain('accepted')
    expect(await mock.api.vault.readFile('Note.md')).not.toContain('later mutation')
    await owner.dispose()
    const undo = mock.undoActions[0]
    expect(await undo.undo()).toMatchObject({ ok: true })
    expect(await mock.api.vault.readFile('Note.md')).not.toContain('tags:')
    expect(await undo.redo!()).toMatchObject({ ok: true })
    initRuntime(fixture().api)
    vi.mocked(mock.api.vault.writeTextDocumentGuarded).mockClear()
    expect(await undo.undo()).toMatchObject({ ok: false })
    expect(mock.api.vault.writeTextDocumentGuarded).not.toHaveBeenCalled()
  })

  it('refuses undo after a note was edited and reverted to identical text', async () => {
    const mock = fixture()
    const owner = createPropertyMutations(initRuntime(mock.api), vi.fn())
    await owner.editProperty('Note.md', 'price', 2)
    const saved = await mock.api.vault.readFile('Note.md')
    await mock.api.vault.writeFile('Note.md', saved + 'temporary typing')
    await mock.api.vault.writeFile('Note.md', saved)
    expect(await mock.undoActions[0].undo()).toMatchObject({ ok: false })
    expect(await mock.api.vault.readFile('Note.md')).toBe(saved)
    expect(mock.api.vault.writeTextDocumentGuarded).toHaveBeenCalledTimes(2)
  })

  it('edits the authenticated editor snapshot and preserves its unsaved body during undo', async () => {
    const mock = fixture()
    const owner = createPropertyMutations(initRuntime(mock.api), vi.fn())
    const original = await mock.api.vault.readFile('Note.md')
    const dirty = original + 'Unsaved editor body\n'
    const read = mock.api.vault.readTextDocument
    vi.spyOn(mock.api.vault, 'readTextDocument').mockImplementationOnce(async (...args) => ({ ...(await read(...args))!, content: dirty }))
    await owner.editProperty('Note.md', 'price', 4)
    expect(await mock.api.vault.readFile('Note.md')).toContain('Unsaved editor body')
    expect(await mock.undoActions[0].undo()).toMatchObject({ ok: true })
    expect(await mock.api.vault.readFile('Note.md')).toBe(dirty)
    expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
  })

  it('waits for an accepted undo read and prevents its late write after revocation', async () => {
    const mock = fixture()
    const session = initRuntime(mock.api)
    const owner = createPropertyMutations(session, vi.fn())
    await owner.editProperty('Note.md', 'price', 2)
    await owner.dispose()
    const held = deferred()
    const read = mock.api.vault.readTextDocument
    vi.spyOn(mock.api.vault, 'readTextDocument').mockImplementationOnce(async (...args) => { const result = await read(...args); await held.promise; return result })
    const undo = mock.undoActions[0].undo()
    let drained = false
    const disposal = session.dispose().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)
    held.resolve()
    expect(await undo).toMatchObject({ ok: false })
    await disposal
    expect(mock.api.vault.writeTextDocumentGuarded).toHaveBeenCalledTimes(1)
  })

  it('stops filename retries when note creation loses its view', async () => {
    const mock = fixture()
    const owner = createPropertyMutations(initRuntime(mock.api), vi.fn())
    const held = deferred()
    vi.mocked(mock.api.vault.writeFileGuarded).mockImplementationOnce(async () => { await held.promise; return { ok: false, reason: 'conflict', current: null } })
    const operation = owner.newNote([], 'Test.base').then(() => 'created', () => 'closed')
    await vi.waitFor(() => expect(mock.api.vault.writeFileGuarded).toHaveBeenCalledTimes(1))
    const disposal = owner.dispose()
    held.resolve()
    expect(await operation).toBe('closed')
    await disposal
    expect(mock.api.vault.writeFileGuarded).toHaveBeenCalledTimes(1)
    expect(mock.api.workspace.openFile).not.toHaveBeenCalled()
  })

  it('prepares unload only after accepted property work settles', async () => {
    const mock = fixture()
    const dispose = register(mock.api)
    const { currentSession } = await import('../src/runtime')
    const owner = createPropertyMutations(currentSession(), vi.fn())
    const held = deferred()
    const write = vi.mocked(mock.api.vault.writeTextDocumentGuarded).getMockImplementation()!
    vi.mocked(mock.api.vault.writeTextDocumentGuarded).mockImplementationOnce(async (...args) => { await held.promise; return write(...args) })
    const operation = owner.editProperty('Note.md', 'price', 4)
    await vi.waitFor(() => expect(mock.api.vault.writeTextDocumentGuarded).toHaveBeenCalledTimes(1))
    let prepared = false
    const unload = mock.runBeforeUnload().then(() => { prepared = true })
    await Promise.resolve()
    expect(prepared).toBe(false)
    held.resolve()
    await operation
    await unload
    expect(prepared).toBe(true)
    await dispose()
  })
})

describe('registered creation lifetime', () => {
  it('rejects already-revoked command callbacks before dispatch', async () => {
    const mock = fixture()
    const dispose = register(mock.api)
    const command = mock.commands.find((command) => command.id === 'create')!
    await dispose()
    const b = fixture()
    initRuntime(b.api)
    await expect(command.run({ folder: '' }, {} as never)).rejects.toThrow('session has ended')
    expect(mock.api.vault.writeFileGuarded).not.toHaveBeenCalled()
    expect(b.api.vault.writeFileGuarded).not.toHaveBeenCalled()
  })

  it('stops base filename retries and drains the accepted request before disposal resolves', async () => {
    const mock = fixture()
    const session = initRuntime(mock.api)
    const held = deferred()
    vi.mocked(mock.api.vault.writeFileGuarded).mockImplementationOnce(async () => { await held.promise; return { ok: false, reason: 'conflict', current: null } })
    const operation = session.run(() => createBase(mock.api, undefined, session)).then(() => 'created', () => 'revoked')
    await vi.waitFor(() => expect(mock.api.vault.writeFileGuarded).toHaveBeenCalledTimes(1))
    let drained = false
    const disposal = session.dispose().then(() => { drained = true })
    await Promise.resolve()
    expect(drained).toBe(false)
    held.resolve()
    expect(await operation).toBe('revoked')
    await disposal
    expect(mock.api.vault.writeFileGuarded).toHaveBeenCalledTimes(1)
    expect(mock.api.workspace.openFile).not.toHaveBeenCalled()
  })
})
