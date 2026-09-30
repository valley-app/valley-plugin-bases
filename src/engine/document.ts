import { parseDocument } from 'yaml'
import type { IndexEntry } from '@valley/plugin-sdk/types'
import {
  BooleanValue,
  compareForSort,
  compareGroupKeys,
  DateValue,
  DurationValue,
  ErrorValue,
  evaluateValue,
  FileValue,
  fromJS,
  HtmlValue,
  IconValue,
  ImageValue,
  LinkValue,
  ListValue,
  looseEquals,
  NULL,
  NullValue,
  NumberValue,
  ObjectValue,
  RegExpValue,
  RelativeDateValue,
  rowScope,
  shortName,
  StringValue,
  strictEquals,
  summaryFormulasFor,
  summaryScope,
  TagsValue,
  TagValue,
  testExpression,
  UrlValue,
  Value,
  type BaseFileSource,
  type BaseVault,
  type Scope,
} from './values'
import type { BaseCell, BaseColumn, BaseEvaluatedView, BaseEvaluation, BaseGroup, BaseRow, BaseSortRule, BaseSummary, PropertyKind } from './types'

/** Display names of the implicit file properties. */
export const FILE_LABELS: Record<string, string> = {
  'file.file': 'file',
  'file.name': 'name',
  'file.basename': 'file base name',
  'file.fullname': 'file full name',
  'file.path': 'path',
  'file.folder': 'folder',
  'file.ext': 'extension',
  'file.ctime': 'created time',
  'file.mtime': 'modified time',
  'file.size': 'file size',
  'file.links': 'file links',
  'file.backlinks': 'file backlinks',
  'file.embeds': 'file embeds',
  'file.tags': 'file tags',
}
export const FILE_PROPERTIES = Object.keys(FILE_LABELS)

export const WIDGET_ICONS: Record<string, string> = {
  text: 'text', number: 'binary', checkbox: 'check-square', date: 'calendar', datetime: 'clock',
  multitext: 'list', tags: 'tags', aliases: 'forward', file: 'file', folder: 'folder', unknown: 'file-question',
}

const DATETIME = /^\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d$/
const DATE = /^\d{4}-[01]\d-[0-3]\d$/

/** Type inferred from one raw frontmatter value. */
export function valueWidget(value: unknown): string {
  if (value === null || value === undefined) return 'text'
  if (typeof value === 'string') return DATETIME.test(value) ? 'datetime' : DATE.test(value) ? 'date' : 'text'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'checkbox'
  if (Array.isArray(value) && value.filter((item) => item !== null && item !== undefined).every((item) => typeof item === 'string')) return 'multitext'
  return 'unknown'
}

export const RESERVED_WIDGETS: Record<string, string> = { tags: 'tags', aliases: 'aliases', cssclasses: 'multitext' }

/** Whether `value` fits an explicitly assigned widget. */
export function widgetAccepts(widget: string, value: unknown): boolean {
  switch (widget) {
    case 'checkbox': return typeof value === 'boolean'
    case 'number': return typeof value === 'number'
    case 'date': return !value || (typeof value === 'string' && DATE.test(value))
    case 'datetime': return !value || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(value))
    case 'multitext': case 'tags': case 'aliases':
      return typeof value === 'string' || (Array.isArray(value) && value.filter((v) => v != null).every((v) => typeof v === 'string'))
    case 'text': case 'file': case 'folder': return typeof value === 'string'
  }
  return false
}

/** The widget one cell renders with: an assigned type when the value fits it,
 *  the property's widget for empty values, otherwise the value's own type. */
export function cellWidget(property: string, value: unknown, propertyWidget: string, assigned?: string): string {
  const fixed = assigned ?? RESERVED_WIDGETS[property.toLowerCase()]
  if (fixed && (value === null || value === undefined || widgetAccepts(fixed, value))) return fixed
  if (value === null || value === undefined) return propertyWidget
  return valueWidget(value)
}

