import { React, api, text } from './runtime'
import { Icon } from './icons'
import { IconButton, MenuButton, Picker, SearchField, useReorder, type PickerOption } from './menuKit'
import type { BaseController } from './controller'
import type { BaseEditableView } from './configuration'
import { cellText, displayPropertyId, normalizePropertyId, rawCellText } from './engine/document'
import type { BaseColumn } from './engine/types'

const VIEW_ICONS: Record<string, string> = { table: 'table', cards: 'layout-grid', list: 'list', map: 'map' }
export const viewIcon = (type: string | undefined): string => VIEW_ICONS[type ?? 'table'] ?? 'file-question'
const VIEW_TYPES = ['table', 'cards', 'list', 'map']

function uniqueName(names: string[], base: string): string {
  if (!names.includes(base)) return base
  for (let n = 1; ; n++) if (!names.includes(`${base} ${n}`)) return `${base} ${n}`
}

// ---- Views -------------------------------------------------------------------------

export function ViewsMenu({ controller, close }: { controller: BaseController; close: () => void }) {
  const views = controller.raw.views
  const [query, setQuery] = React.useState('')
  const [editing, setEditing] = React.useState<number | null>(null)
  const reorder = useReorder((from, to) => {
    const next = [...views]
    next.splice(to, 0, next.splice(from, 1)[0])
    controller.viewsPatch(next)
    if (from === controller.index) controller.setActive(to)
  }, 'view')
  if (editing !== null && views[editing]) return <ViewOptions controller={controller} index={editing} back={() => setEditing(null)} close={close} />
  const shown = views.map((view, index) => ({ view, index })).filter(({ view }) => (view.name ?? '').toLowerCase().includes(query.toLowerCase()))
  return (
    <div className="base-menu">
      <SearchField className="base-menu-search" label={text('search')} placeholder={text('searchPlaceholder')} value={query} onChange={setQuery} />
      <div className="base-menu-section">
        {!shown.length && <div className="base-menu-empty" role="status">{text('noResults')}</div>}
        {shown.map(({ view, index }) => (
          <div key={index} className={`base-menu-row base-view-row${index === controller.index ? ' is-active' : ''}`} {...reorder(index, !controller.readonly)}>
            <button type="button" className="base-menu-item" aria-current={index === controller.index ? 'true' : undefined} onClick={() => { controller.setActive(index); close() }}>
              <Icon name={viewIcon(view.type)} size={16} />
              <span className="base-menu-item-label">{view.name}</span>
            </button>
            <IconButton icon="chevron-right" label={text('configureView')} onClick={() => setEditing(index)} />
          </div>
        ))}
      </div>
      <div className="base-menu-separator" />
      <MenuButton
        icon="plus"
        label={text('addView')}
        disabled={controller.readonly}
        onClick={() => {
          const name = uniqueName(views.map((view) => view.name ?? ''), text('table'))
          controller.viewsPatch([...views, { type: 'table', name, order: ['file.name'] }])
          controller.setActive(views.length)
          setEditing(views.length)
        }}
      />
    </div>
  )
}

function Slider({ label, value, min, max, step, onChange, disabled }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; disabled?: boolean }) {
  return (
    <label className="base-option">
      <span className="base-option-label">{label}</span>
      <span className="base-option-slider">
        <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
        <span className="base-option-value">{value}</span>
      </span>
    </label>
  )
}

