import type { TextFileWithBaseline } from '@valley/plugin-sdk/types'
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
  edit(content: string, recordUndo?: boolean): void
  flush(retry?: boolean): Promise<void>
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
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    load() {
      if (
        disposed || !session.isActive() ||
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
            if (disposed || !session.isActive()) return
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
    edit(content, recordUndo = true) {
      session.assertActive()
      if (disposed) throw new BaseDocumentClosedError()
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
            store.edit(previous, false)
            await store.flush()
            return { ok: true }
          },
          async redo() {
            if (disposed || !session.isActive()) return { ok: false, message: 'The base document has closed.' }
            if (store.snapshot.content !== previous)
              return { ok: false, message: 'The base changed after undo.' }
            store.edit(content, false)
            await store.flush()
            return { ok: true }
          },
        })
      store.snapshot.content = content
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
    async flush(retry = false) {
      clearTimeout(timer)
      await loading
      await journal.settle()
      session.assertActive()
      if (disposed) throw new BaseDocumentClosedError()
      if (!hydrated || !store.snapshot.file) throw new Error(store.snapshot.error || 'The base file could not be read.')
      if (
        store.snapshot.error &&
        !retry &&
        store.snapshot.file &&
        store.snapshot.content !== store.snapshot.file.content
      )
        throw new Error(store.snapshot.error)
      if (saving) {
        await saving
        if (store.snapshot.content !== store.snapshot.file?.content) await store.flush()
        return
      }
      saving = session.run(async () => {
        while (store.snapshot.file && store.snapshot.content !== store.snapshot.file.content) {
          session.assertActive()
          if (disposed) throw new BaseDocumentClosedError()
          await journal.checkpoint(true)
          session.assertActive()
          if (disposed) throw new BaseDocumentClosedError()
          const content = store.snapshot.content
          const output = inlineSource === undefined ? content : replaceInlineBase(diskContent, store.snapshot.file.content, content)
          const result = await api.vault.writeFileGuarded(path, output, store.snapshot.file.baseline)
          if (!result.ok)
            throw new Error('The base changed elsewhere or could not be saved. Your draft is preserved.')
          diskContent = output
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
        if (!(error instanceof BaseSessionEndedError) && !(error instanceof BaseDocumentClosedError)) store.snapshot.error = String(error)
        retain()
        emit()
        throw error
      } finally {
        saving = null
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
