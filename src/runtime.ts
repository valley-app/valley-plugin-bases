import type { PluginFileDraft, ValleyPluginApi } from '@valley/plugin-sdk'
import type { TextFileWithBaseline } from '@valley/plugin-sdk/types'
import { createBaseIndex, type BaseIndex } from './indexOwner'
export let React: typeof import('react')
export let api: ValleyPluginApi

export interface BaseDraft {
  path: string
  inlineSource?: string
  file: TextFileWithBaseline | null
  content: string
  error: string
  revision: number
  diskContent: string
}
export interface BaseSession {
  readonly root: string | undefined
  readonly index: BaseIndex
  readonly recovery: Map<string, BaseDraft>
  readonly documentDrains: Map<string, Promise<void>>
  api: ValleyPluginApi
  isActive(): boolean
  assertActive(): void
  run<T>(operation: () => Promise<T>): Promise<T>
  settle(): Promise<void>
  onDispose(dispose: () => void | Promise<void>): () => void
  dispose(): Promise<void>
}

export class BaseSessionEndedError extends Error {
  constructor() { super('The base session has ended. Your draft is preserved.') }
}

let session: BaseSession
const sessions = new WeakMap<ValleyPluginApi, BaseSession>()

export function currentSession(): BaseSession { return session }

export function initRuntime(value: ValleyPluginApi): BaseSession {
  const previous = session
  void previous?.dispose().catch(() => {})
  api = value
  React = value.React
  const vault = value.getState().vault?.path
  const retained = value.runtime.getOrCreate('bases.recovery', () => new Map<string | undefined, Map<string, BaseDraft>>())
  let recovery = retained.get(vault)
  if (!recovery) { recovery = new Map(); retained.set(vault, recovery) }
  const pendingDocuments = value.runtime.getOrCreate('bases.document-drains', () => new Map<string | undefined, Map<string, Promise<void>>>())
  let documentDrains = pendingDocuments.get(vault)
  if (!documentDrains) { documentDrains = new Map(); pendingDocuments.set(vault, documentDrains) }
  const predecessor = (previous?.root === vault ? previous : sessions.get(value))?.dispose()
  let waiting = Boolean(predecessor)
  void predecessor?.then(() => { waiting = false }).catch(() => {})
  let active = true
  let draining: Promise<void> | undefined
  const disposers = new Set<() => void | Promise<void>>()
  const operations = new Set<Promise<unknown>>()
  let offVault = (): void => {}
  let index: BaseIndex | undefined
  const captured: BaseSession = {
    api: value, root: vault, recovery, documentDrains,
    get index() { captured.assertActive(); return index ??= createBaseIndex(captured) },
    isActive: () => {
      if (active) {
        try { if (value.getState().vault?.path !== vault) void captured.dispose() }
        catch { void captured.dispose() }
      }
      return active
    },
    assertActive: () => { if (!captured.isActive()) throw new BaseSessionEndedError() },
    run: (operation) => {
      try {
        captured.assertActive()
        const pending = waiting
          ? predecessor!.then(() => { captured.assertActive(); return operation() })
          : operation()
        operations.add(pending)
        void pending.finally(() => operations.delete(pending)).catch(() => {})
        return pending
      } catch (error) { return Promise.reject(error) }
    },
    settle: async () => {
      while (operations.size) {
        const settled = await Promise.allSettled([...operations])
        const failed = settled.find((result) => result.status === 'rejected')
        if (failed?.status === 'rejected') throw failed.reason
      }
    },
    onDispose: (dispose) => {
      if (active) disposers.add(dispose)
      else void dispose()
      return () => { disposers.delete(dispose) }
    },
    dispose: () => {
      if (draining) return draining
      active = false
      offVault()
      const pending = [...disposers].map((dispose) => { try { return Promise.resolve(dispose()) } catch { return Promise.resolve() } })
      disposers.clear()
      draining = Promise.allSettled([predecessor, ...pending, ...operations]).then(async () => { await index?.dispose() })
      void draining.catch(() => {})
      return draining
    }
  }
  offVault = value.subscribeState(['vault'], () => { captured.isActive() })
  sessions.set(value, captured)
  session = captured
  return captured
}
export const text = (key: string, params?: Record<string, string | number>): string => api.ui.t(`bases.${key}`, params)