function ViewOptions({ controller, index, back, close }: { controller: BaseController; index: number; back: () => void; close: () => void }) {
  const views = controller.raw.views
  const view = views[index]
  const readonly = controller.readonly
  const [name, setName] = React.useState(view.name ?? '')
  const update = (patch: Partial<BaseEditableView> & Record<string, unknown>): void =>
    controller.viewsPatch(views.map((item, i) => (i === index ? ({ ...item, ...patch } as BaseEditableView) : item)))
  const properties: PickerOption[] = [{ value: '', label: text('none') }, ...controller.available.filter((column) => column.kind !== 'file' || column.key === 'file.file').map((column) => ({ value: displayPropertyId(column.key), label: column.label }))]
  const type = view.type ?? 'table'
  const raw = (controller.raw.originalViews[index] ?? {}) as Record<string, unknown>
  const nameError = !name.trim() ? text('emptyViewName') : views.some((item, i) => i !== index && item.name === name.trim()) ? text('duplicateViewName') : ''
  return (
    <div className="base-menu base-view-options">
      <div className="base-menu-header">
        <IconButton icon="chevron-right" className="is-back" label={text('views')} onClick={back} />
        <span className="base-menu-title">{view.name}</span>
      </div>
      <label className="base-option">
        <span className="base-option-label">{text('viewName')}</span>
        <input
          className="base-option-input"
          value={name}
          disabled={readonly}
          aria-invalid={nameError ? 'true' : undefined}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => { if (!nameError && name.trim() !== view.name) update({ name: name.trim() }) }}
          onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }}
        />
      </label>
      {nameError && <div className="base-option-error">{nameError}</div>}
      <div className="base-option">
        <span className="base-option-label">{text('layout')}</span>
        <Picker label={text('layout')} value={type} disabled={readonly} options={VIEW_TYPES.map((value) => ({ value, label: text(value) }))} onChange={(next) => update({ type: next })} />
      </div>
      {type === 'table' && (
        <div className="base-option">
          <span className="base-option-label">{text('rowHeight')}</span>
          <Picker label={text('rowHeight')} value={view.rowHeight ?? ''} disabled={readonly}
            options={[{ value: '', label: text('rowShort') }, { value: 'medium', label: text('rowMedium') }, { value: 'tall', label: text('rowTall') }, { value: 'extra', label: text('rowExtraTall') }]}
            onChange={(rowHeight) => update({ rowHeight: rowHeight || undefined })} />
        </div>
      )}
      {type === 'cards' && (
        <>
          <Slider label={text('cardSize')} min={50} max={800} step={10} disabled={readonly} value={Number(view.cardSize) || 200} onChange={(cardSize) => update({ cardSize })} />
          <div className="base-option">
            <span className="base-option-label">{text('imageProperty')}</span>
            <Picker label={text('imageProperty')} value={view.image ? displayPropertyId(normalizePropertyId(view.image)) : ''} disabled={readonly} options={properties} placeholder={text('property')} onChange={(image) => update({ image: image || undefined })} />
          </div>
          <div className="base-option">
            <span className="base-option-label">{text('imageFit')}</span>
            <Picker label={text('imageFit')} value={view.imageFit ?? ''} disabled={readonly} options={[{ value: '', label: text('imageCover') }, { value: 'contain', label: text('imageContain') }]} onChange={(imageFit) => update({ imageFit: imageFit || undefined })} />
          </div>
          <Slider label={text('imageAspectRatio')} min={0.25} max={2.5} step={0.05} disabled={readonly} value={Number(view.imageAspectRatio) || 1} onChange={(imageAspectRatio) => update({ imageAspectRatio })} />
        </>
      )}
      {type === 'list' && (
        <>
          <div className="base-option">
            <span className="base-option-label">{text('markers')}</span>
            <Picker label={text('markers')} value={view.markers ?? 'bullet'} disabled={readonly} options={[{ value: 'bullet', label: text('markerBullet') }, { value: 'number', label: text('markerNumber') }, { value: 'none', label: text('none') }]} onChange={(markers) => update({ markers: markers === 'bullet' ? undefined : markers })} />
          </div>
          <label className="base-option is-toggle">
            <span className="base-option-label">{text('indentProperties')}</span>
            <input type="checkbox" className="base-toggle" disabled={readonly} checked={view.indentProperties === true} onChange={(event) => update({ indentProperties: event.target.checked || undefined })} />
          </label>
          {view.indentProperties !== true && (
            <label className="base-option">
              <span className="base-option-label">{text('propertySeparator')}</span>
              <input className="base-option-input" disabled={readonly} defaultValue={view.separator ?? ', '} onBlur={(event) => update({ separator: event.target.value === ', ' ? undefined : event.target.value })} />
            </label>
          )}
        </>
      )}
      {type === 'map' && (
        <>
          <Slider label={text('mapHeight')} min={200} max={800} step={20} disabled={readonly} value={Number(raw.mapHeight) || 400} onChange={(mapHeight) => update({ mapHeight })} />
          <label className="base-option">
            <span className="base-option-label">{text('mapCenter')}</span>
            <input className="base-option-input" placeholder="[latitude, longitude]" disabled={readonly} defaultValue={typeof raw.center === 'string' ? raw.center : ''} onBlur={(event) => update({ center: event.target.value || undefined })} />
          </label>
          <Slider label={text('mapDefaultZoom')} min={1} max={18} step={1} disabled={readonly} value={Number(raw.defaultZoom) || 4} onChange={(defaultZoom) => update({ defaultZoom })} />
          <Slider label={text('mapMinZoom')} min={0} max={24} step={1} disabled={readonly} value={Number(raw.minZoom) || 0} onChange={(minZoom) => update({ minZoom })} />
          <Slider label={text('mapMaxZoom')} min={0} max={24} step={1} disabled={readonly} value={Number(raw.maxZoom) || 18} onChange={(maxZoom) => update({ maxZoom })} />
          {(['coordinates', 'markerIcon', 'markerColor'] as const).map((key) => (
            <div key={key} className="base-option">
              <span className="base-option-label">{text(`map_${key}`)}</span>
              <Picker label={text(`map_${key}`)} value={typeof raw[key] === 'string' ? displayPropertyId(normalizePropertyId(raw[key] as string)) : ''} disabled={readonly} placeholder={text('property')}
                options={properties.filter((option) => !option.value.startsWith('file.'))}
                onChange={(value) => update({ [key]: value ? normalizePropertyId(value) : undefined })} />
            </div>
          ))}
        </>
      )}
      <div className="base-menu-separator" />
      <MenuButton icon="layers-2" label={text('defaultView')} disabled={readonly || index === 0} onClick={() => {
        const next = [...views]
        next.unshift(next.splice(index, 1)[0])
        controller.viewsPatch(next)
        controller.setActive(0)
        back()
      }} />
      <MenuButton icon="files" label={text('duplicateView')} disabled={readonly} onClick={() => {
        const copy = { ...view, name: uniqueName(views.map((item) => item.name ?? ''), view.name ?? text('table')) }
        controller.viewsPatch([...views, copy])
        controller.setActive(views.length)
        back()
      }} />
      <MenuButton icon="trash-2" danger label={text('deleteView')} disabled={readonly} onClick={() => {
        const next = views.filter((_, i) => i !== index)
        controller.viewsPatch(next)
        controller.setActive(Math.max(0, Math.min(index - 1, next.length - 1)))
        close()
      }} />
    </div>
  )
}

