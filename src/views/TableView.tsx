import { React, api, text } from '../runtime'
import { Icon } from '../icons'
import { openMenuAt } from '../menuKit'
import { CellValue, PropertyEditor, type CellActions } from '../cells'
import { cellText, displayPropertyId, rawCellText } from '../engine/document'
import type { BaseColumn, BaseEvaluatedView, BaseRow, BaseSummary } from '../engine/types'
import type { BaseController } from '../controller'
import { SUMMARY_NAMES, summaryNamesFor } from '../summaries'

const MIN_WIDTH = 40
const MAX_WIDTH = 300
const ROW_HEIGHT = 30
const HEIGHT_MULTIPLIER: Record<string, number> = { medium: 2, tall: 4, extra: 8 }
/** Properties that cannot be grouped by (unique per file). */
const UNGROUPABLE = new Set(['file.file', 'file.path', 'file.ctime', 'file.mtime', 'file.name', 'file.fullname', 'file.basename'])

let canvas: HTMLCanvasElement | null = null
function measureText(value: string, font: string): number {
  canvas ??= document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) return value.length * 7
  context.font = font
  return context.measureText(value).width
}

function contentText(column: BaseColumn, row: BaseRow): string {
  if (column.kind === 'note') {
    if (!row.hasFrontmatter) return ''
    const shown = rawCellText(row.widgets[column.key] ?? 'text', row.raw[column.key])
    return Array.isArray(shown) ? shown.join('    ') : shown.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, label) => label ?? target)
  }
  return cellText(row.cells[column.key])
}

/** Extra horizontal room a cell needs beyond its text (chips, icons, checkbox). */
function contentExtra(column: BaseColumn, row: BaseRow): number {
  if (column.kind !== 'note') {
    const cell = row.cells[column.key]
    if (typeof cell === 'boolean') return 16
    if (cell && typeof cell === 'object' && cell.__baseValue === 'list') return cell.items.length * 6
    if (cell && typeof cell === 'object' && cell.__baseValue === 'error') return 18
    return 0
  }
  const widget = row.widgets[column.key]
  if (widget === 'checkbox') return 16
  if (widget === 'date' || widget === 'datetime') return 18
  if (widget === 'multitext' || widget === 'tags' || widget === 'aliases') {
    const shown = rawCellText(widget, row.raw[column.key])
    return Array.isArray(shown) ? shown.length * 30 : 0
  }
  return 0
}

