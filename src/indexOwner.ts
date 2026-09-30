import { createIndexObserver } from '@valley/plugin-sdk'
import type { IndexEntry } from '@valley/plugin-sdk/types'
import type { BaseSession } from './runtime'

export function createBaseIndex(session: BaseSession) {
  const index = createIndexObserver(session.api, { fields: ['title', 'aliases', 'frontmatter', 'excluded', 'tags', 'links', 'linkPaths', 'embedPaths', 'size', 'ctimeMs', 'mtimeMs'] })
  let source = index.getSnapshot().entries
  let entries: IndexEntry[] = []
  let disposal: Promise<void> | undefined
  let waiting: { promise: Promise<void>; resolve(): void; reject(error: Error): void } | undefined
  const offIndex = index.subscribe(() => {
    const snapshot = index.getSnapshot()
    if (snapshot.status === 'ready') { waiting?.resolve(); waiting = undefined }
    if (snapshot.status === 'error') { waiting?.reject(new Error(snapshot.error ?? 'The base index is unavailable.')); waiting = undefined }
  })
  let offSession = (): void => {}
  const owner = {
    getSnapshot: index.getSnapshot,
    resolve(reference: string): string | null {
      if (!session.isActive() || disposal) return null
      const wanted = reference.trim().toLowerCase()
      if (!wanted) return null
      const matches = index.getSnapshot().entries.filter(entry => [entry.relPath, entry.title ?? '', entry.relPath.split('/').at(-1)!, ...(entry.aliases ?? [])]
        .some(value => value.toLowerCase() === wanted || value.replace(/\.[^./]+$/, '').toLowerCase() === wanted))
      return (matches.find(entry => /\.(?:md|markdown)$/i.test(entry.relPath)) ?? matches[0])?.relPath ?? null
    },
    subscribe: index.subscribe,
    entries(): IndexEntry[] {
      const next = index.getSnapshot().entries
      if (source !== next) { source = next; entries = next.map(entry => ({ ...entry, title: entry.title ?? '', kind: 'other', mtimeMs: entry.mtimeMs ?? 0 })) }
      return entries
    },
    ready(): Promise<void> {
      try { session.assertActive(); if (disposal) throw new Error('The base index has closed.') } catch (error) { return Promise.reject(error) }
      const snapshot = index.getSnapshot()
      if (snapshot.status === 'ready') return Promise.resolve()
      if (snapshot.status === 'error') return Promise.reject(new Error(snapshot.error ?? 'The base index is unavailable.'))
      if (!waiting) {
        let resolve!: () => void
        let reject!: (error: Error) => void
        const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
        waiting = { promise, resolve, reject }
      }
      return waiting.promise
    },
    dispose(): Promise<void> {
      if (disposal) return disposal
      offIndex(); offSession()
      waiting?.reject(new Error('The base index has closed.')); waiting = undefined
      return disposal = index.dispose()
    }
  }
  offSession = session.onDispose(() => owner.dispose())
  return owner
}

export type BaseIndex = ReturnType<typeof createBaseIndex>