// ---- Results -----------------------------------------------------------------------

export function ResultsMenu({ controller, close }: { controller: BaseController; close: () => void }) {
  const view = controller.view!
  const [limit, setLimit] = React.useState(view.limit ? String(view.limit) : '')
  const table = (): string[][] => {
    const header = view.columns.map((column) => column.label)
    const body = controller.rows.map((row) => view.columns.map((column) => {
      if (column.kind === 'note') {
        if (!row.hasFrontmatter) return ''
        const shown = rawCellText(row.widgets[column.key] ?? 'text', row.raw[column.key])
        return Array.isArray(shown) ? shown.join(', ') : shown
      }
      return cellText(row.cells[column.key])
    }))
    return [header, ...body]
  }
  const commit = (value: string): void => {
    const n = Number(value)
    controller.patch({ limit: value.trim() && Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined })
  }
  return (
    <div className="base-menu base-results-menu">
      <label className="base-option">
        <span className="base-option-label">{text('limitResults')}</span>
        <input className="base-option-input" type="number" min={1} placeholder={text('limitPlaceholder')} disabled={controller.readonly} value={limit}
          onChange={(event) => setLimit(event.target.value)} onBlur={() => commit(limit)} onKeyDown={(event) => { if (event.key === 'Enter') commit(limit) }} />
      </label>
      <div className="base-menu-separator" />
      <MenuButton icon="rotate-ccw" label={text('showAll')} disabled={controller.readonly || !view.limit} onClick={() => { setLimit(''); controller.patch({ limit: undefined }) }} />
      <MenuButton icon="copy" label={text('copyToClipboard')} onClick={() => {
        const rows = table()
        const markdown = [`| ${rows[0].join(' | ')} |`, `| ${rows[0].map(() => '---').join(' | ')} |`, ...rows.slice(1).map((row) => `| ${row.map((cell) => cell.replace(/\|/g, '\\|')).join(' | ')} |`)].join('\n')
        void navigator.clipboard.writeText(markdown)
        close()
      }} />
      <MenuButton icon="file-down" label={text('exportCsv')} onClick={() => {
        const csv = table().map((row) => row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(',')).join('\n')
        void api.files.downloadFile(`${controller.doc.name}.csv`, csv)
        close()
      }} />
    </div>
  )
}

// ---- Sort --------------------------------------------------------------------------

function directionLabels(column: BaseColumn | undefined): [string, string] {
  const widget = column?.widget
  if (widget === 'date' || widget === 'datetime' || column?.key === 'file.ctime' || column?.key === 'file.mtime') return [text('sortOldNew'), text('sortNewOld')]
  if (widget === 'number' || widget === 'checkbox' || column?.key === 'file.size') return [text('sort01'), text('sort10')]
  return [text('sortAZ'), text('sortZA')]
}