/** `note.x` → `x`, `file.file` → `file`: the id written back to the file. */
export function displayPropertyId(id: string): string {
  if (id.length > 5 && id.startsWith('note.')) {
    const rest = id.slice(5)
    return ['file', 'formula', 'note'].includes(rest.split('.')[0]) ? id : rest
  }
  return id === 'file.file' ? 'file' : id
}

/** `x` → `note.x`, `file` → `file.file`. */
export function normalizePropertyId(id: string): string {
  if (id.startsWith('note.') || id.startsWith('formula.') || id.startsWith('file.')) return id
  return id === 'file' ? 'file.file' : `note.${id}`
}

export function splitPropertyId(id: string): { type: PropertyKind; name: string } {
  const dot = id.indexOf('.')
  if (dot === -1) return { type: 'note', name: id }
  const head = id.slice(0, dot)
  return head === 'note' || head === 'file' || head === 'formula' ? { type: head, name: id.slice(dot + 1) } : { type: 'note', name: id }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

// ---- Serialisation ------------------------------------------------------------

export function serializeValue(value: Value, vault?: BaseVault): BaseCell {
  if (value instanceof NullValue) return null
  if (value instanceof ErrorValue) return { __baseValue: 'error', message: value.message }
  if (value instanceof LinkValue) {
    const target = value.resolve()
    return { __baseValue: 'link', link: value.data, display: value.display ? value.display.toString() : undefined, path: target?.path ?? null }
  }
  if (value instanceof UrlValue) return { __baseValue: 'url', value: value.data, display: value.display ? value.display.toString() : undefined }
  if (value instanceof ImageValue) {
    const vaultPath = !/^[a-z][a-z0-9+.-]*:/i.test(value.data)
    const target = vaultPath && vault ? vault.resolve(value.data.replace(/^!?\[\[|\]\]$/g, ''), '') : null
    return { __baseValue: 'image', value: value.data, path: target?.path ?? null }
  }
  if (value instanceof HtmlValue) return { __baseValue: 'html', value: value.data }
  if (value instanceof IconValue) return { __baseValue: 'icon', value: value.data }
  if (value instanceof TagValue) return { __baseValue: 'tag', value: value.data }
  if (value instanceof StringValue) return value.data
  if (value instanceof NumberValue) return Number.isFinite(value.data) ? value.data : { __baseValue: 'number', value: String(value.data), text: Number.isNaN(value.data) ? 'NaN' : '∞' }
  if (value instanceof BooleanValue) return value.data
  if (value instanceof TagsValue) return { __baseValue: 'list', kind: 'tags', items: value.values().map((item) => serializeValue(item, vault)) }
  if (value instanceof ListValue) return { __baseValue: 'list', items: value.values().map((item) => serializeValue(item, vault)) }
  if (value instanceof DateValue) return { __baseValue: 'date', value: value.toString(), time: value.time }
  if (value instanceof DurationValue) return { __baseValue: 'duration', text: value.toString(), ms: value.getMilliseconds() }
  if (value instanceof RelativeDateValue) return { __baseValue: 'relative', text: value.toString() }
  if (value instanceof FileValue) return { __baseValue: 'file', path: value.file.path, name: shortName(value.file.path) }
  if (value instanceof RegExpValue) return { __baseValue: 'regexp', value: value.toString() }
  if (value instanceof ObjectValue) return { __baseValue: 'object', text: value.toString() }
  return value.toString()
}

/** Plain text of a cell, as search and export see it. */
export function cellText(cell: BaseCell | undefined): string {
  if (cell === null || cell === undefined) return ''
  if (typeof cell !== 'object') return String(cell)
  switch (cell.__baseValue) {
    case 'error': return cell.message
    case 'link': return cell.display ?? cell.link
    case 'url': return cell.display ?? cell.value
    case 'list': return cell.items.map(cellText).join(', ')
    case 'date': case 'image': case 'html': case 'icon': case 'tag': case 'regexp': return cell.value
    case 'number': return cell.text
    case 'duration': case 'relative': case 'object': return cell.text
    case 'file': return cell.path
  }
  return ''
}

// ---- Vault ---------------------------------------------------------------------

const basename = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const dirname = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

function frontmatterLinks(frontmatter: Record<string, unknown>): Array<{ link: string; display?: string }> {
  const out: Array<{ link: string; display?: string }> = []
  const walk = (value: unknown): void => {
    if (typeof value === 'string') {
      const match = /^\[\[([^\]]+)\]\]$/.exec(value.trim())
      if (match) {
        const pipe = match[1].lastIndexOf('|')
        out.push(pipe === -1 ? { link: match[1] } : { link: match[1].slice(0, pipe), display: match[1].slice(pipe + 1) })
      }
    } else if (Array.isArray(value)) value.forEach(walk)
    else if (isRecord(value)) Object.values(value).forEach(walk)
  }
  Object.values(frontmatter).forEach(walk)
  return out
}

