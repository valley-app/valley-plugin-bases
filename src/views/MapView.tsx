import type { GeoJSONSource, Map as MapLibre, MapLayerMouseEvent, Popup } from 'maplibre-gl'
import { React, api, text } from '../runtime'
import { cellText, normalizePropertyId, rawCellText } from '../engine/document'
import type { BaseCell, BaseColumn, BaseEvaluatedView, BaseRow } from '../engine/types'
import type { CellActions } from '../cells'
import { Icon } from '../icons'
import { GLYPHS } from '../glyphs'
import { openMenuAt } from '../menuKit'

const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/bright'
const DARK_STYLE = 'https://tiles.openfreemap.org/styles/dark'
const DEFAULT_ZOOM = 4
const DEFAULT_HEIGHT = 400

function parseCoordinate(value: unknown): number | null {
  if (typeof value === 'number') return Number.isNaN(value) ? null : value
  if (typeof value === 'string') { const n = parseFloat(value); return Number.isNaN(n) ? null : n }
  return null
}
const valid = (lat: number | null, lng: number | null): lat is number => lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180

/** `[lat, lng]` lists and `"lat, lng"` strings, range-checked. */
export function coordinatesOf(raw: unknown, cell: BaseCell | undefined): [number, number] | null {
  let lat: number | null = null
  let lng: number | null = null
  const source = raw !== undefined ? raw : cell && typeof cell === 'object' && cell.__baseValue === 'list' ? cell.items : cell
  if (Array.isArray(source)) {
    if (source.length >= 2) { lat = parseCoordinate(source[0]); lng = parseCoordinate(source[1]) }
  } else if (typeof source === 'string') {
    const parts = source.trim().split(',')
    if (parts.length >= 2) { lat = parseCoordinate(parts[0].trim()); lng = parseCoordinate(parts[1].trim()) }
  }
  return valid(lat, lng) ? [lat, lng!] : null
}

function parseCenter(value: unknown): [number, number] | null {
  if (Array.isArray(value)) return coordinatesOf(value, undefined)
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/^\[|\]$/g, '')
  return coordinatesOf(trimmed, undefined)
}

const PROTOCOL = 'bases-map'
let protocolRegistered = false

/** The plugin frame has no network access; map resources go through the backend. */
function registerNetworkProtocol(library: typeof import('maplibre-gl')): void {
  if (protocolRegistered) return
  protocolRegistered = true
  library.addProtocol(PROTOCOL, async ({ url, type }) => {
    const target = decodeURIComponent(new URL(url).pathname.slice(1))
    const result = await api.backend.call<{ bodyBase64: string }>('mapResource', { url: target })
    const bytes = Uint8Array.from(atob(result.bodyBase64), (character) => character.charCodeAt(0))
    if (type === 'json') return { data: JSON.parse(new TextDecoder().decode(bytes)) }
    if (type === 'string') return { data: new TextDecoder().decode(bytes) }
    return { data: bytes.buffer }
  })
}

const DEFAULT_COLOR = 'var(--accent-color)'
const ICON_COLOR = '#ffffff'
const LAYER = 'marker-pins'
const MAX_POPUP_PROPERTIES = 20

function glyph(name: string): string | null {
  const value = GLYPHS[name.trim().replace(/^lucide-/, '')]
  if (!value) return null
  return value.startsWith('<') ? value : GLYPHS[value] ?? null
}

/** Resolved against the host element's document, which carries the theme tokens. */
function resolveColor(color: string, host: HTMLElement): string {
  const probe = host.ownerDocument.createElement('span')
  probe.style.display = 'none'
  probe.style.color = color
  host.append(probe)
  const resolved = host.ownerDocument.defaultView!.getComputedStyle(probe).color
  probe.remove()
  return resolved
}