export function SortMenu({ controller }: { controller: BaseController }) {
  const view = controller.view!
  const readonly = controller.readonly
  const [sort, setSort] = React.useState(view.sort.map((rule) => ({ ...rule })))
  const [pending, setPending] = React.useState(false)
  const options = controller.available.map((column) => ({ value: column.key, label: column.label }))
  const columnOf = (key: string) => controller.available.find((column) => column.key === key)
  const save = (next: typeof sort): void => {
    setSort(next)
    controller.patch({ sort: next.length ? next.map((rule) => ({ property: displayPropertyId(rule.property), direction: rule.direction })) : undefined })
  }
  const reorder = useReorder((from, to) => { const next = [...sort]; next.splice(to, 0, next.splice(from, 1)[0]); save(next) }, 'sort')
  const direction = (property: string | undefined, value: 'ASC' | 'DESC', onChange: (value: 'ASC' | 'DESC') => void) => {
    const [asc, desc] = directionLabels(property ? columnOf(property) : undefined)
    return <Picker label={text('direction')} value={value} disabled={readonly} options={[{ value: 'ASC', label: asc }, { value: 'DESC', label: desc }]} onChange={(next) => onChange(next as 'ASC' | 'DESC')} />
  }
  const group = view.groupBy
  const groupOptions = options.filter((option) => !['file.file', 'file.path', 'file.ctime', 'file.mtime', 'file.name', 'file.fullname', 'file.basename'].includes(option.value))
  return (
    <div className="base-menu base-sort-menu">
      <div className="base-menu-section-title">{text('groupBy')}</div>
      <div className="base-sort-row">
        <span className="base-picker-group">
          <Picker label={text('groupBy')} icon={group ? columnOf(group.property)?.icon : undefined} value={group?.property ?? ''} placeholder={text('property')} disabled={readonly}
            options={groupOptions} onChange={(property) => controller.setGroupBy({ property, direction: group?.direction ?? 'ASC' })} />
          {direction(group?.property, group?.direction ?? 'ASC', (next) => group && controller.setGroupBy({ property: group.property, direction: next }))}
        </span>
        <IconButton icon="trash-2" label={text('remove')} disabled={readonly || !group} onClick={() => controller.setGroupBy(null)} />
      </div>
      <div className="base-menu-separator" />
      <div className="base-menu-section-title">{text('sortBy')}</div>
      {sort.map((rule, index) => (
        <div key={index} className="base-sort-row" {...reorder(index, !readonly)}>
          <span className="base-grip"><Icon name="grip-vertical" size={14} /></span>
          <span className="base-picker-group">
            <Picker label={text('property')} icon={columnOf(rule.property)?.icon} value={rule.property} disabled={readonly} options={options}
              onChange={(property) => save(sort.map((item, i) => (i === index ? { ...item, property } : item)))} />
            {direction(rule.property, rule.direction, (next) => save(sort.map((item, i) => (i === index ? { ...item, direction: next } : item))))}
          </span>
          <IconButton icon="trash-2" label={text('remove')} disabled={readonly} onClick={() => save(sort.filter((_, i) => i !== index))} />
        </div>
      ))}
      {(pending || !sort.length) && (
        <div className="base-sort-row">
          <span className="base-grip"><Icon name="grip-vertical" size={14} /></span>
          <span className="base-picker-group">
            <Picker label={text('property')} value="" placeholder={text('property')} disabled={readonly} options={options} onChange={(property) => { setPending(false); save([...sort, { property, direction: 'ASC' }]) }} />
            {direction(undefined, 'ASC', () => {})}
          </span>
          <IconButton icon="trash-2" label={text('remove')} disabled={readonly || !pending} onClick={() => setPending(false)} />
        </div>
      )}
      <MenuButton icon="plus" label={text('addSort')} disabled={readonly} onClick={() => setPending(true)} />
    </div>
  )
}

// ---- Filter ------------------------------------------------------------------------

type FilterNode = string | { and: FilterNode[] } | { or: FilterNode[] } | { not: FilterNode[] }
type Conjunction = 'and' | 'or' | 'not'

function asGroup(value: unknown): { kind: Conjunction; items: FilterNode[] } {
  if (typeof value === 'string') return { kind: 'and', items: [value] }
  if (Array.isArray(value)) return { kind: 'and', items: value as FilterNode[] }
  if (value && typeof value === 'object') {
    const key = Object.keys(value)[0] as Conjunction
    const items = (value as Record<string, unknown>)[key]
    if (['and', 'or', 'not'].includes(key)) return { kind: key, items: Array.isArray(items) ? (items as FilterNode[]) : [] }
  }
  return { kind: 'and', items: [] }
}
const countFilters = (value: unknown): number => {
  if (value === undefined || value === null) return 0
  if (typeof value === 'string') return 1
  return asGroup(value).items.reduce((total, item) => total + countFilters(item), 0)
}

interface Operator { value: string; label: string; fn?: string; inverse?: boolean; noValue?: boolean }