interface BaseRecoveryJournal {
  load(): Promise<void>
  checkpoint(accepted?: boolean): Promise<void>
  settle(): Promise<void>
}
const journals = new WeakMap<BaseSession, Map<string, BaseRecoveryJournal>>()
export function baseRecoveryJournal(path: string, inline: boolean, owner: BaseSession): BaseRecoveryJournal {
  let owned = journals.get(owner)
  if (!owned) { owned = new Map(); journals.set(owner, owned) }
  const key = inline ? 'inline' : 'editor'
  const identity = `${path}\0${key}`
  const existing = owned.get(identity)
  if (existing) return existing
  const roots = owner.api.runtime.getOrCreate('bases.journal-revisions', () => new Map<string | undefined, Map<string, string | null>>())
  const root = owner.api.getState().vault?.path
  let observed = roots.get(root)
  if (!observed) { observed = new Map(); roots.set(root, observed) }
  const revisions = observed
  let receipt: string | null = null
  let loading: Promise<void> | undefined
  let loaded = false
  let pending: Promise<void> = Promise.resolve()
  let writing: Promise<void> | undefined
  let requested = 0
  let failure: unknown
  const entries = (): [string, BaseDraft][] => [...owner.recovery].filter(([, draft]) => draft.path === path && (draft.inlineSource !== undefined) === inline)
  const journal: BaseRecoveryJournal = {
    load: () => {
      if (loading) return loading
      return loading = owner.run(async () => {
        const saved = await owner.api.vault.drafts.read(path, key)
        owner.assertActive()
        receipt = saved?.revisionToken ?? null
        if (revisions.has(identity) && revisions.get(identity) !== receipt) throw new Error('The base recovery journal changed elsewhere. Your local draft is preserved.')
        if (saved) {
          if (saved.draft.state !== 'bases.recovery.v1') throw new Error('The base recovery journal could not be read.')
          const records: unknown = JSON.parse(saved.draft.content)
          if (!Array.isArray(records)) throw new Error('The base recovery journal could not be read.')
          for (const record of records) {
            if (!Array.isArray(record) || record.length !== 2 || typeof record[0] !== 'string') throw new Error('The base recovery journal could not be read.')
            const draft = record[1] as BaseDraft
            if (!draft || draft.path !== path || (draft.inlineSource !== undefined) !== inline || typeof draft.content !== 'string' || typeof draft.diskContent !== 'string' || typeof draft.error !== 'string' || typeof draft.revision !== 'number' || (draft.file !== null && (!draft.file || typeof draft.file.content !== 'string'))) throw new Error('The base recovery journal could not be read.')
            const local = owner.recovery.get(record[0])
            if (local && !revisions.has(identity) && JSON.stringify(local) !== JSON.stringify(draft)) throw new Error('The base recovery journal conflicts with the retained local draft.')
            if (!local) owner.recovery.set(record[0], draft)
          }
        }
        revisions.set(identity, receipt)
        loaded = true
      }).catch(reason => { failure = reason; throw reason })
    },
    checkpoint: (accepted = false) => {
      requested++
      if (writing) return writing
      const ready = journal.load()
      let finished = false
      const perform = async (): Promise<void> => {
        try {
          if (!loaded) await ready
          if (failure) throw failure
          let completed = -1
          while (completed !== requested) {
            const version = requested
            const records = entries()
            if (owner.api.getState().vault?.path !== root) throw new BaseSessionEndedError()
            if (!records.length) {
              if (receipt) await owner.api.vault.drafts.clear(path, key, receipt)
              receipt = null
            } else {
              const draft: PluginFileDraft = { content: JSON.stringify(records), baseline: records[0][1].file?.baseline ?? null, state: 'bases.recovery.v1' }
              const saved = await owner.api.vault.drafts.write(path, key, draft, receipt)
              receipt = saved.revisionToken
            }
            revisions.set(identity, receipt)
            completed = version
          }
        } catch (reason) { failure = reason; throw reason }
        finally { finished = true; writing = undefined }
      }
      const operation = accepted ? perform() : owner.run(perform)
      pending = operation.catch(reason => { failure = reason; throw reason })
      if (!finished) writing = pending
      void pending.catch(() => {})
      return pending
    },
    settle: () => pending
  }
  owned.set(identity, journal)
  return journal
}
