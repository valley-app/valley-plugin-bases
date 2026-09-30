import type { PluginBackendApi } from '@valley/plugin-sdk'

/** Hosts the map view may load styles, glyphs, sprites and tiles from. */
export const MAP_HOSTS = ['tiles.openfreemap.org']

interface MapResource { bodyBase64: string; contentType: string }

const CACHE_BYTES = 48 * 1024 * 1024

export function register(api: PluginBackendApi): () => void {
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
  return () => { off(); cache.clear(); pending.clear() }
}