function kindOf(key: string, column: BaseColumn | undefined): 'file' | 'text' | 'number' | 'date' | 'checkbox' | 'list' | 'unknown' {
  if (key === 'file.file') return 'file'
  if (key === 'file.size') return 'number'
  if (key === 'file.ctime' || key === 'file.mtime') return 'date'
  if (key === 'file.tags' || key === 'file.links' || key === 'file.backlinks' || key === 'file.embeds') return 'list'
  if (key.startsWith('file.')) return 'text'
  if (key.startsWith('formula.')) return 'unknown'
  switch (column?.widget) {
    case 'number': return 'number'
    case 'date': case 'datetime': return 'date'
    case 'checkbox': return 'checkbox'
    case 'multitext': case 'tags': case 'aliases': return 'list'
    case 'text': return 'text'
  }
  return 'unknown'
}

function operatorsFor(kind: ReturnType<typeof kindOf>): Operator[] {
  const out: Operator[] = []
  const fns: Record<string, string[]> = {
    file: ['hasLink', 'inFolder', 'hasTag', 'hasProperty'],
    text: ['startsWith', 'endsWith', 'isEmpty', 'contains', 'containsAny', 'containsAll'],
    number: ['isEmpty'], date: ['isEmpty'], checkbox: [], unknown: ['isEmpty'],
    list: ['isEmpty', 'contains', 'containsAny', 'containsAll'],
  }
  if (kind !== 'file') {
    const pick = (fallback: string, number: string, date: string, list?: string): string => text(kind === 'number' ? number : kind === 'date' ? date : kind === 'list' && list ? list : fallback)
    out.push({ value: '==', label: pick('opIs', 'opEq', 'opOn', 'opIsExactly') })
    out.push({ value: '!=', label: pick('opIsNot', 'opNeq', 'opNotOn', 'opIsNotExactly') })
    if (kind === 'number' || kind === 'date') {
      out.push({ value: '<', label: pick('opLt', 'opLt', 'opBefore') }, { value: '<=', label: pick('opLte', 'opLte', 'opOnOrBefore') })
      out.push({ value: '>', label: pick('opGt', 'opGt', 'opAfter') }, { value: '>=', label: pick('opGte', 'opGte', 'opOnOrAfter') })
    }
  }
  for (const fn of fns[kind]) out.push({ value: fn.toLowerCase(), fn, label: text(`fn_${fn}`), noValue: fn === 'isEmpty' })
  for (const fn of fns[kind]) out.push({ value: `!${fn.toLowerCase()}`, fn, inverse: true, label: text(`fn_${fn}_not`), noValue: fn === 'isEmpty' })
  return out
}

const IDENT = /^[A-Za-z_$][\w$]*$/
function propertyExpression(key: string): string {
  const { type, name } = key.startsWith('file.') ? { type: 'file', name: key.slice(5) } : key.startsWith('formula.') ? { type: 'formula', name: key.slice(8) } : { type: 'note', name: key.replace(/^note\./, '') }
  if (type === 'file') return key === 'file.file' ? 'file' : `file.${name}`
  if (type === 'formula') return IDENT.test(name) ? `formula.${name}` : `formula[${JSON.stringify(name)}]`
  return IDENT.test(name) && !['file', 'formula', 'note', 'this', 'true', 'false', 'null'].includes(name) ? name : `note[${JSON.stringify(name)}]`
}
function parseProperty(expression: string): string | null {
  const trimmed = expression.trim()
  if (trimmed === 'file') return 'file.file'
  let match = /^(file|formula|note)\.([A-Za-z_$][\w$]*)$/.exec(trimmed)
  if (match) return match[1] === 'note' ? `note.${match[2]}` : `${match[1]}.${match[2]}`
  match = /^(formula|note)\[("(?:[^"\\]|\\.)*")\]$/.exec(trimmed)
  if (match) return `${match[1]}.${JSON.parse(match[2])}`
  if (IDENT.test(trimmed)) return `note.${trimmed}`
  return null
}
const literal = (value: string, kind: string): string =>
  kind === 'number' && value.trim() && Number.isFinite(Number(value)) ? String(Number(value)) : kind === 'checkbox' && (value === 'true' || value === 'false') ? value : JSON.stringify(value)
const parseLiteral = (value: string): string | null => {
  const trimmed = value.trim()
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed) || trimmed === 'true' || trimmed === 'false') return trimmed
  if (/^"(?:[^"\\]|\\.)*"$/.test(trimmed)) return JSON.parse(trimmed) as string
  return null
}

