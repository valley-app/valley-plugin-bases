import { isMap, isSeq, parseDocument, type YAMLMap } from 'yaml'

export interface BaseSortRule { [key: string]: unknown; property: string; direction?: string }
export interface BaseViewConfiguration {
  name?: string
  type?: string
  rowHeight?: string
  order?: string[]
  sort?: BaseSortRule[]
  groupBy?: BaseSortRule
  limit?: number
  columnSize?: Record<string, number>
  cardSize?: number | string
  image?: string
  imageAspectRatio?: number | string
  imageFit?: string
  markers?: string
  separator?: string
  indentProperties?: boolean
  summaries?: Record<string, string>
  filters?: unknown
}

const origin = Symbol('base.configuration.origin')
export type BaseEditableView = BaseViewConfiguration & {
  [origin]?: { raw: Record<string, unknown>; index: number; baseline: BaseViewConfiguration; node?: YAMLMap; document: ReturnType<typeof parseDocument> }
}
export interface BaseConfiguration {
  views: BaseEditableView[]
  originalViews: unknown[]
  filters?: unknown
  formulas: Record<string, unknown>
  summaries: Record<string, string>
  properties: Record<string, unknown>
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
const stringMap = (value: unknown): Record<string, string> => record(value)
  ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : {}
const rule = (value: unknown): BaseSortRule | undefined => record(value) && typeof value.property === 'string'
  ? { ...value, property: value.property, direction: typeof value.direction === 'string' ? value.direction : undefined } : undefined

function viewConfiguration(value: Record<string, unknown>, index: number, document: ReturnType<typeof parseDocument>, node?: YAMLMap): BaseEditableView {
  const config: BaseViewConfiguration = { filters: value.filters }
  for (const key of ['name', 'type', 'rowHeight', 'image', 'imageFit', 'markers', 'separator'] as const) {
    if (typeof value[key] === 'string') config[key] = value[key]
  }
  for (const key of ['cardSize', 'imageAspectRatio'] as const) {
    if (typeof value[key] === 'string' || (typeof value[key] === 'number' && Number.isFinite(value[key]))) config[key] = value[key]
  }
  if (typeof value.limit === 'number' && Number.isFinite(value.limit)) config.limit = value.limit
  if (typeof value.indentProperties === 'boolean') config.indentProperties = value.indentProperties
  if (Array.isArray(value.order)) config.order = value.order.filter((entry): entry is string => typeof entry === 'string')
  if (Array.isArray(value.sort)) config.sort = value.sort.map(rule).filter((entry): entry is BaseSortRule => Boolean(entry))
  config.groupBy = rule(value.groupBy)
  if (record(value.columnSize)) config.columnSize = Object.fromEntries(Object.entries(value.columnSize).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])))
  if (record(value.summaries)) config.summaries = stringMap(value.summaries)
  return { ...config, [origin]: { raw: value, index, baseline: config, node, document } }
}

export function parseBaseConfiguration(content: string): BaseConfiguration {
  let raw: unknown
  let document = parseDocument('')
  try {
    document = parseDocument(content)
    if (document.errors.length) throw document.errors[0]
    raw = document.toJS({ maxAliasCount: 100 })
  } catch { raw = {} }
  const value = record(raw) ? raw : {}
  const originalViews = Array.isArray(value.views) ? value.views : []
  return {
    originalViews,
    views: originalViews.flatMap((view, index) => {
      const views = document.get('views')
      const node = isSeq(views) ? views.items[index] : undefined
      return record(view) ? [viewConfiguration(view, index, document, isMap(node) ? node : undefined)] : []
    }),
    filters: value.filters,
    formulas: record(value.formulas) ? value.formulas : {},
    summaries: stringMap(value.summaries),
    properties: record(value.properties) ? value.properties : {}
  }
}

export function viewSourceIndex(view: BaseEditableView | undefined, fallback: number): number {
  return view?.[origin]?.index ?? fallback
}

export function serializeBaseViews(views: BaseEditableView[], original: unknown[]): unknown[] {
  const pending = views.map((view) => {
    const saved = view[origin]
    const result = { ...saved?.raw }
    const node = saved?.node?.clone()
    for (const [key, value] of Object.entries(view)) {
      if (saved && value === saved.baseline[key as keyof BaseViewConfiguration]) continue
      if (value === undefined) { delete result[key]; node?.delete(key) }
      else { result[key] = value; node?.set(key, saved!.document.createNode(value)) }
    }
    return node ?? result
  })
  return [...original.flatMap((view) => record(view) ? pending.length ? [pending.shift()] : [] : [view]), ...pending]
}

export function filterGroup(value: unknown): { kind: string; items: unknown[] } {
  if (typeof value === 'string') return { kind: 'and', items: [value] }
  if (Array.isArray(value)) return { kind: 'and', items: value }
  const kind = record(value) ? Object.keys(value)[0] ?? 'and' : 'and'
  const children = record(value) ? value[kind] : undefined
  return { kind, items: Array.isArray(children) ? children : children === undefined ? [] : [children] }
}