export function TableView({ controller, view, rows, actions }: { controller: BaseController; view: BaseEvaluatedView; rows: BaseRow[]; actions: CellActions }) {
  const { readonly } = controller
  const rootRef = React.useRef<HTMLDivElement>(null)
  const [font, setFont] = React.useState('13px sans-serif')
  const [headerFont, setHeaderFont] = React.useState('13px sans-serif')
  const custom = (view.options.columnSize && typeof view.options.columnSize === 'object' ? view.options.columnSize : {}) as Record<string, number>
  const [dragWidths, setDragWidths] = React.useState<Record<string, number> | null>(null)
  const [editing, setEditing] = React.useState<{ row: string; column: string } | null>(null)
  const [dragColumn, setDragColumn] = React.useState<string | null>(null)
  const multiplier = HEIGHT_MULTIPLIER[String(view.options.rowHeight ?? '')] ?? 1
  const rowHeight = ROW_HEIGHT * multiplier

  React.useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    const probe = root.querySelector('.base-td') as HTMLElement | null
    const header = root.querySelector('.base-table-header-name') as HTMLElement | null
    const style = getComputedStyle(probe ?? root)
    setFont(`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`)
    if (header) { const h = getComputedStyle(header); setHeaderFont(`${h.fontWeight} ${h.fontSize} ${h.fontFamily}`) }
  }, [])

  const widths = React.useMemo(() => {
    const out = view.columns.map((column) => {
      const size = (dragWidths ?? custom)[column.key] ?? custom[displayPropertyId(column.key)]
      if (typeof size === 'number' && size > 0) return Math.max(MIN_WIDTH, size)
      const header = 16 + 14 + 4 + measureText(column.label, headerFont)
      let longest: BaseRow | null = null
      let longestLength = -1
      for (const row of view.rows) {
        const length = contentText(column, row).length
        if (length > longestLength) { longestLength = length; longest = row }
      }
      const content = longest ? 16 + measureText(contentText(column, longest), font) + contentExtra(column, longest) : 0
      return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.ceil(Math.max(content, header)) + 1))
    })
    return out
  }, [view, dragWidths, custom, font, headerFont])
  const last = view.columns.at(-1)
  const lastCustom = Boolean(last && typeof ((dragWidths ?? custom)[last.key] ?? custom[displayPropertyId(last.key)]) === 'number')
  // The last column absorbs the remaining width unless it was sized by hand.
  const template = widths.map((width, index) => (index === widths.length - 1 && !lastCustom ? `minmax(${width}px, 1fr)` : `${width}px`)).join(' ')
  const totalWidth = widths.reduce((a, b) => a + b, 0)

  const sortOf = (key: string): 'ASC' | 'DESC' | undefined => view.sort.find((rule) => rule.property === key)?.direction
  const openHeaderMenu = (column: BaseColumn, event: React.MouseEvent): void => {
    event.preventDefault()
    if (readonly) return
    const current = view.sort.find((rule) => rule.property === column.key)
    const values = view.rows.map((row) => row.cells[column.key])
    openMenuAt([
      { id: 'hide', label: text('hideColumn'), onSelect: () => controller.setOrder(view.columns.filter((item) => item.key !== column.key).map((item) => item.key)) },
      { id: 'summarize', label: text('summarize'), submenu: summaryMenu(column.key, values) },
      ...(!UNGROUPABLE.has(column.key) && column.widget !== 'aliases' ? [{ id: 'group', label: text('groupByProperty'), onSelect: () => controller.setGroupBy({ property: column.key, direction: 'ASC' }) }] : []),
      { type: 'separator' as const },
      { id: 'asc', label: text('sortAZ'), type: 'checkbox' as const, checked: current?.direction === 'ASC', onSelect: () => controller.setSortProperty(column.key, 'ASC') },
      { id: 'desc', label: text('sortZA'), type: 'checkbox' as const, checked: current?.direction === 'DESC', onSelect: () => controller.setSortProperty(column.key, 'DESC') },
      ...(current ? [{ id: 'clear', label: text('clearSort'), danger: true, onSelect: () => controller.setSortProperty(column.key, 'NONE') }] : []),
    ], event.clientX, event.clientY)
  }
  const summaryMenu = (key: string, values: unknown[]) => {
    const current = view.summaries?.[key]?.name
    const names = [...summaryNamesFor(values), ...Object.keys(controller.raw.summaries ?? {})]
    return [
      { id: 'none', label: text('none'), type: 'checkbox' as const, checked: !current, onSelect: () => controller.setSummary(key, null) },
      ...[...new Set(names)].map((name) => ({ id: `summary:${name}`, label: SUMMARY_NAMES[name] ? text(SUMMARY_NAMES[name]) : name, type: 'checkbox' as const, checked: current === name, onSelect: () => controller.setSummary(key, name) })),
    ]
  }

  const startResize = (column: BaseColumn, index: number, event: React.PointerEvent): void => {
    if (readonly || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const handle = event.currentTarget as HTMLElement
    handle.setPointerCapture?.(event.pointerId)
    const startX = event.clientX
    const startWidth = widths[index]
    let next: Record<string, number> = { ...custom }
    const move = (e: PointerEvent): void => {
      next = { ...custom, [column.key]: Math.max(MIN_WIDTH, Math.round(startWidth + e.clientX - startX)) }
      setDragWidths(next)
    }
    const stop = (save: boolean) => (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', cancel)
      setDragWidths(null)
      if (save && next[column.key] !== custom[column.key]) controller.patch({ columnSize: next })
    }
    const up = stop(true)
    const cancel = stop(false)
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', cancel)
  }

  const resizeBy = (column: BaseColumn, index: number, delta: number): void => {
    controller.patch({ columnSize: { ...custom, [column.key]: Math.max(MIN_WIDTH, widths[index] + delta) } })
  }

  const moveColumn = (from: string, to: string): void => {
    if (from === to) return
    const order = view.columns.map((column) => column.key).filter((key) => key !== from)
    order.splice(order.indexOf(to), 0, from)
    controller.setOrder(order)
  }

  const renderCell = (row: BaseRow, column: BaseColumn, index: number) => {
    const isEditing = editing?.row === row.id && editing.column === column.key
    const widget = column.kind === 'note' ? row.widgets[column.key] ?? column.widget ?? 'text' : undefined
    const numeric = widget === 'number' || (column.kind !== 'note' && typeof row.cells[column.key] === 'number')
    return (
      <div
        key={column.key}
        className={`base-td${isEditing ? ' is-editing' : ''}`}
        data-property={column.key}
        style={{ gridColumn: index + 1 }}
        tabIndex={-1}
        onClick={() => { if (column.kind === 'note' && row.hasFrontmatter && !readonly && widget !== 'checkbox' && widget !== 'unknown') setEditing({ row: row.id, column: column.key }) }}
        onKeyDown={(event) => navigate(event, row, column)}
      >
        <div className={`base-table-cell${numeric ? ' is-number' : ''}${widget === 'checkbox' || typeof row.cells[column.key] === 'boolean' ? ' is-checkbox' : ''}`} data-property-type={widget}>
          {column.kind === 'note' ? (
            row.hasFrontmatter ? (
              <PropertyEditor
                widget={widget!}
                value={row.raw[column.key]}
                label={column.label}
                readonly={readonly}
                actions={actions}
                editing={isEditing}
                onEditingChange={(value) => setEditing(value ? { row: row.id, column: column.key } : null)}
                onSave={(value) => controller.editProperty(row.id, displayPropertyId(column.key), value)}
              />
            ) : null
          ) : column.key === 'file.name' ? (
            <a href="#" className="base-link" onClick={(event) => { event.preventDefault(); event.stopPropagation(); actions.openFile(row.id, event) }}>{cellText(row.cells[column.key])}</a>
          ) : (
            <CellValue cell={row.cells[column.key]} actions={actions} />
          )}
        </div>
      </div>
    )
  }

  const navigate = (event: React.KeyboardEvent, row: BaseRow, column: BaseColumn): void => {
    if (event.target !== event.currentTarget) return
    const cell = event.currentTarget as HTMLElement
    const rowEl = cell.parentElement
    let next: Element | null | undefined = null
    if (event.key === 'ArrowRight') next = cell.nextElementSibling
    if (event.key === 'ArrowLeft') next = cell.previousElementSibling
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      let sibling = event.key === 'ArrowDown' ? rowEl?.nextElementSibling : rowEl?.previousElementSibling
      while (sibling && !sibling.classList.contains('base-row')) sibling = event.key === 'ArrowDown' ? sibling.nextElementSibling : sibling.previousElementSibling
      next = sibling?.querySelector(`[data-property="${CSS.escape(column.key)}"]`)
    }
    if (event.key === 'Enter' && column.kind === 'note' && row.hasFrontmatter && !readonly) { event.preventDefault(); setEditing({ row: row.id, column: column.key }); return }
    if (next instanceof HTMLElement) { event.preventDefault(); next.focus() }
  }

  const summaryRow = (summaries: Record<string, BaseSummary> | undefined, className: string, allRows: BaseRow[]) => (
    <div className={`base-tr ${className}`} style={{ gridTemplateColumns: template, minWidth: totalWidth }}>
      {view.columns.map((column, index) => {
        const summary = summaries?.[column.key]
        return (
          <div key={column.key} className="base-td" style={{ gridColumn: index + 1 }}>
            <button
              type="button"
              className={`base-summary-cell${summary ? ' has-summary' : ''}`}
              disabled={readonly}
              onClick={(event) => {
                if (readonly) return
                void api.ui.openMenu(summaryMenu(column.key, allRows.map((row) => row.cells[column.key])), { anchor: event.currentTarget })
              }}
            >
              {summary ? (
                <span className="base-summary-content">
                  <span className="base-summary-name">{SUMMARY_NAMES[summary.name] ? text(SUMMARY_NAMES[summary.name]) : summary.name}</span>
                  <span className="base-summary-value">{summary.value === null ? <span className="base-summary-empty">{text('emptyValue')}</span> : <CellValue cell={summary.value} actions={actions} />}</span>
                </span>
              ) : (
                <span className="base-summary-placeholder">{text('summary')}</span>
              )}
            </button>
          </div>
        )
      })}
    </div>
  )

  const rowElement = (row: BaseRow) => (
    <div
      key={row.id}
      className="base-tr base-row"
      style={{ gridTemplateColumns: template, minWidth: totalWidth, height: multiplier > 1 ? rowHeight : undefined }}
      onContextMenu={(event) => {
        if ((event.target as HTMLElement).closest('input')) return
        event.preventDefault()
        openMenuAt([
          { id: 'open', label: text('open'), onSelect: () => actions.openFile(row.id) },
          { id: 'open-tab', label: text('openInNewTab'), onSelect: () => void api.workspace.openFile(row.id, undefined, { newTab: true }) },
        ], event.clientX, event.clientY)
      }}
    >
      {view.columns.map((column, index) => renderCell(row, column, index))}
    </div>
  )

  const groups = view.groups
  const visible = new Set(rows.map((row) => row.id))
  const groupLabel = view.groupBy ? view.available.find((column) => column.key === view.groupBy!.property)?.label ?? displayPropertyId(view.groupBy.property) : ''
  const hasSummaries = Boolean(view.summaries && Object.keys(view.summaries).length)

  return (
    <div ref={rootRef} className={`base-view base-table-view${multiplier > 1 ? ' is-multiline' : ''}`} style={{ ['--base-body-row-height' as string]: `${rowHeight}px` }}>
      <div className="base-table" style={{ width: `max(100%, ${totalWidth}px)` }}>
        <div className="base-thead base-tr" style={{ gridTemplateColumns: template, minWidth: totalWidth }}>
          {view.columns.map((column, index) => (
            <div
              key={column.key}
              className={`base-td base-th${sortOf(column.key) ? ' is-sorted' : ''}${dragColumn === column.key ? ' is-dragging' : ''}`}
              data-sort={sortOf(column.key)}
              style={{ gridColumn: index + 1 }}
              draggable={!readonly}
              onDragStart={(event) => { event.dataTransfer.setData('text/x-base-column', column.key); event.dataTransfer.effectAllowed = 'move'; setDragColumn(column.key) }}
              onDragEnd={() => setDragColumn(null)}
              onDragOver={(event) => { if (event.dataTransfer.types.includes('text/x-base-column')) event.preventDefault() }}
              onDrop={(event) => { event.preventDefault(); const key = event.dataTransfer.getData('text/x-base-column'); if (key) moveColumn(key, column.key) }}
              onClick={(event) => { if (!readonly && event.button === 0 && !(event.target as HTMLElement).closest('.base-column-resizer')) controller.setSortProperty(column.key, 'TOGGLE') }}
              onContextMenu={(event) => openHeaderMenu(column, event)}
            >
              <div className="base-table-header">
                <span className="base-table-header-label">
                  <span className="base-table-header-icon"><Icon name={column.icon} size={14} /></span>
                  <span className="base-table-header-name">{column.label}</span>
                </span>
              </div>
              {sortOf(column.key) && <span className="base-table-header-sort"><Icon name={sortOf(column.key) === 'ASC' ? 'chevron-up' : 'chevron-down'} size={14} /></span>}
              {!readonly && (
                <span
                  className="base-column-resizer"
                  role="separator"
                  tabIndex={0}
                  aria-orientation="vertical"
                  aria-label={`${text('resize')} ${column.label}`}
                  aria-valuemin={MIN_WIDTH}
                  aria-valuenow={Math.round(widths[index])}
                  onPointerDown={(event) => startResize(column, index, event)}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                    event.preventDefault()
                    event.stopPropagation()
                    resizeBy(column, index, (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 50 : 10))
                  }}
                  onClick={(event) => event.stopPropagation()}
                  onDoubleClick={(event) => {
                    event.stopPropagation()
                    const next = { ...custom }
                    delete next[column.key]
                    delete next[displayPropertyId(column.key)]
                    controller.patch({ columnSize: Object.keys(next).length ? next : undefined })
                  }}
                />
              )}
            </div>
          ))}
        </div>
        {groups ? (
          groups.map((group, index) => {
            const groupRows = group.rowIds.filter((id) => visible.has(id)).map((id) => rows.find((row) => row.id === id)!).filter(Boolean)
            return (
              <div key={index} className="base-table-group">
                <div className="base-group-heading">
                  <span className="base-group-property">{groupLabel}</span>
                  <span className="base-group-value">{group.key === null ? text('none') : <CellValue cell={group.key} actions={actions} />}</span>
                </div>
                {group.summaries && Object.values(group.summaries).some((summary) => summary.value !== null || summary.name) && summaryRow(group.summaries, 'base-group-summary-row', groupRows)}
                <div className="base-tbody">{groupRows.map(rowElement)}</div>
              </div>
            )
          })
        ) : (
          <div className="base-tbody">{rows.map(rowElement)}</div>
        )}
        {summaryRow(view.summaries, `base-table-footer${hasSummaries ? ' has-summaries' : ''}`, view.rows)}
      </div>
    </div>
  )
}

