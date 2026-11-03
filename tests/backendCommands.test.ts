import { assertCommandOutput } from './commandContracts'
import { describe, expect, it, vi } from 'vitest'
import type { PluginBackendApi, PluginBackendOperationContext } from '@valley/plugin-sdk'
import { BASE_CONTENT_LIMIT, BASE_TOKEN_LIMIT, register } from '../src/backend'
import config from '../config.json'

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

  it('refuses invalid or missing targets before any effect with a definite not-applied outcome', async () => {
    const operations = new Map<string, (input: unknown, context: PluginBackendOperationContext) => Promise<unknown>>()
    const original = 'views:\n  - type: table\n    name: Table\n'
    const files = new Map([['Forest.base', { content: original, baseline: { mtimeMs: 1, size: original.length, hash: 'one' } }]])
    const vault = {
      read: vi.fn(async (path: string) => files.get(path) ?? { content: '', baseline: null }),
      write: vi.fn(async () => ({ ok: true, baseline: { mtimeMs: 2, size: 1, hash: 'two' } }))
    }
    const api = { vault, rpc: { handle: () => () => {}, handleOperation: (method: string, handler: (input: unknown, context: PluginBackendOperationContext) => Promise<unknown>) => { operations.set(method, handler); return () => operations.delete(method) } } } as unknown as PluginBackendApi
    const dispose = register(api), context = { id: 'refusals', api, cancellation: new AbortController().signal } as PluginBackendOperationContext
    const expected = files.get('Forest.base')!.baseline
    const refused = (method: string, input: unknown, code: string, ctx = context) => expect(operations.get(method)!(input, ctx)).rejects.toMatchObject({ code, outcome: 'not-applied' })
    await refused('base.read', { path: 'Missing.base' }, 'TARGET_NOT_FOUND')
    await refused('base.read', { path: '../Forest.base' }, 'INVALID_INPUT')
    await refused('command.base.patch', { input: { path: 'Missing.base', patch: { name: 'X' }, expected } }, 'TARGET_NOT_FOUND')
    await refused('command.base.write', { input: { path: 'Missing.base', content: original, expected } }, 'TARGET_NOT_FOUND')
    await refused('command.base.patch', { input: { path: '/Forest.base', patch: { name: 'X' }, expected } }, 'INVALID_INPUT')
    await refused('command.base.patch', { input: { path: 'Forest.base', patch: ['name'], expected } }, 'INVALID_INPUT')
    await refused('command.base.patch', { input: { path: 'Forest.base', view: 4, patch: { name: 'X' }, expected } }, 'TARGET_NOT_FOUND')
    await refused('command.base.patch', { input: { path: 'Forest.base', patch: { name: 'X' } } }, 'REVISION_REQUIRED')
    await refused('command.base.write', { input: { path: 'Forest.base', content: 'views: [', expected } }, 'INVALID_INPUT')
    await refused('command.base.write', { input: { path: 'Forest.base', content: 'x'.repeat(BASE_CONTENT_LIMIT + 1), expected } }, 'RESOURCE_LIMIT')
    const crowded = `views:\n  - type: table\n    name: Dense\n    order: [${Array.from({ length: BASE_TOKEN_LIMIT / 2 }, () => 'a').join(', ')}]\n`
    expect(crowded.length).toBeLessThan(BASE_CONTENT_LIMIT)
    await refused('command.base.write', { input: { path: 'Forest.base', content: crowded, expected } }, 'RESOURCE_LIMIT')
    await refused('command.base.patch', { input: { path: 'Forest.base', patch: { order: Array.from({ length: BASE_CONTENT_LIMIT / 4 }, () => 'file.name') }, expected } }, 'RESOURCE_LIMIT')
    files.set('Crowded.base', { content: crowded, baseline: { mtimeMs: 1, size: crowded.length, hash: 'crowded' } })
    await refused('command.base.patch', { input: { path: 'Crowded.base', patch: { name: 'X' }, expected: files.get('Crowded.base')!.baseline } }, 'RESOURCE_LIMIT')
    await refused('command.base.write', { input: { path: 'Forest.base', content: original } }, 'REVISION_REQUIRED')
    await refused('base.create', { path: 'New.base', content: '- not a map\n' }, 'INVALID_INPUT')
    const aborted = new AbortController(); aborted.abort()
    await refused('command.base.write', { input: { path: 'Forest.base', content: original, expected } }, 'CANCELLED', { ...context, cancellation: aborted.signal })
    await refused('command.base.undo', { snapshot: { path: 'Forest.base', content: 7 }, execution: { expectedRevision: expected } }, 'INVALID_INPUT')
    expect(vault.write).not.toHaveBeenCalled()
    dispose()
  })

  it('declares the command content limit the backend can parse inside one guest turn', () => {
    const limits = JSON.stringify(config).match(/"maxLength":\s*(131072|750000)\b/g) ?? []
    expect(limits.length).toBeGreaterThan(0)
    expect(limits.every(limit => limit.endsWith(String(BASE_CONTENT_LIMIT)))).toBe(true)
  })

  it('restores the exact original bytes on undo even when they were not valid Base YAML', async () => {
    const operations = new Map<string, (input: unknown, context: PluginBackendOperationContext) => Promise<unknown>>()
    let content = 'views: [\n\t broken', revision = 1
    const baseline = () => ({ mtimeMs: revision, size: content.length, hash: String(revision) })
    const vault = { read: async () => ({ content, baseline: baseline() }), write: vi.fn(async (_path: string, next: string, expected: { hash: string }) => {
      if (expected?.hash !== baseline().hash) return { ok: false, reason: 'conflict' }
      content = next; revision++; return { ok: true, baseline: baseline() }
    }) }
    const api = { vault, rpc: { handle: () => () => {}, handleOperation: (method: string, handler: (input: unknown, context: PluginBackendOperationContext) => Promise<unknown>) => { operations.set(method, handler); return () => operations.delete(method) } } } as unknown as PluginBackendApi
    const dispose = register(api), context = { id: 'restore', api, cancellation: new AbortController().signal } as PluginBackendOperationContext
    const result = await operations.get('command.base.write')!({ input: { path: 'Forest.base', content: 'views: []\n', expected: baseline() } }, context) as { undo: { snapshot: unknown; expectedRevision: unknown } }
    expect(content).toBe('views: []\n')
    await operations.get('command.base.undo')!({ snapshot: result.undo.snapshot, execution: { expectedRevision: result.undo.expectedRevision } }, context)
    expect(content).toBe('views: [\n\t broken')
    dispose()
  })
})