interface SimpleFilter { property: string; operator: string; value: string }
function parseSimple(expression: string): SimpleFilter | null {
  let match = /^(!)?\s*(.+?)\.(hasLink|inFolder|hasTag|hasProperty|startsWith|endsWith|isEmpty|contains|containsAny|containsAll)\((.*)\)$/.exec(expression.trim())
  if (match) {
    const property = parseProperty(match[2])
    if (!property) return null
    const args = match[4].trim() ? match[4].split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((part) => parseLiteral(part)) : []
    if (args.some((arg) => arg === null)) return null
    return { property, operator: `${match[1] ? '!' : ''}${match[3].toLowerCase()}`, value: args.join(', ') }
  }
  match = /^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/.exec(expression.trim())
  if (match) {
    const property = parseProperty(match[1])
    const value = parseLiteral(match[3])
    if (!property || value === null) return null
    return { property, operator: match[2], value }
  }
  return null
}
function buildSimple(filter: SimpleFilter, kind: string): string {
  const expression = propertyExpression(filter.property)
  const operator = operatorsFor(kind as ReturnType<typeof kindOf>).find((item) => item.value === filter.operator)
  if (operator?.fn) {
    const values = operator.noValue ? [] : ['containsAny', 'containsAll', 'hasTag'].includes(operator.fn) ? filter.value.split(',').map((part) => part.trim()).filter(Boolean) : [filter.value]
    return `${operator.inverse ? '!' : ''}${expression}.${operator.fn}(${values.map((value) => JSON.stringify(value)).join(', ')})`
  }
  return `${expression} ${filter.operator} ${literal(filter.value, kind)}`
}

function FilterRow({ value, label, controller, onChange, onRemove }: { value: string; label: string; controller: BaseController; onChange: (value: string) => void; onRemove: () => void }) {
  const parsed = parseSimple(value)
  const [advanced, setAdvanced] = React.useState(!parsed && value !== '')
  const [draft, setDraft] = React.useState(value)
  const [filter, setFilter] = React.useState<SimpleFilter>(parsed ?? { property: '', operator: '==', value: '' })
  React.useEffect(() => { setDraft(value); const next = parseSimple(value); if (next) setFilter(next) }, [value])
  const readonly = controller.readonly
  const properties = [{ key: 'file.file', label: text('fileProperty'), icon: 'file' } as BaseColumn, ...controller.available]
  const column = properties.find((item) => item.key === filter.property)
  const kind = kindOf(filter.property, column)
  const operators = operatorsFor(kind)
  const operator = operators.find((item) => item.value === filter.operator) ?? operators[0]
  const commit = (next: SimpleFilter): void => {
    setFilter(next)
    if (next.property) onChange(buildSimple(next, kindOf(next.property, properties.find((item) => item.key === next.property))))
  }
  return (
    <div className="base-filter-row">
      <span className="base-filter-conjunction">{label}</span>
      <span className="base-filter-fields">
        {advanced ? (
          <input className="base-filter-advanced" placeholder={text('advancedFilter')} value={draft} disabled={readonly}
            onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (draft !== value) onChange(draft) }}
            onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }} />
        ) : (
          <>
            <Picker label={text('property')} icon={column?.icon} value={filter.property} placeholder={text('property')} disabled={readonly}
              options={properties.map((item) => ({ value: item.key, label: item.label }))}
              onChange={(property) => {
                const nextKind = kindOf(property, properties.find((item) => item.key === property))
                const nextOps = operatorsFor(nextKind)
                commit({ property, operator: nextOps.some((item) => item.value === filter.operator) ? filter.operator : nextOps[0].value, value: filter.value })
              }} />
            <Picker label={text('operator')} value={operator.value} disabled={readonly || !filter.property} options={operators.map((item) => ({ value: item.value, label: item.label }))}
              onChange={(next) => commit({ ...filter, operator: next })} />
            {!operator.noValue && (
              kind === 'checkbox' && !operator.fn ? (
                <input type="checkbox" className="base-checkbox" disabled={readonly} checked={filter.value === 'true'} onChange={(event) => commit({ ...filter, value: event.target.checked ? 'true' : 'false' })} />
              ) : (
                <input className="base-filter-value" type={kind === 'number' && !operator.fn ? 'number' : kind === 'date' && !operator.fn ? 'date' : 'text'} disabled={readonly} value={filter.value}
                  onChange={(event) => setFilter({ ...filter, value: event.target.value })} onBlur={() => commit(filter)}
                  onKeyDown={(event) => { if (event.key === 'Enter') commit(filter) }} />
              )
            )}
          </>
        )}
      </span>
      <IconButton icon={advanced ? 'arrow-right' : 'code-xml'} label={text(advanced ? 'simpleFilter' : 'advancedFilter')} onClick={() => {
        if (advanced) { const next = parseSimple(draft); if (next) { setFilter(next); setAdvanced(false) } }
        else { setDraft(value); setAdvanced(true) }
      }} />
      <IconButton icon="trash-2" label={text('removeFilter')} disabled={readonly} onClick={onRemove} />
    </div>
  )
}

