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
    newNote(filters: unknown[], relPath: string, columns: string[] = []): Promise<void> {
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
          const created = await api.vault.writeFileGuarded(path, output, null)
          if (created.ok) {
            if (active && session.isActive()) await api.workspace.openFile(path, undefined, { newTab: false })
            return
          }
          assertActive()
          if (created.reason === 'error') throw new Error('Could not create note')
        }
      })
    },
    editProperty(path: string, key: string, value: unknown): Promise<void> {
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
        const next = `---\n${metadata.toString()}---\n${file.content.slice(match?.[0].length ?? 0)}`
        const result = await api.vault.writeTextDocumentGuarded(path, next, file.revisionToken)
        if (!result.ok) throw new Error('The note changed or could not be saved. Your edit was not applied.')
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