export function fileSource(entry: IndexEntry): BaseFileSource {
  const frontmatter = entry.frontmatter ?? {}
  const fmLinks = frontmatterLinks(frontmatter)
  const fmTargets = new Set(fmLinks.map((ref) => ref.link.split('#')[0]))
  const embeds = entry.embedPaths ?? []
  const embedSet = new Set(embeds)
  const body = (entry.linkPaths ?? []).filter((target) => !embedSet.has(target) && !fmTargets.has(target))
  const raw = frontmatter.tags
  const fmTags = new Set((Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []).map((tag) => String(tag).replace(/^#/, '').toLowerCase()))
  return {
    path: entry.relPath,
    ctime: entry.ctimeMs || entry.mtimeMs || 0,
    mtime: entry.mtimeMs || 0,
    size: entry.size ?? 0,
    frontmatter,
    links: [...fmLinks, ...body.map((link) => ({ link }))],
    embeds: embeds.map((link) => ({ link })),
    inlineTags: (entry.tags ?? []).filter((tag) => !fmTags.has(tag.replace(/^#/, '').toLowerCase())).map((tag) => (tag.startsWith('#') ? tag : `#${tag}`)),
  }
}

export function createVault(sources: BaseFileSource[]): BaseVault {
  const byPath = new Map<string, BaseFileSource>()
  const byName = new Map<string, BaseFileSource[]>()
  for (const source of sources) {
    byPath.set(source.path.toLowerCase(), source)
    const name = basename(source.path).toLowerCase()
    for (const key of new Set([name, name.replace(/\.md$/i, '')])) byName.set(key, [...(byName.get(key) ?? []), source])
  }
  const resolve = (linktext: string, sourcePath: string): BaseFileSource | null => {
    const text = linktext.trim().replace(/^\.?\//, '')
    if (!text) return null
    const lower = text.toLowerCase()
    const exact = byPath.get(lower) ?? byPath.get(`${lower}.md`)
    if (exact) return exact
    if (lower.includes('/')) {
      const suffix = [...byPath.values()].filter((source) => {
        const path = source.path.toLowerCase()
        return path.endsWith(`/${lower}`) || path.endsWith(`/${lower}.md`)
      })
      if (suffix.length) return suffix.sort((a, b) => a.path.length - b.path.length)[0]
    }
    const candidates = byName.get(basename(lower)) ?? []
    if (!candidates.length) return null
    const folder = dirname(sourcePath).toLowerCase()
    return candidates.find((source) => dirname(source.path).toLowerCase() === folder)
      ?? [...candidates].sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path))[0]
  }
  let backlinks: Map<BaseFileSource, BaseFileSource[]> | null = null
  return {
    resolve,
    backlinks(file) {
      if (!backlinks) {
        backlinks = new Map()
        for (const source of sources) {
          const seen = new Set<BaseFileSource>()
          for (const ref of [...source.links, ...source.embeds]) {
            const target = resolve(ref.link.split('#')[0], source.path)
            if (target && !seen.has(target)) { seen.add(target); backlinks.set(target, [...(backlinks.get(target) ?? []), source]) }
          }
        }
      }
      return backlinks.get(file) ?? []
    },
  }
}

// ---- Views ---------------------------------------------------------------------

interface ParsedView {
  type: string
  name: string
  filters?: unknown
  groupBy?: BaseSortRule
  summaries?: Record<string, string>
  order?: string[]
  sort?: BaseSortRule[]
  limit?: number
  options: Record<string, unknown>
}

function parseView(raw: Record<string, unknown>, index: number, issues: string[]): ParsedView | null {
  const name = typeof raw.name === 'string' && raw.name ? raw.name : null
  const type = typeof raw.type === 'string' ? raw.type : null
  if (!name) { issues.push(`View ${index + 1} has an invalid name.`); return null }
  if (!type) { issues.push(`View "${name}" is missing the required key "type".`); return null }
  const view: ParsedView = { type, name, options: {} }
  for (const [key, value] of Object.entries(raw)) {
    switch (key) {
      case 'type': case 'name': break
      case 'filters': view.filters = value; break
      case 'groupBy':
        if (isRecord(value) && typeof value.property === 'string' && value.property && (value.direction === 'ASC' || value.direction === 'DESC'))
          view.groupBy = { property: normalizePropertyId(value.property), direction: value.direction }
        break
      case 'summaries':
        if (isRecord(value)) view.summaries = Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string').map(([k, v]) => [normalizePropertyId(k), v as string]))
        break
      case 'order':
        if (Array.isArray(value)) view.order = value.filter((item): item is string => typeof item === 'string').map(normalizePropertyId)
        break
      case 'sort':
        if (Array.isArray(value)) {
          view.sort = []
          for (const rule of value) {
            if (!isRecord(rule)) continue
            const property = typeof rule.property === 'string' ? rule.property : typeof rule.column === 'string' ? rule.column : null
            if (property && (rule.direction === 'ASC' || rule.direction === 'DESC')) view.sort.push({ property: normalizePropertyId(property), direction: rule.direction })
          }
        }
        break
      case 'limit':
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) view.limit = value
        break
      default: view.options[key] = value
    }
  }
  return view
}

export function evalFilter(node: unknown, scope: Scope): boolean {
  if (node === undefined || node === null) return true
  if (typeof node === 'string') return testExpression(node, scope)
  if (Array.isArray(node)) return node.every((child) => evalFilter(child, scope))
  if (isRecord(node)) {
    const keys = Object.keys(node)
    if (keys.length !== 1) return false
    const children = node[keys[0]]
    if (!Array.isArray(children)) return false
    if (keys[0] === 'and') return children.every((child) => evalFilter(child, scope))
    if (keys[0] === 'or') return children.some((child) => evalFilter(child, scope))
    if (keys[0] === 'not') return !children.some((child) => evalFilter(child, scope))
  }
  return false
}

export interface EvaluateOptions {
  /** Explicitly assigned property types. */
  propertyTypes?: Record<string, string>
  today?: Date
}

interface Row {
  source: BaseFileSource
  scope: Scope
  values: Map<string, Value>
}

export function evaluateBase(content: string, relPath: string, entries: readonly IndexEntry[], thisPath?: string, options: EvaluateOptions = {}): BaseEvaluation {
  const name = basename(relPath).replace(/\.[^.]+$/, '')
  const issues: string[] = []
  let parsed: unknown
  try {
    const document = parseDocument(content)
    if (document.errors.length) throw document.errors[0]
    parsed = document.toJS({ maxAliasCount: 100 }) as unknown
  } catch (error) {
    return { name, views: [], issues: [(error as Error).message], parseError: true }
  }
  if (parsed === null || parsed === undefined) parsed = {}
  if (!isRecord(parsed)) return { name, views: [], issues: ['Base file must contain a YAML object'] }
  const config = parsed

  const today = options.today ?? new Date()
  const sources = entries.filter((entry) => !entry.excluded).map(fileSource).sort((a, b) => a.path.localeCompare(b.path))
  const vault = createVault(sources)
  const properties = isRecord(config.properties)
    ? Object.fromEntries(Object.entries(config.properties).map(([key, value]) => [normalizePropertyId(key), value]))
    : {}
  const formulaDefs = isRecord(config.formulas) ? Object.fromEntries(Object.entries(config.formulas).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {}
  const summaryDefs = isRecord(config.summaries) ? Object.fromEntries(Object.entries(config.summaries).filter(([, v]) => typeof v === 'string')) as Record<string, string> : {}
  const propertyTypes = options.propertyTypes ?? {}

  const thisTarget = thisPath ?? relPath
  const thisSource = sources.find((source) => source.path === thisTarget) ?? { path: thisTarget, ctime: 0, mtime: 0, size: 0, frontmatter: {}, links: [], embeds: [], inlineTags: [] }
  const makeScope = (source: BaseFileSource, thisScope: Scope | null): Scope => {
    const cache = new Map<string, Value>()
    const evaluating = new Set<string>()
    let scope: Scope | null = null
    const formula = (key: string): Value => {
      const match = Object.hasOwn(formulaDefs, key) ? key : Object.keys(formulaDefs).find((candidate) => candidate.toLowerCase() === key.toLowerCase())
      if (!match) return NULL
      const cached = cache.get(match)
      if (cached) return cached
      if (evaluating.has(match)) return new ErrorValue(`Circular reference in formula "${match}"`)
      evaluating.add(match)
      const value = evaluateValue(formulaDefs[match], scope!)
      evaluating.delete(match)
      cache.set(match, value)
      return value
    }
    scope = rowScope(source, vault, today, formula, thisScope)
    return scope
  }
  const thisScope = makeScope(thisSource, null)
  const rows: Row[] = sources.map((source) => ({ source, scope: makeScope(source, thisScope), values: new Map() }))
  const valueOf = (row: Row, id: string): Value => {
    const cached = row.values.get(id)
    if (cached) return cached
    const { type, name: key } = splitPropertyId(id)
    let value: Value
    try {
      if (type === 'formula') value = row.scope.identifier('formula').access(key) ?? NULL
      else if (type === 'file') value = row.scope.identifier('file').access(key) ?? NULL
      else value = row.scope.identifier('note').access(key) ?? NULL
    } catch (error) {
      value = new ErrorValue((error as Error).message)
    }
    row.values.set(id, value)
    return value
  }

  const assigned = new Map<string, string>()
  for (const [key, widget] of Object.entries(propertyTypes)) assigned.set(key.toLowerCase(), widget === 'list' ? 'multitext' : widget)
  for (const [key, widget] of Object.entries(RESERVED_WIDGETS)) assigned.set(key, widget)
  const firstSeen = new Map<string, string>()
  for (const source of sources) {
    for (const [key, value] of Object.entries(source.frontmatter)) {
      const lower = key.toLowerCase()
      if (value !== null && value !== undefined && !firstSeen.get(lower)) firstSeen.set(lower, valueWidget(value))
    }
  }
  const widgetOf = (key: string): string => assigned.get(key.toLowerCase()) ?? firstSeen.get(key.toLowerCase()) ?? 'text'
  const noteKeys = [...new Set(sources.flatMap((source) => Object.keys(source.frontmatter)))]
  const allProperties = new Set<string>([
    ...noteKeys.map((key) => `note.${key}`),
    ...FILE_PROPERTIES,
    ...Object.keys(formulaDefs).map((key) => `formula.${key}`),
  ])

  const labelOf = (id: string): string => {
    const entry = properties[id]
    if (isRecord(entry) && typeof entry.displayName === 'string' && entry.displayName) return entry.displayName
    if (Object.hasOwn(FILE_LABELS, id)) return FILE_LABELS[id]
    return splitPropertyId(id).name
  }
  const columnOf = (id: string): BaseColumn => {
    const { type, name: key } = splitPropertyId(id)
    if (type === 'note') {
      const widget = widgetOf(key)
      return { key: id, label: labelOf(id), kind: 'note', widget, icon: WIDGET_ICONS[widget] ?? 'text' }
    }
    return { key: id, label: labelOf(id), kind: type, icon: type === 'formula' ? 'square-function' : 'info' }
  }

  const rawViews = Array.isArray(config.views) ? config.views : []
  const views: ParsedView[] = []
  rawViews.forEach((raw, index) => {
    if (!isRecord(raw)) { issues.push(`View ${index + 1} has an invalid format.`); return }
    const view = parseView(raw, index, issues)
    if (view) views.push(view)
  })
  if (!views.length && !rawViews.length) views.push({ type: 'table', name: 'Table', options: {} })

  const baseRows = rows.filter((row) => evalFilter(config.filters, row.scope))
  const summarize = (list: Row[], id: string, summaryName: string): BaseCell => {
    const values = list.map((row) => valueOf(row, id))
    const sample = values.find((value) => !(value instanceof NullValue))
    const formula = Object.hasOwn(summaryDefs, summaryName) ? summaryDefs[summaryName] : summaryFormulasFor(sample)[summaryName]
    if (!formula) return null
    return serializeValue(evaluateValue(formula, summaryScope(values, vault, today)), vault)
  }
  const summariesFor = (list: Row[], view: ParsedView): Record<string, BaseSummary> | undefined =>
    view.summaries ? Object.fromEntries(Object.entries(view.summaries).map(([id, summaryName]) => [id, { name: summaryName, value: summarize(list, id, summaryName) }])) : undefined

  const evaluated = views.map((view): BaseEvaluatedView => {
    let matched = view.filters === undefined ? baseRows.slice() : baseRows.filter((row) => evalFilter(view.filters, row.scope))
    let rules = (view.sort ?? []).filter((rule) => allProperties.has(rule.property))
    if (!rules.length) rules = [{ property: 'file.name', direction: 'ASC' }]
    const compareRows = (a: Row, b: Row, index = 0): number => {
      if (index >= rules.length) return 0
      const rule = rules[index]
      const result = compareForSort(valueOf(a, rule.property), valueOf(b, rule.property))
      if (result === 'nullA') return 1
      if (result === 'nullB') return -1
      if (result === 0) return compareRows(a, b, index + 1)
      return rule.direction === 'ASC' ? result : -result
    }
    matched = matched.slice().sort((a, b) => compareRows(a, b))
    if (view.limit && matched.length > view.limit) matched = matched.slice(0, view.limit)

    const order = (view.order ?? ['file.name']).filter((id) => splitPropertyId(id).type !== 'file' || FILE_PROPERTIES.includes(id))
    const keys = new Set([...order, 'file.name', 'file.path', 'file.ext'])
    if (view.groupBy) keys.add(view.groupBy.property)
    for (const option of ['image', 'coordinates', 'markerIcon', 'markerColor']) if (typeof view.options[option] === 'string' && view.options[option]) keys.add(normalizePropertyId(view.options[option] as string))
    const toRow = (row: Row): BaseRow => {
      const cells: Record<string, BaseCell> = {}
      const raw: Record<string, unknown> = {}
      const widgets: Record<string, string> = {}
      for (const key of keys) {
        cells[key] = serializeValue(valueOf(row, key), vault)
        const { type, name: property } = splitPropertyId(key)
        if (type !== 'note') continue
        const rawKey = Object.keys(row.source.frontmatter).find((candidate) => candidate.toLowerCase() === property.toLowerCase())
        const value = rawKey === undefined ? undefined : row.source.frontmatter[rawKey]
        raw[key] = value
        widgets[key] = cellWidget(property, value, widgetOf(property), assigned.get(property.toLowerCase()))
      }
      return { id: row.source.path, cells, raw, widgets, hasFrontmatter: /\.md$/i.test(row.source.path) }
    }

    let groups: BaseGroup[] | undefined
    let ordered = matched
    if (view.groupBy) {
      const property = view.groupBy.property
      const buckets: Array<{ key: Value; rows: Row[] }> = []
      for (const row of matched) {
        const key = valueOf(row, property)
        const bucket = buckets.find((candidate) => looseEquals(candidate.key, key))
        if (bucket) bucket.rows.push(row)
        else buckets.push({ key, rows: [row] })
      }
      const direction = view.groupBy.direction === 'ASC' ? 1 : -1
      buckets.sort((a, b) => compareGroupKeys(a.key, b.key, direction))
      const empty = buckets.findIndex((bucket) => strictEquals(bucket.key, NULL))
      if (empty >= 0 && empty < buckets.length - 1) buckets.push(...buckets.splice(empty, 1))
      ordered = buckets.flatMap((bucket) => bucket.rows)
      groups = buckets.map((bucket) => ({
        key: serializeValue(bucket.key, vault),
        property,
        count: bucket.rows.length,
        rowIds: bucket.rows.map((row) => row.source.path),
        summaries: summariesFor(bucket.rows, view),
      }))
    }

    const known = ['table', 'cards', 'list', 'map'].includes(view.type)
    return {
      type: known ? (view.type as BaseEvaluatedView['type']) : 'unsupported',
      name: view.name,
      columns: order.map(columnOf),
      rows: ordered.map(toRow),
      groups,
      summaries: summariesFor(matched, view),
      options: view.options,
      sort: view.sort ?? [],
      groupBy: view.groupBy,
      limit: view.limit,
      filters: view.filters,
      order: view.order ?? null,
      message: known ? undefined : `Base configured with an unknown view type: ${view.type}`,
      available: [...allProperties].map(columnOf),
    }
  })

  return { name, views: evaluated, issues }
}

/** Summarise raw values with a built-in or custom summary formula. */
export function summarizeValues(values: unknown[], kind: string, definitions: Record<string, string> = {}): BaseCell {
  const typed = values.map((value) => (typeof value === 'string' ? DateValue.parse(value) ?? fromJS(value === '' ? null : value) : fromJS(value)))
  const sample = typed.find((value) => !(value instanceof NullValue))
  const formula = Object.hasOwn(definitions, kind) ? definitions[kind] : summaryFormulasFor(sample)[kind]
  if (!formula) return null
  const vault: BaseVault = { resolve: () => null, backlinks: () => [] }
  return serializeValue(evaluateValue(formula, summaryScope(typed, vault, new Date())), vault)
}

/** Text a note-property cell shows: the raw frontmatter value through its widget. */
export function rawCellText(widget: string, raw: unknown): string | string[] {
  if (raw === null || raw === undefined) return widget === 'multitext' || widget === 'tags' || widget === 'aliases' ? [] : ''
  switch (widget) {
    case 'checkbox': return raw === true ? '[x]' : '[ ]'
    case 'multitext': case 'aliases': return (Array.isArray(raw) ? raw : [raw]).filter((item) => item != null).map(String)
    case 'tags': return (Array.isArray(raw) ? raw : [raw]).filter((item) => item != null).map((tag) => String(tag).replace(/^#/, ''))
    case 'text': case 'number': case 'date': case 'datetime': return typeof raw === 'string' || typeof raw === 'number' ? String(raw) : JSON.stringify(raw)
  }
  return JSON.stringify(raw)
}