function FilterGroup({ value, controller, onChange, onRemove, nested }: { value: unknown; controller: BaseController; onChange: (value: FilterNode | undefined) => void; onRemove?: () => void; nested?: boolean }) {
  const { kind, items } = asGroup(value)
  const readonly = controller.readonly
  const publish = (nextKind: Conjunction, nextItems: FilterNode[]): void => onChange(nextItems.length || nested ? ({ [nextKind]: nextItems } as FilterNode) : undefined)
  const joiner = kind === 'or' || kind === 'not' ? text('joinOr') : text('joinAnd')
  return (
    <div className={`base-filter-group${nested ? ' is-nested' : ''}`}>
      <div className="base-filter-group-header">
        <Picker label={text('match')} value={kind} disabled={readonly}
          options={[{ value: 'and', label: text('allTrue') }, { value: 'or', label: text('anyTrue') }, { value: 'not', label: text('noneTrue') }]}
          onChange={(next) => publish(next as Conjunction, items)} />
        {onRemove && <IconButton icon="trash-2" label={text('remove')} disabled={readonly} onClick={onRemove} />}
      </div>
      {items.map((item, index) => typeof item === 'string' ? (
        <FilterRow key={index} value={item} label={index === 0 ? text('where') : joiner} controller={controller}
          onChange={(next) => publish(kind, items.map((existing, i) => (i === index ? next : existing)))}
          onRemove={() => publish(kind, items.filter((_, i) => i !== index))} />
      ) : (
        <FilterGroup key={index} nested value={item} controller={controller}
          onChange={(next) => publish(kind, next === undefined ? items.filter((_, i) => i !== index) : items.map((existing, i) => (i === index ? next : existing)))}
          onRemove={() => publish(kind, items.filter((_, i) => i !== index))} />
      ))}
      <div className="base-filter-actions">
        <MenuButton icon="plus" label={text('addFilter')} disabled={readonly} onClick={() => publish(kind, [...items, 'file.name == ""'])} />
        <MenuButton icon="plus" label={text('addFilterGroup')} disabled={readonly} onClick={() => publish(kind, [...items, { and: [] }])} />
      </div>
    </div>
  )
}

export function FilterMenu({ controller }: { controller: BaseController }) {
  const view = controller.view!
  const [open, setOpen] = React.useState<{ all: boolean; view: boolean }>({ all: false, view: true })
  const sections = [
    { key: 'all' as const, label: text('allViews'), value: controller.raw.filters, save: (next: unknown) => controller.patch({ filters: next }, true) },
    { key: 'view' as const, label: text('thisView'), value: view.filters, save: (next: unknown) => controller.patch({ filters: next }) },
  ]
  return (
    <div className="base-menu base-filter-menu">
      {sections.map((section) => (
        <div key={section.key} className="base-filter-section">
          <button type="button" className="base-filter-section-header" onClick={() => setOpen({ ...open, [section.key]: !open[section.key] })}>
            <Icon name={open[section.key] ? 'chevron-down' : 'chevron-right'} size={14} />
            <span>{section.label}</span>
            <span className="base-badge">{countFilters(section.value)}</span>
          </button>
          {open[section.key] && <FilterGroup value={section.value} controller={controller} onChange={(next) => section.save(next)} />}
        </div>
      ))}
    </div>
  )
}

// ---- Properties ------------------------------------------------------------------

