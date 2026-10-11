import type { TextFileWithBaseline } from '@valley/plugin-sdk/types'
import type { MountedPluginView, PluginEditorSnapshot } from '@valley/plugin-sdk'
import { baseRecoveryJournal, BaseSessionEndedError, currentSession, type BaseSession } from './runtime'
import { replaceInlineBase } from './files'
export interface BaseStore {
  snapshot: {
    file: TextFileWithBaseline | null
    content: string
    error: string
    loaded: boolean
    revision: number
  }
  subscribe(listener: () => void): () => void
  load(): Promise<void>
  edit(content: string, recordUndo?: boolean, view?: MountedPluginView): void
  isFrozen(): boolean
  notifyEditor(): void
  attachEditor(view: MountedPluginView, local: () => { revision: number; dirty: boolean; active: boolean }, freeze: (value: boolean) => void): () => void
  flush(retry?: boolean, view?: MountedPluginView, beforeSave?: () => Promise<void>): Promise<void>
  dispose(): Promise<void>
}
const documents = new WeakMap<BaseSession, Map<string, BaseStore>>()
class BaseDocumentClosedError extends Error {
  constructor() { super('The base document has closed.') }
}
export function stores(session = currentSession()): Map<string, BaseStore> {
  let stores = documents.get(session)
  if (!stores) { stores = new Map(); documents.set(session, stores) }
  return stores
}
export function baseStore(path: string, inlineSource?: string, session = currentSession()): BaseStore {
  session.assertActive()
  const api = session.api
  const owned = stores(session)
  const key = inlineSource === undefined ? path : path + '\0' + inlineSource
  let recoveryKey = key
  let diskContent = ''
  let edited = false
  let hydrated = false
  const existing = owned.get(key)
  if (existing) return existing
  const journal = baseRecoveryJournal(path, inlineSource !== undefined, session)
  const predecessor = session.documentDrains.get(path)
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let saving: Promise<void> | null = null
  let loading: Promise<void> | null = null
  let loadRevision = 0
  let disposed = false
  let draining: Promise<void> | undefined
  let offSession = (): void => {}
  let offFiles = (): void => {}
  let draftRevision = 0
  let pendingView: MountedPluginView | undefined
  let uncertain = false
  const editorLeases = new Set<symbol>()
  const editors = new Map<string, { view: MountedPluginView; snapshot(): PluginEditorSnapshot; active(): boolean; freeze(value: boolean): void }>()
  const retain = (): void => {
    if (!hydrated && !edited) return
    if (edited || (store.snapshot.file && (store.snapshot.content !== store.snapshot.file.content || store.snapshot.error))) {
      session.recovery.set(recoveryKey, { path, inlineSource, file: store.snapshot.file, content: store.snapshot.content, error: store.snapshot.error, revision: store.snapshot.revision, diskContent })
    } else session.recovery.delete(recoveryKey)
  }
  const hydrate = (): void => {
    if (hydrated) return
    hydrated = true
    let draft = session.recovery.get(recoveryKey)
    if (!draft && inlineSource !== undefined) {
      const normalized = (content: string): string => content.replace(/\r\n/g, '\n').trimEnd()
      const matches = [...session.recovery].filter(([, draft]) => draft.path === path && draft.inlineSource !== undefined
        && draft.file && normalized(draft.file.content) === normalized(inlineSource))
      if (matches.length === 1) [recoveryKey, draft] = matches[0]
    }
    if (!draft) return
    diskContent = draft.diskContent
    uncertain = Boolean(draft.error)
    edited = true
    store.snapshot = { file: draft.file, content: draft.content, error: draft.error, revision: draft.revision, loaded: Boolean(draft.file) }
  }
  const emit = (): void => {
    if (disposed || !session.isActive()) return
    store.snapshot = { ...store.snapshot }
    listeners.forEach((listener) => listener())
  }
  const store: BaseStore = {
    snapshot: { file: null, content: '', error: '', loaded: false, revision: 0 },
    isFrozen: () => editorLeases.size > 0,
    notifyEditor: emit,
    attachEditor(view, local, freeze) {
      const same = (candidate: MountedPluginView | undefined): boolean => candidate?.mountId === view.mountId && candidate.generation === view.generation
      const snapshot = (): PluginEditorSnapshot => {
        const current = local()
        return {
          revision: `base-draft:${view.mountId}:${view.generation}:${draftRevision}:${current.revision}`,
          dirty: current.dirty || (same(pendingView) || !pendingView) && (edited || store.snapshot.file !== null && store.snapshot.content !== store.snapshot.file.content),
          readiness: store.snapshot.error ? 'uncertain' : !hydrated || !store.snapshot.loaded || !store.snapshot.file || loading ? 'loading' : same(pendingView) && saving ? 'saving' : 'ready'
        }
      }
      const editor = { view, snapshot, active: () => local().active, freeze }
      editors.set(view.mountId, editor)
      const off = api.vault.editors.register(view, {
        getSnapshot: snapshot,
        subscribe: store.subscribe,
        prepare(expectedRevision, request) {
          const assert = (): PluginEditorSnapshot => {
            const current = snapshot()
            if (editors.get(view.mountId) !== editor || !local().active || current.revision !== expectedRevision || Date.now() >= request.deadline || current.readiness === 'loading' || current.readiness === 'uncertain' || !request.ownSave && (current.dirty || current.readiness !== 'ready') || request.ownSave && !same(pendingView)) throw new Error('The exact Base draft changed or is unavailable.')
            return current
          }
          assert()
          const token = Symbol()
          editorLeases.add(token)
          for (const entry of editors.values()) entry.freeze(true)
          let released = false
          return {
            validate: () => { if (released) throw new Error('The Base draft lease was released.'); return assert() },
            release: () => {
              if (released) return
              released = true
              editorLeases.delete(token)
              if (!store.isFrozen()) { for (const entry of editors.values()) entry.freeze(false); void store.load() }
            }
          }
        }
      })
      return () => { if (editors.get(view.mountId) === editor) editors.delete(view.mountId); off() }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    load() {
      if (
        disposed || store.isFrozen() || !session.isActive() ||
        saving ||
        (store.snapshot.file && store.snapshot.content !== store.snapshot.file.content)
      )
        return Promise.resolve()
      loadRevision++
      if (loading) return loading
      const pending = session.run(async () => {
        if (predecessor) await predecessor
        if (disposed || !session.isActive()) return
        try { if (!hydrated) await journal.load() }
        catch (error) {
          if (!disposed && session.isActive()) { store.snapshot.error = String(error); emit() }
          return
        }
        if (disposed || !session.isActive()) return
        hydrate()
        if (store.snapshot.file && edited) { emit(); return }
        while (!disposed) {
          const revision = loadRevision
          const originalFile = store.snapshot.file
          try {
            let file = await api.vault.readFileBaseline(path)
            if (disposed || !session.isActive() || store.isFrozen()) return
            if (revision !== loadRevision) continue
            if (store.snapshot.file !== originalFile) return
            if (saving || (store.snapshot.file && store.snapshot.content !== store.snapshot.file.content)) return
            if (file && inlineSource !== undefined) {
              const code = store.snapshot.file?.content ?? inlineSource
              replaceInlineBase(file.content, code, code)
              diskContent = file.content
              file = { ...file, content: code }
            }
            store.snapshot = {
              revision: store.snapshot.revision + (file?.content !== store.snapshot.file?.content ? 1 : 0),
              file,
              content: edited ? store.snapshot.content : file?.content ?? '',
              loaded: true,
              error: file ? '' : 'The base file could not be read.',
            }
            retain()
          } catch (error) {
            if (disposed || !session.isActive()) return
            if (revision !== loadRevision) continue
            if (saving || store.snapshot.file !== originalFile || (store.snapshot.file && store.snapshot.content !== store.snapshot.file.content)) return
            store.snapshot.error = String(error)
            store.snapshot.loaded = true
          }
          emit()
          if (revision === loadRevision) return
        }
      }).finally(() => { if (loading === pending) loading = null })
      loading = pending
      return pending
    },
    edit(content, recordUndo = true, view) {
      session.assertActive()
      if (disposed) throw new BaseDocumentClosedError()
      if (view) { const editor = editors.get(view.mountId); if (!editor || editor.view.generation !== view.generation || !editor.active()) throw new BaseDocumentClosedError() }
      if (store.isFrozen()) throw new Error('The Base draft is prepared for another operation.')
      if (!hydrated || !store.snapshot.file) throw new Error('The base recovery journal is still loading.')
      const previous = store.snapshot.content
      if (previous === content) return
      if (recordUndo)
        api.undo.push({
          label: 'Edit base view',
          async undo() {
            if (disposed || !session.isActive()) return { ok: false, message: 'The base document has closed.' }
            if (store.snapshot.content !== content)
              return {
                ok: false,
                message: 'The base changed after this edit.',
              }
            store.edit(previous, false, view)
            await store.flush(false, view)
            return { ok: true }
          },
          async redo() {
            if (disposed || !session.isActive()) return { ok: false, message: 'The base document has closed.' }
            if (store.snapshot.content !== previous)
              return { ok: false, message: 'The base changed after undo.' }
            store.edit(content, false, view)
            await store.flush(false, view)
            return { ok: true }
          },
        })
      store.snapshot.content = content
      pendingView = view
      draftRevision++
      edited = true
      retain()
      emit()
      void journal.checkpoint().catch(error => {
        store.snapshot.error = String(error)
        retain()
        emit()
      })
      clearTimeout(timer)
      timer = setTimeout(() => {
        void store.flush().catch(() => {})
      }, 300)
    },
    dispose() {
      if (draining) return draining
      disposed = true
      retain()
      offSession()
      offFiles()
      clearTimeout(timer)
      listeners.clear()
      if (owned.get(key) === store) owned.delete(key)
      draining = Promise.allSettled([session.documentDrains.get(path), loading, saving, journal.settle()]).then(() => {})
      session.documentDrains.set(path, draining)
      void draining.then(() => { if (session.documentDrains.get(path) === draining) session.documentDrains.delete(path) })
      return draining
    },
    async flush(retry = false, requestedView, beforeSave) {
      clearTimeout(timer)
      await loading
      await journal.settle()
      session.assertActive()
      if (disposed) throw new BaseDocumentClosedError()
      if (!hydrated || !store.snapshot.file) throw new Error(store.snapshot.error || 'The base file could not be read.')
      if (uncertain) throw new Error(store.snapshot.error || 'The Base save outcome is uncertain.')
      if (
        store.snapshot.error &&
        !retry &&
        store.snapshot.file &&
        store.snapshot.content !== store.snapshot.file.content
      )
        throw new Error(store.snapshot.error)
      if (saving) {
        await saving
        if (store.snapshot.content !== store.snapshot.file?.content) await store.flush(retry, requestedView, beforeSave)
        return
      }
      saving = session.run(async () => {
        while (store.snapshot.file && store.snapshot.content !== store.snapshot.file.content) {
          session.assertActive()
          if (disposed) throw new BaseDocumentClosedError()
          if (store.isFrozen()) throw new Error('The Base draft is prepared for another operation.')
          const view = requestedView ?? pendingView ?? (editors.size === 1 ? editors.values().next().value?.view : undefined)
          pendingView = view
          const editor = view ? editors.get(view.mountId) : undefined
          const expectedDraftRevision = editor?.snapshot().revision
          const content = store.snapshot.content
          const expected = store.snapshot.file.baseline
          const output = inlineSource === undefined ? content : replaceInlineBase(diskContent, store.snapshot.file.content, content)
          await journal.checkpoint(true)
          session.assertActive()
          if (disposed) throw new BaseDocumentClosedError()
          if (view && (!editor || editors.get(view.mountId) !== editor || !expectedDraftRevision)) throw new Error('The exact Base save owner is unavailable.')
          await beforeSave?.()
          if (store.snapshot.content !== content || store.snapshot.file?.baseline !== expected || view && (editors.get(view.mountId) !== editor || editor?.snapshot().revision !== expectedDraftRevision)) throw Object.assign(new Error('The exact Base draft changed before its save.'), { outcome: 'not-applied' })
          // A retry clears its error only now: emitting earlier changes the observed state that beforeSave just validated.
          if (retry) store.snapshot.error = ''
          const result = view ? await api.vault.editors.save(view, output, expected, expectedDraftRevision!) : await api.vault.writeFileGuarded(path, output, expected)
          if (!result.ok)
            throw new Error('The base changed elsewhere or could not be saved. Your draft is preserved.')
          diskContent = output
          uncertain = false
          store.snapshot.file = { content, baseline: result.baseline }
          store.snapshot.error = ''
          edited = store.snapshot.content !== content
          retain()
          emit()
          await journal.checkpoint(true)
        }
      })
      try {
        await saving
      } catch (error) {
        uncertain = Boolean((error as { outcome?: string; outcomeUnknown?: boolean } | null)?.outcome === 'unknown' || (error as { outcomeUnknown?: boolean } | null)?.outcomeUnknown)
        if (!(error instanceof BaseSessionEndedError) && !(error instanceof BaseDocumentClosedError)) store.snapshot.error = String(error)
        retain()
        emit()
        throw error
      } finally {
        saving = null
        emit()
      }
    },
  }
  owned.set(key, store)
  offSession = session.onDispose(() => store.dispose())
  offFiles = api.vault.onChanged((info) => {
    if (info.full || info.changes.some((change) => change.relPath === path || path.startsWith(`${change.relPath}/`))) void store.load()
  })
  void store.load().catch(() => {})
  return store
}
