import type { PluginBackendApi, PluginBackendOperationContext } from '@valley/plugin-sdk'
import { isMap, parseDocument } from 'yaml'
import { changeBase, EMPTY_BASE } from '../files'

/** Hosts the map view may load styles, glyphs, sprites and tiles from. */
export const MAP_HOSTS = ['tiles.openfreemap.org']

interface MapResource { bodyBase64: string; contentType: string }

const CACHE_BYTES = 48 * 1024 * 1024

export function register(api: PluginBackendApi): () => void {
  const path = (input: unknown): string => {
    if (typeof input !== 'string' || input.length > 4096 || !input.endsWith('.base') || input.startsWith('/') || input.includes('\\') || input.includes('\0') || input.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Expected a vault-relative .base file')
    return input
  }
  const content = (input: unknown): string => {
    if (typeof input !== 'string' || input.length > 750000) throw new Error('Base content exceeds its limit')
    const parsed = parseDocument(input)
    if (parsed.errors.length || !isMap(parsed.contents)) throw new Error('Invalid base YAML')
    parsed.toJS({ maxAliasCount: 100 })
    return input
  }
  const operations = [
    api.rpc.handleOperation('base.read', async (raw, context) => {
      const file = path((raw as { path?: unknown })?.path)
      const result = await context.api.vault.read(file)
      if (!result) throw new Error('Base file is unavailable')
      return { path: file, ...result }
    }),
    ...['create', 'write', 'patch'].flatMap(method => {
      const update = async (raw: unknown, context: PluginBackendOperationContext, receipt: boolean) => {
        const input = raw as { path: unknown; content?: unknown; view?: number | null; patch?: Record<string, unknown>; expected?: Parameters<PluginBackendApi['vault']['write']>[2] }
        const file = path(input?.path)
        const current = method === 'create' ? null : await context.api.vault.read(file)
        let next: string
        if (method === 'patch') {
          if (!current) throw new Error('Base file is unavailable')
          if (!input.patch || typeof input.patch !== 'object' || Array.isArray(input.patch)) throw new Error('Base patch must be an object')
          next = content(changeBase(current.content, input.view ?? null, input.patch))
        } else next = content(method === 'create' && input.content === undefined ? EMPTY_BASE : input.content)
        if (method !== 'create' && input.expected === undefined) throw new Error('A reviewed file baseline is required')
        context.cancellation.throwIfAborted()
        const result = await context.api.vault.write(file, next, method === 'create' ? null : input.expected!)
        if (!receipt) return result.ok ? { ok: true, data: { path: file, baseline: result.baseline } } : { ok: false, code: 'REVISION_CONFLICT', error: 'Base file changed or could not be saved', outcome: 'not-applied', data: result }
        if (!result.ok) throw Object.assign(new Error('Base file changed or could not be saved'), { code: 'REVISION_CONFLICT', outcome: 'not-applied' })
        return { value: { path: file, baseline: result.baseline }, ...(current ? { undo: { snapshot: { path: file, content: current.content }, expectedRevision: result.baseline, affectedEntities: [file] } } : {}) }
      }
      return [api.rpc.handleOperation(`base.${method}`, (raw, context) => update(raw, context, false)),
        ...(method === 'create' ? [] : [api.rpc.handleOperation(`command.base.${method}`, (raw, context) => update((raw as { input: unknown }).input, context, true))])]
    }),
    api.rpc.handleOperation('command.base.revision', async (raw, context) => {
      const current = await context.api.vault.read(path((raw as { input: { path: unknown } }).input.path))
      return current?.baseline ?? null
    }),
    api.rpc.handleOperation('command.base.undo', async (raw, context) => {
      const input = raw as { snapshot: { path: unknown; content: unknown }; execution: { expectedRevision: Parameters<PluginBackendApi['vault']['write']>[2] } }
      const file = path(input.snapshot.path)
      context.cancellation.throwIfAborted()
      const result = await context.api.vault.write(file, content(input.snapshot.content), input.execution.expectedRevision)
      if (!result.ok) throw Object.assign(new Error('Base changed after the original operation'), { code: 'UNDO_CONFLICT_STALE_TARGET', outcome: 'not-applied' })
      return { path: file, baseline: result.baseline }
    })
  ]
  const cache = new Map<string, MapResource>()
  const pending = new Map<string, Promise<MapResource>>()
  let cachedBytes = 0
  const remember = (url: string, resource: MapResource): void => {
    cache.set(url, resource)
    cachedBytes += resource.bodyBase64.length
    for (const [key, value] of cache) {
      if (cachedBytes <= CACHE_BYTES) break
      cache.delete(key)
      cachedBytes -= value.bodyBase64.length
    }
  }
  const load = async (url: string): Promise<MapResource> => {
    const response = await api.network.fetch({ url, method: 'GET', timeoutMs: 20_000 })
    if (response.status < 200 || response.status >= 300) throw new Error(`Map resource request failed (${response.status})`)
    const resource = { bodyBase64: response.bodyBase64, contentType: response.headers['content-type'] ?? response.headers['Content-Type'] ?? '' }
    remember(url, resource)
    return resource
  }
  const off = api.rpc.handle('mapResource', async (payload) => {
    const url = typeof (payload as { url?: unknown })?.url === 'string' ? (payload as { url: string }).url : ''
    let parsed: URL
    try { parsed = new URL(url) } catch { throw new Error('Invalid map resource URL') }
    if (parsed.protocol !== 'https:' || !MAP_HOSTS.includes(parsed.hostname)) throw new Error('Map resource host is not allowed')
    const key = parsed.toString()
    const hit = cache.get(key)
    if (hit) { cache.delete(key); cache.set(key, hit); return hit }
    let request = pending.get(key)
    if (!request) {
      request = load(key).finally(() => pending.delete(key))
      pending.set(key, request)
    }
    return request
  })
  return () => { off(); operations.forEach(dispose => dispose()); cache.clear(); pending.clear() }
}