export function PropertiesMenu({ controller }: { controller: BaseController }) {
  const view = controller.view!
  const readonly = controller.readonly
  const [query, setQuery] = React.useState('')
  const [editing, setEditing] = React.useState<string | null>(null)
  const order = view.columns.map((column) => column.key)
  const visible = new Set(order)
  const ordered = [...view.columns, ...controller.available.filter((column) => !visible.has(column.key) && column.key !== 'file.file').sort((a, b) => {
    const rank = (column: BaseColumn): number => (column.kind === 'file' ? 0 : column.kind === 'formula' ? 1 : 2)
    return rank(a) - rank(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  })]
  const shown = ordered.filter((column) => column.label.toLowerCase().includes(query.toLowerCase()))
  const reorder = useReorder((from, to) => {
    const next = [...order]
    next.splice(to, 0, next.splice(from, 1)[0])
    controller.setOrder(next)
  }, 'property')
  const toggle = (key: string): void => controller.setOrder(visible.has(key) ? order.filter((item) => item !== key) : [...order, key])
  if (editing) return <PropertyOptions controller={controller} property={editing} back={() => setEditing(null)} />
  const exact = controller.available.some((column) => column.label.toLowerCase() === query.trim().toLowerCase() || displayPropertyId(column.key) === query.trim())
  return (
    <div className="base-menu base-properties-menu">
      <SearchField className="base-menu-search" label={text('findOrCreate')} value={query} onChange={setQuery}
        onKeyDown={(event) => { if (event.key === 'Enter' && query.trim() && !exact && !readonly) { controller.setOrder([...order, normalizePropertyId(query.trim())]); setQuery('') } }} />
      <div className="base-menu-section base-properties-list">
        {shown.map((column) => {
          const index = order.indexOf(column.key)
          return (
            <div key={column.key} className={`base-menu-row base-property-row${visible.has(column.key) ? '' : ' is-hidden'}`} {...reorder(index, !readonly && index >= 0)}>
              <label className="base-menu-item">
                <input type="checkbox" className="base-checkbox" checked={visible.has(column.key)} disabled={readonly} onChange={() => toggle(column.key)} />
                <Icon name={column.icon} size={16} />
                <span className="base-menu-item-label">{column.label}</span>
              </label>
              <IconButton icon="chevron-right" label={text('editProperty')} onClick={() => setEditing(column.key)} />
            </div>
          )
        })}
        {query.trim() && !exact && (
          <MenuButton icon="plus" label={`${text('createProperty')} "${query.trim()}"`} disabled={readonly} onClick={() => { controller.setOrder([...order, normalizePropertyId(query.trim())]); setQuery('') }} />
        )}
      </div>
      <div className="base-menu-separator" />
      <MenuButton icon="square-function" label={text('addFormula')} disabled={readonly} onClick={() => {
        const formulas = controller.raw.formulas ?? {}
        const name = uniqueName(Object.keys(formulas), text('untitled'))
        controller.patchAll({ order: [...order.map(displayPropertyId), `formula.${name}`] }, { formulas: { ...formulas, [name]: '' } })
        setEditing(`formula.${name}`)
      }} />
      <MenuButton icon="eye-off" label={text('hideAll')} disabled={readonly || !order.length} onClick={() => controller.setOrder([])} />
    </div>
  )
}

function PropertyOptions({ controller, property, back }: { controller: BaseController; property: string; back: () => void }) {
  const column = controller.available.find((item) => item.key === property)
  const readonly = controller.readonly
  const isFormula = property.startsWith('formula.')
  const formulaName = property.slice('formula.'.length)
  const configured = (controller.raw.properties?.[property] ?? controller.raw.properties?.[displayPropertyId(property)]) as { displayName?: string } | undefined
  const [displayName, setDisplayName] = React.useState(configured?.displayName ?? '')
  const [formula, setFormula] = React.useState(String((controller.raw.formulas ?? {})[formulaName] ?? ''))
  const [name, setName] = React.useState(formulaName)
  return (
    <div className="base-menu base-property-options">
      <div className="base-menu-header">
        <IconButton icon="chevron-right" className="is-back" label={text('properties')} onClick={back} />
        <span className="base-menu-title">{text('editPropertyTitle', { name: column?.label ?? displayPropertyId(property) })}</span>
      </div>
      {isFormula && (
        <label className="base-option">
          <span className="base-option-label">{text('formulaName')}</span>
          <input className="base-option-input" value={name} disabled={readonly} onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              const next = name.trim()
              if (!next || next === formulaName) return
              const formulas = { ...(controller.raw.formulas ?? {}) }
              const entries = Object.entries(formulas).map(([key, value]) => (key === formulaName ? [next, value] : [key, value]))
              controller.patch({ formulas: Object.fromEntries(entries) }, true)
              back()
            }} />
        </label>
      )}
      <label className="base-option">
        <span className="base-option-label">{text('displayName')}</span>
        <input className="base-option-input" value={displayName} disabled={readonly} placeholder={column?.label} onChange={(event) => setDisplayName(event.target.value)}
          onBlur={() => controller.setDisplayName(property, displayName)} onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur() }} />
      </label>
      {isFormula && (
        <label className="base-option is-stacked">
          <span className="base-option-label">{text('formula')}</span>
          <textarea className="base-formula-input" value={formula} disabled={readonly} spellCheck={false} rows={4} onChange={(event) => setFormula(event.target.value)}
            onBlur={() => controller.patch({ formulas: { ...(controller.raw.formulas ?? {}), [formulaName]: formula } }, true)} />
        </label>
      )}
      {isFormula && (
        <>
          <div className="base-menu-separator" />
          <MenuButton icon="trash-2" danger label={text('deleteFormula')} disabled={readonly} onClick={() => {
            const formulas = { ...(controller.raw.formulas ?? {}) }
            delete formulas[formulaName]
            const order = controller.view?.columns.some((item) => item.key === property) ? { order: controller.view.columns.map((item) => displayPropertyId(item.key)).filter((key) => key !== property) } : null
            controller.patchAll(order, { formulas: Object.keys(formulas).length ? formulas : undefined })
            back()
          }} />
        </>
      )}
    </div>
  )
}