function drawGlyph(context: CanvasRenderingContext2D, markup: string, x: number, y: number, size: number): void {
  const svg = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`, 'image/svg+xml').documentElement
  context.save()
  context.translate(x, y)
  context.scale(size / 24, size / 24)
  context.strokeStyle = ICON_COLOR
  context.fillStyle = ICON_COLOR
  context.lineWidth = 2
  context.lineCap = 'round'
  context.lineJoin = 'round'
  for (const element of Array.from(svg.children)) {
    const n = (name: string): number => parseFloat(element.getAttribute(name) ?? '') || 0
    const path = new Path2D()
    switch (element.tagName) {
      case 'path': path.addPath(new Path2D(element.getAttribute('d') ?? '')); break
      case 'circle': path.arc(n('cx'), n('cy'), n('r'), 0, Math.PI * 2); break
      case 'ellipse': path.ellipse(n('cx'), n('cy'), n('rx'), n('ry'), 0, 0, Math.PI * 2); break
      case 'rect': path.roundRect(n('x'), n('y'), n('width'), n('height'), n('rx') || n('ry')); break
      case 'line': path.moveTo(n('x1'), n('y1')); path.lineTo(n('x2'), n('y2')); break
      case 'polyline':
      case 'polygon': {
        const points = (element.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number)
        for (let index = 0; index + 1 < points.length; index += 2) {
          if (index) path.lineTo(points[index], points[index + 1])
          else path.moveTo(points[index], points[index + 1])
        }
        if (element.tagName === 'polygon') path.closePath()
        break
      }
    }
    const fill = element.getAttribute('fill')
    if (fill && fill !== 'none') context.fill(path)
    context.stroke(path)
  }
  context.restore()
}

/** A 4x circle with a white glyph (or dot), drawn once per icon and colour. */
function markerImage(icon: string | null, color: string): ImageData {
  const scale = 4
  const size = 48 * scale
  const radius = 12 * scale
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')!
  context.fillStyle = color
  context.beginPath()
  context.arc(size / 2, size / 2, radius, 0, Math.PI * 2)
  context.fill()
  context.strokeStyle = 'rgba(255, 255, 255, 0.3)'
  context.lineWidth = scale
  context.stroke()
  if (icon) {
    const markup = glyph(icon)
    const iconSize = radius * 1.2
    if (markup) drawGlyph(context, markup, size / 2 - iconSize / 2, size / 2 - iconSize / 2, iconSize)
  } else {
    context.fillStyle = ICON_COLOR
    context.beginPath()
    context.arc(size / 2, size / 2, 4 * scale, 0, Math.PI * 2)
    context.fill()
  }
  return context.getImageData(0, 0, size, size)
}

const imageKey = (icon: string | null, color: string): string => `marker-${icon || 'dot'}-${color.replace(/[^a-zA-Z0-9]/g, '')}`

function truthy(cell: BaseCell | undefined): boolean {
  if (cell === null || cell === undefined || cell === '' || cell === 0 || cell === false) return false
  if (typeof cell !== 'object') return true
  if (cell.__baseValue === 'list') return cell.items.some(truthy)
  if (cell.__baseValue === 'number') return Number(cell.value) !== 0
  return true
}

interface Point { row: BaseRow; coordinates: [number, number]; icon: string | null; color: string }

function isDark(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView ?? window
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(view.getComputedStyle(node).backgroundColor)
    if (!match || (match[4] !== undefined && Number(match[4]) === 0)) continue
    const [r, g, b] = match.slice(1, 4).map(Number)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128
  }
  return view.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

function popupContent(point: Point, columns: BaseColumn[], hidden: Set<string>, actions: CellActions): HTMLElement | null {
  const shown = columns.filter((column) => !hidden.has(column.key)).slice(0, MAX_POPUP_PROPERTIES).filter((column) => truthy(point.row.cells[column.key]))
  if (!shown.length) return null
  const valueText = (column: BaseColumn): string => {
    const value = column.kind === 'note' ? rawCellText(point.row.widgets[column.key] ?? 'text', point.row.raw[column.key]) : cellText(point.row.cells[column.key])
    return Array.isArray(value) ? value.join(', ') : String(value ?? '')
  }
  const container = document.createElement('div')
  container.className = 'base-map-popup-body'
  const title = document.createElement('div')
  title.className = 'base-map-popup-title'
  const link = document.createElement('a')
  link.href = point.row.id
  link.textContent = valueText(shown[0])
  link.addEventListener('click', (event) => { event.preventDefault(); actions.openFile(point.row.id, event as unknown as React.MouseEvent) })
  title.append(link)
  container.append(title)
  if (shown.length > 1) {
    const list = document.createElement('div')
    list.className = 'base-map-popup-properties'
    for (const column of shown.slice(1)) {
      const property = document.createElement('div')
      property.className = 'base-map-popup-property'
      const label = document.createElement('div')
      label.className = 'base-map-popup-property-label'
      label.textContent = column.label
      const value = document.createElement('div')
      value.className = 'base-map-popup-property-value'
      value.textContent = valueText(column)
      property.append(label, value)
      list.append(property)
    }
    container.append(list)
  }
  return container
}

export function MapView({ view, rows, actions, embedded }: { view: BaseEvaluatedView; rows: BaseRow[]; actions: CellActions; embedded: boolean }) {
  const container = React.useRef<HTMLDivElement>(null)
  const mapRef = React.useRef<MapLibre | null>(null)
  const [palette, setPalette] = React.useState('')
  const dark = palette.startsWith('dark')
  const [loaded, setLoaded] = React.useState(false)
  const [library, setLibrary] = React.useState<typeof import('maplibre-gl') | null>(null)
  const option = (key: string): unknown => view.options[key]
  const coordinateKey = typeof option('coordinates') === 'string' && option('coordinates') ? normalizePropertyId(option('coordinates') as string) : null
  const iconKey = typeof option('markerIcon') === 'string' && option('markerIcon') ? normalizePropertyId(option('markerIcon') as string) : null
  const colorKey = typeof option('markerColor') === 'string' && option('markerColor') ? normalizePropertyId(option('markerColor') as string) : null
  const num = (key: string, fallback: number, min: number, max: number): number => {
    const value = Number(option(key))
    return Number.isFinite(value) && option(key) !== undefined && option(key) !== '' ? Math.min(max, Math.max(min, value)) : fallback
  }
  const minZoom = num('minZoom', 0, 0, 24)
  const maxZoom = num('maxZoom', 18, 0, 24)
  const configuredZoom = option('defaultZoom') !== undefined && option('defaultZoom') !== '' && Number.isFinite(Number(option('defaultZoom')))
  const defaultZoom = num('defaultZoom', DEFAULT_ZOOM, minZoom, maxZoom)
  const center = parseCenter(option('center'))
  const height = num('mapHeight', DEFAULT_HEIGHT, 200, 800)

  const points = React.useMemo<Point[]>(() => {
    if (!coordinateKey) return []
    const textOf = (row: BaseRow, key: string | null): string | null => {
      if (!key || !truthy(row.cells[key])) return null
      const value = cellText(row.cells[key]).trim()
      return value && value !== 'null' && value !== 'undefined' ? value : null
    }
    return rows.flatMap((row) => {
      const coordinates = coordinatesOf(row.raw[coordinateKey], row.cells[coordinateKey])
      if (!coordinates) return []
      const icon = textOf(row, iconKey)
      return [{ row, coordinates, icon, color: textOf(row, colorKey) || DEFAULT_COLOR }]
    })
  }, [rows, coordinateKey, iconKey, colorKey])

  const fitted = React.useRef<string | null>(null)
  const live = React.useRef({ points, columns: view.columns, hidden: new Set<string>(), actions })
  live.current = { points, columns: view.columns, hidden: new Set([coordinateKey, iconKey, colorKey].filter((key): key is string => Boolean(key))), actions }

  React.useEffect(() => {
    let active = true
    void import('maplibre-gl').then((module) => {
      registerNetworkProtocol(module)
      if (active) setLibrary(module)
    })
    return () => { active = false }
  }, [])

  React.useEffect(() => {
    const element = container.current
    if (!element) return
    const owner = element.ownerDocument
    const read = (): void => setPalette(`${isDark(element) ? 'dark' : 'light'} ${resolveColor(DEFAULT_COLOR, element)}`)
    read()
    const observer = new MutationObserver(read)
    observer.observe(owner.documentElement, { attributes: true })
    observer.observe(owner.head, { childList: true, subtree: true, characterData: true })
    const media = owner.defaultView?.matchMedia?.('(prefers-color-scheme: dark)')
    media?.addEventListener('change', read)
    return () => { observer.disconnect(); media?.removeEventListener('change', read) }
  }, [])

  React.useEffect(() => {
    const element = container.current
    if (!element || !library || !palette) return
    const map = new library.Map({
      container: element,
      style: `${PROTOCOL}://fetch/${encodeURIComponent(dark ? DARK_STYLE : LIGHT_STYLE)}`,
      center: center ? [center[1], center[0]] : [0, 0],
      zoom: defaultZoom,
      minZoom,
      maxZoom,
      attributionControl: { compact: false },
      transformRequest: (url) => ({ url: /^https:/i.test(url) ? `${PROTOCOL}://fetch/${encodeURIComponent(url)}` : url }),
    })
    mapRef.current = map
    let popup: Popup | null = null
    let hideTimer: number | undefined
    const pointOf = (event: MapLayerMouseEvent): Point | null => {
      const index: unknown = event.features?.[0]?.properties?.entryIndex
      return typeof index === 'number' ? live.current.points[index] ?? null : null
    }
    const hide = (): void => {
      window.clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => popup?.remove(), 150)
    }
    map.on('mouseenter', LAYER, (event) => {
      map.getCanvas().style.cursor = 'pointer'
      const point = pointOf(event)
      if (!point) return
      const content = popupContent(point, live.current.columns, live.current.hidden, live.current.actions)
      if (!content) return
      window.clearTimeout(hideTimer)
      if (!popup) {
        popup = new library.Popup({ closeButton: false, closeOnClick: false, focusAfterOpen: false, offset: 25, className: 'base-map-popup' })
        popup.on('open', () => {
          const node = popup?.getElement()
          node?.addEventListener('mouseenter', () => window.clearTimeout(hideTimer))
          node?.addEventListener('mouseleave', hide)
        })
      }
      popup.setDOMContent(content).setLngLat([point.coordinates[1], point.coordinates[0]]).addTo(map)
    })
    map.on('mouseleave', LAYER, () => { map.getCanvas().style.cursor = ''; hide() })
    map.on('click', LAYER, (event) => {
      const point = pointOf(event)
      if (point) live.current.actions.openFile(point.row.id, event.originalEvent as unknown as React.MouseEvent)
    })
    map.on('contextmenu', LAYER, (event) => {
      event.preventDefault()
      const point = pointOf(event)
      if (!point) return
      const [lat, lng] = point.coordinates
      openMenuAt([
        { id: 'open', label: text('open'), onSelect: () => live.current.actions.openFile(point.row.id) },
        { id: 'open-tab', label: text('openInNewTab'), onSelect: () => void api.workspace.openFile(point.row.id, undefined, { newTab: true }) },
        { id: 'copy-coordinates', label: text('copyCoordinates'), onSelect: () => void navigator.clipboard.writeText(`${lat}, ${lng}`) },
      ], event.originalEvent.clientX, event.originalEvent.clientY)
    })
    map.once('style.load', () => setLoaded(true))
    return () => { window.clearTimeout(hideTimer); popup?.remove(); map.remove(); mapRef.current = null; fitted.current = null; setLoaded(false) }
  }, [library, dark, Boolean(palette)])

  const fitKey = JSON.stringify([center, configuredZoom, defaultZoom])
  React.useEffect(() => {
    const map = mapRef.current
    if (!map || !library || !loaded) return
    map.setMinZoom(minZoom)
    map.setMaxZoom(maxZoom)
    const host = map.getContainer()
    const resolved = new Map<string, string>()
    const keys = points.map((point) => {
      if (!resolved.has(point.color)) resolved.set(point.color, resolveColor(point.color, host))
      const color = resolved.get(point.color)!
      const key = imageKey(point.icon, color)
      if (!map.hasImage(key)) map.addImage(key, markerImage(point.icon, color))
      return key
    })
    const data = {
      type: 'FeatureCollection' as const,
      features: points.map((point, index) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [point.coordinates[1], point.coordinates[0]] },
        properties: { entryIndex: index, icon: keys[index] },
      })),
    }
    const source = map.getSource<GeoJSONSource>('markers')
    if (source) source.setData(data)
    else {
      map.addSource('markers', { type: 'geojson', data })
      map.addLayer({
        id: LAYER,
        type: 'symbol',
        source: 'markers',
        layout: {
          'icon-image': ['get', 'icon'],
          'icon-size': ['interpolate', ['linear'], ['zoom'], 0, 0.12, 4, 0.18, 14, 0.22, 18, 0.24],
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
          'icon-padding': 0,
        },
      })
    }
    if (fitted.current === fitKey) return
    fitted.current = fitKey
    const bounds = new library.LngLatBounds()
    points.forEach((point) => bounds.extend([point.coordinates[1], point.coordinates[0]]))
    if (center) map.setCenter([center[1], center[0]])
    else if (points.length) map.setCenter(bounds.getCenter())
    if (configuredZoom) map.setZoom(defaultZoom)
    else if (points.length) map.fitBounds(bounds, { padding: 20, animate: false })
  }, [library, loaded, points, minZoom, maxZoom, fitKey, palette])

  return (
    <div className={`base-view base-map-view${dark ? ' is-dark' : ''}`} style={embedded ? { height } : undefined}>
      <div ref={container} className="base-map" />
      <div className="base-map-controls">
        <button type="button" className="base-map-control" aria-label={text('zoomIn')} onClick={() => mapRef.current?.zoomIn()}><Icon name="plus" size={16} /></button>
        <button type="button" className="base-map-control" aria-label={text('zoomOut')} onClick={() => mapRef.current?.zoomOut()}><Icon name="minus" size={16} /></button>
      </div>
    </div>
  )
}
