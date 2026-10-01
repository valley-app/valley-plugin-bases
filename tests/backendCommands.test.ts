import { assertCommandOutput } from './commandContracts'
import { describe, expect, it, vi } from 'vitest'
import type { PluginBackendApi, PluginBackendOperationContext } from '@valley/plugin-sdk'
import { register } from '../src/backend'

describe('Base backend command writes', () => {
  it('preserves YAML fields and refuses a stale baseline without replacing content', async () => {
    const operations = new Map<string, (input: unknown, context: PluginBackendOperationContext) => Promise<unknown>>()
    let content = 'description: preserved\nviews:\n  - type: table\n    name: Before\n'
    let baseline = { mtimeMs: 1, size: content.length, hash: 'one' }
    const vault = { read: vi.fn(async () => ({ content, baseline })), write: vi.fn(async (_path, next, expected) => {
      if (expected?.hash !== baseline.hash) return { ok: false, reason: 'conflict' }
      content = next; baseline = { mtimeMs: 2, size: content.length, hash: 'two' }; return { ok: true, baseline }
    }) }
    const api = { vault, rpc: { handle: () => () => {}, handleOperation: (id: string, handler: (input: unknown, context: PluginBackendOperationContext) => Promise<unknown>) => { operations.set(id, async (input, context) => assertCommandOutput(id, input, await handler(input, context))); return () => operations.delete(id) } } } as unknown as PluginBackendApi
    const dispose = register(api), context = { id: 'test-operation', api, cancellation: new AbortController().signal } as PluginBackendOperationContext
    const original = { ...baseline }
    expect(await operations.get('base.patch')!({ path: 'Forest.base', view: 0, patch: { name: 'After' }, expected: original }, context)).toMatchObject({ ok: true })
    expect(content).toContain('description: preserved')
    expect(content).toContain('name: After')
    expect(await operations.get('base.write')!({ path: 'Forest.base', content: 'views: []\n', expected: original }, context)).toMatchObject({ ok: false, code: 'REVISION_CONFLICT', outcome: 'not-applied' })
    expect(content).toContain('name: After')
    await expect(operations.get('base.write')!({ path: '../Forest.base', content: 'views: []', expected: baseline }, context)).rejects.toThrow('vault-relative')
    expect(vault.write).toHaveBeenCalledTimes(2)
    dispose()
  })
  it('returns a serializable receipt and applies its inverse with the committed baseline', async () => {
    const operations = new Map<string, (input: unknown, context: PluginBackendOperationContext) => Promise<unknown>>()
    let content = 'views: []\n', revision = 1
    const baseline = () => ({ mtimeMs: revision, size: content.length, hash: String(revision) })
    const vault = { read: async () => ({ content, baseline: baseline() }), write: vi.fn(async (_path, next, expected) => {
      if (expected?.hash !== baseline().hash) return { ok: false, reason: 'conflict' }
      content = next; revision++; return { ok: true, baseline: baseline() }
    }) }
    const api = { vault, rpc: { handle: () => () => {}, handleOperation: (id: string, handler: (input: unknown, context: PluginBackendOperationContext) => Promise<unknown>) => { operations.set(id, async (input, context) => assertCommandOutput(id, input, await handler(input, context))); return () => operations.delete(id) } } } as unknown as PluginBackendApi
    const dispose = register(api), context = { id: 'admitted', api, cancellation: new AbortController().signal } as PluginBackendOperationContext
    const result = await operations.get('command.base.write')!({ input: { path: 'Forest.base', content: 'description: New\nviews: []\n', expected: baseline() }, execution: { id: 'execution' } }, context) as { value: unknown; undo: { snapshot: unknown; expectedRevision: unknown; affectedEntities: string[] } }
    expect(result.undo).toMatchObject({ snapshot: { path: 'Forest.base', content: 'views: []\n' }, affectedEntities: ['Forest.base'] })
    const inverse = { snapshot: result.undo.snapshot, execution: { expectedRevision: result.undo.expectedRevision } }
    await operations.get('command.base.undo')!(inverse, context)
    expect(content).toBe('views: []\n')
    await expect(operations.get('command.base.undo')!(inverse, context)).rejects.toThrow('changed after')
    dispose()
  })

  it('validates each admitted file operation against its published output schema', async () => {
    const operations = new Map<string, (input: unknown, context: PluginBackendOperationContext) => Promise<unknown>>()
    const files = new Map<string, { content: string; baseline: { mtimeMs: number; size: number; hash: string } }>()
    let revision = 0
    const vault = {
      read: async (path: string) => files.get(path) ?? null,
      write: async (path: string, content: string, expected: { hash: string } | null) => {
        const current = files.get(path)
        if ((current?.baseline.hash ?? null) !== (expected?.hash ?? null)) return { ok: false, reason: 'conflict' }
        const baseline = { mtimeMs: ++revision, size: content.length, hash: String(revision) }
        files.set(path, { content, baseline })
        return { ok: true, baseline }
      }
    }
    const api = { vault, rpc: { handle: () => () => {}, handleOperation: (method: string, handler: (input: unknown, context: PluginBackendOperationContext) => Promise<unknown>) => {
      operations.set(method, async (input, context) => assertCommandOutput(method, input, await handler(input, context)))
      return () => operations.delete(method)
    } } } as unknown as PluginBackendApi
    const dispose = register(api), context = { id: 'file-contracts', api, cancellation: new AbortController().signal } as PluginBackendOperationContext
    const path = 'Survey.base'
    expect(await operations.get('base.create')!({ path }, context)).toMatchObject({ ok: true, data: { path } })
    expect(await operations.get('base.read')!({ path }, context)).toMatchObject({ path, content: expect.any(String) })
    const write = await operations.get('command.base.write')!({ input: { path, content: 'description: Survey\nviews: []\n', expected: files.get(path)!.baseline } }, context)
    expect(write).toMatchObject({ value: { path }, undo: { affectedEntities: [path] } })
    const patch = await operations.get('command.base.patch')!({ input: { path, patch: { description: 'Revised' }, expected: files.get(path)!.baseline } }, context)
    expect(patch).toMatchObject({ value: { path }, undo: { affectedEntities: [path] } })
    expect(files.get(path)!.content).toContain('Revised')
    dispose()
  })

})
