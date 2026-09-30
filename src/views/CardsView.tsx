import { assetUrlForRelPath } from '@valley/plugin-sdk/fileTypes'
import { React, api, text } from '../runtime'
import { openMenuAt } from '../menuKit'
import { CellValue, PropertyEditor, type CellActions } from '../cells'
import { cellText, displayPropertyId, normalizePropertyId } from '../engine/document'
import type { BaseCell, BaseColumn, BaseEvaluatedView, BaseRow } from '../engine/types'
import type { BaseController } from '../controller'
import { useWidth } from '../useWidth'

const PADDING = 12
const GAP = 12

function coverOf(cell: BaseCell | undefined, raw: unknown, resolveLink: (reference: string) => string | null): { image?: string; color?: string } | null {
  const value = typeof raw === 'string' ? raw : cell && typeof cell === 'object' ? (cell.__baseValue === 'link' ? `[[${cell.link}]]` : cell.__baseValue === 'image' ? cell.value : cell.__baseValue === 'url' ? cell.value : null) : typeof cell === 'string' ? cell : null
  if (!value) return null
  const trimmed = value.trim()
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) return { color: trimmed }
  if (/^https?:\/\//i.test(trimmed)) return { image: trimmed }
  const link = /^!?\[\[([^\]|#]+)/.exec(trimmed)
  const target = resolveLink(link ? link[1] : trimmed)
  return target ? { image: assetUrlForRelPath(target) } : null
}

export function CardsView({ controller, view, rows, actions }: { controller: BaseController; view: BaseEvaluatedView; rows: BaseRow[]; actions: CellActions }) {
  const [ref, width] = useWidth()
  const cardSize = typeof view.options.cardSize === 'number' && view.options.cardSize > 0 ? view.options.cardSize : 200
  const ratio = typeof view.options.imageAspectRatio === 'number' && view.options.imageAspectRatio > 0 ? view.options.imageAspectRatio : 1
  const contain = view.options.imageFit === 'contain'
  const imageKey = typeof view.options.image === 'string' && view.options.image ? normalizePropertyId(view.options.image) : null
  const inner = Math.max(0, width - PADDING * 2)
  const columns = Math.max(1, Math.floor(inner / cardSize))
  const [titleColumn, ...propertyColumns] = view.columns[0]?.key === 'file.name' ? view.columns : [undefined, ...view.columns]
  const [editing, setEditing] = React.useState<{ row: string; column: string } | null>(null)

  const property = (row: BaseRow, column: BaseColumn) => {
    const empty = column.kind === 'note' ? row.raw[column.key] === undefined || row.raw[column.key] === null || !row.hasFrontmatter : row.cells[column.key] === null || row.cells[column.key] === undefined
    const isEditing = editing?.row === row.id && editing.column === column.key
    return (
      <div key={column.key} className="base-card-property">
        <div className="base-card-label">{column.label}</div>
        <div
          className="base-card-value"
          onClick={() => { if (column.kind === 'note' && row.hasFrontmatter && !controller.readonly && row.widgets[column.key] !== 'checkbox') setEditing({ row: row.id, column: column.key }) }}
        >
          {empty && !isEditing ? (
            <span className="base-card-empty">—</span>
          ) : column.kind === 'note' ? (
            <PropertyEditor
              widget={row.widgets[column.key] ?? 'text'}
              value={row.raw[column.key]}
              label={column.label}
              readonly={controller.readonly}
              actions={actions}
              editing={isEditing}
              onEditingChange={(value) => setEditing(value ? { row: row.id, column: column.key } : null)}
              onSave={(value) => controller.editProperty(row.id, displayPropertyId(column.key), value)}
            />
          ) : (
            <CellValue cell={row.cells[column.key]} actions={actions} />
          )}
        </div>
      </div>
    )
  }

  const card = (row: BaseRow) => {
    const cover = imageKey ? coverOf(row.cells[imageKey], row.raw[imageKey], actions.resolveLink) : null
    return (
      <div
        key={row.id}
        className="base-card"
        onContextMenu={(event) => {
          event.preventDefault()
          openMenuAt([
            { id: 'open', label: text('open'), onSelect: () => actions.openFile(row.id) },
            { id: 'open-tab', label: text('openInNewTab'), onSelect: () => void api.workspace.openFile(row.id, undefined, { newTab: true }) },
          ], event.clientX, event.clientY)
        }}
      >
        {imageKey && (
          <div className="base-card-cover" style={{ aspectRatio: `1 / ${ratio}`, background: cover?.color }}>
            {cover?.image && <img src={cover.image} alt="" style={{ objectFit: contain ? 'contain' : 'cover' }} />}
          </div>
        )}
        <div className="base-card-content">
          {titleColumn && (
            <a href="#" className="base-card-title" onClick={(event) => { event.preventDefault(); actions.openFile(row.id, event) }}>
              {cellText(row.cells['file.name'])}
            </a>
          )}
          {propertyColumns.filter(Boolean).map((column) => property(row, column!))}
        </div>
      </div>
    )
  }

  const grid = (list: BaseRow[], key?: string) => (
    <div key={key} className="base-cards-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {list.map(card)}
    </div>
  )
  const visible = new Set(rows.map((row) => row.id))
  const groupLabel = view.groupBy ? view.available.find((column) => column.key === view.groupBy!.property)?.label ?? '' : ''
  return (
    <div ref={ref} className="base-view base-cards-view">
      {view.groups
        ? view.groups.map((group, index) => (
            <div key={index} className="base-cards-group">
              <div className="base-group-heading">
                <span className="base-group-property">{groupLabel}</span>
                <span className="base-group-value">{group.key === null ? text('none') : <CellValue cell={group.key} actions={actions} />}</span>
              </div>
              {grid(group.rowIds.filter((id) => visible.has(id)).map((id) => rows.find((row) => row.id === id)!).filter(Boolean))}
            </div>
          ))
        : grid(rows)}
    </div>
  )
}
