import { isMap, parse, parseDocument, stringify } from 'yaml'
import type { BaseSession } from './runtime'
import { newNoteDefaults } from './files'

export function createPropertyMutations(session: BaseSession, publish: (path: string, frontmatter: Record<string, unknown>) => void) {
  const api = session.api
  let active = true
  const pending = new Set<Promise<unknown>>()
  const assertActive = (): void => {
    session.assertActive()
    if (!active) throw new Error('The base editor has closed.')
  }
  const accept = <T>(run: () => Promise<T>): Promise<T> => {
    const operation = session.run(run)
    pending.add(operation)
    void operation.finally(() => pending.delete(operation)).catch(() => {})
    return operation
  }
  const update = (path: string, frontmatter: Record<string, unknown>): void => {
    if (active && session.isActive()) publish(path, frontmatter)
  }
  const dispose = async (): Promise<void> => {
    active = false
    await Promise.allSettled([...pending])
  }
  return {
    dispose,
    newNote(filters: unknown[], relPath: string, columns: string[] = [], beforeEffect?: (path: string) => Promise<void>, expectedPath?: string): Promise<void> {
      const accepted = structuredClone(filters)
      return accept(async () => {
        assertActive()
        const defaults = newNoteDefaults(accepted, relPath)
        const properties: Record<string, unknown> = {}
        for (const column of columns) if (!column.includes('.') && !Object.hasOwn(properties, column)) properties[column] = null
        Object.assign(properties, defaults.properties)
        const output = Object.keys(properties).length ? `---\n${stringify(properties, { nullStr: '' })}---\n` : ''
        for (let n = 0; n < 1000; n++) {
          assertActive()
          const path = `${defaults.folder ? `${defaults.folder}/` : ''}Untitled${n ? ` ${n}` : ''}.md`
          if (expectedPath !== undefined && path !== expectedPath) continue
          await beforeEffect?.(path)
          assertActive()
          const created = await api.vault.writeFileGuarded(path, output, null)
          if (created.ok) {
            try {
              assertActive()
              await api.workspace.openFile(path, undefined, { newTab: false })
              assertActive()
            } catch (cause) {
              throw Object.assign(new Error('The note was created but opening it has no confirmed acknowledgement.'), { outcome: 'unknown', retryable: false, cause })
            }
            return
          }
          assertActive()
          if (created.reason === 'error') throw new Error('Could not create note')
          if (expectedPath !== undefined) throw Object.assign(new Error('The exact new note destination is occupied.'), { outcome: 'not-applied' })
        }
        throw Object.assign(new Error('All prospective note names are occupied.'), { outcome: 'not-applied' })
      })
    },
    editProperty(path: string, key: string, value: unknown, guard?: { expectedRevision: string; beforeEffect(): Promise<void> }): Promise<void> {
      const accepted = structuredClone(value)
      return accept(async () => {
        assertActive()
        const file = await api.vault.readTextDocument(path)
        assertActive()
        if (!file) throw new Error('The note no longer exists')
        const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(file.content)
        const metadata = parseDocument(match?.[1] ?? '{}')
        if (metadata.errors.length || !isMap(metadata.contents)) throw new Error('Invalid properties YAML')
        metadata.set(key.replace(/^note\./, ''), accepted)
        const next = `---\n${metadata.toString({ flowCollectionPadding: false, lineWidth: 0 })}---\n${file.content.slice(match?.[0].length ?? 0)}`
        await guard?.beforeEffect()
        assertActive()
        const result = await api.vault.writeTextDocumentGuarded(path, next, guard?.expectedRevision ?? file.revisionToken)
        if (!result.ok) throw Object.assign(new Error(result.reason === 'error' ? 'The note save has no confirmed acknowledgement.' : 'The note changed. Your edit was not applied.'), { outcome: result.reason === 'error' ? 'unknown' : 'not-applied', retryable: false })
        let expectedRevision = result.revisionToken
        const replay = async (expected: string, content: string) => {
          if (!session.isActive()) return { ok: false, message: 'The base session has ended.' }
          const current = await api.vault.readTextDocument(path)
          if (!session.isActive()) return { ok: false, message: 'The base session has ended.' }
          if (!current || current.content !== expected || !expectedRevision) return { ok: false, message: 'The note changed after this edit.' }
          const written = await api.vault.writeTextDocumentGuarded(path, content, expectedRevision)
          if (!written.ok) return { ok: false, message: 'The note changed or could not be saved.' }
          expectedRevision = written.revisionToken
          const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)
          update(path, parse(frontmatter?.[1] ?? '{}'))
          return { ok: true }
        }
        const undo = (expected: string, content: string) => session.isActive()
          ? accept(() => replay(expected, content))
          : Promise.resolve({ ok: false, message: 'The base session has ended.' })
        if (session.isActive()) api.undo.push({ label: `Edit ${key}`, undo: () => undo(next, file.content), redo: () => undo(file.content, next) })
        update(path, metadata.toJSON())
      })
    }
  }
}
