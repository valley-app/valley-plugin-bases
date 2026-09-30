import { React, api, text } from '../runtime'
import { openMenuAt } from '../menuKit'
import { CellValue, RichText, type CellActions } from '../cells'
import { cellText, rawCellText } from '../engine/document'
import type { BaseColumn, BaseEvaluatedView, BaseRow } from '../engine/types'

function hasValue(row: BaseRow, column: BaseColumn): boolean {
  if (column.kind === 'note') {
    const raw = row.raw[column.key]
    return row.hasFrontmatter && raw !== null && raw !== undefined && raw !== '' && !(Array.isArray(raw) && !raw.length)
  }
  const cell = row.cells[column.key]
  return cell !== null && cell !== undefined && cell !== '' && !(typeof cell === 'object' && cell.__baseValue === 'list' && !cell.items.length)
}

function PropertyValue({ row, column, actions }: { row: BaseRow; column: BaseColumn; actions: CellActions }) {
  if (column.kind !== 'note') return <CellValue cell={row.cells[column.key]} actions={actions} />
  const widget = row.widgets[column.key] ?? 'text'
  if (widget === 'checkbox') return <input className="base-checkbox" type="checkbox" checked={row.raw[column.key] === true} disabled aria-label={column.label} />
  const shown = rawCellText(widget, row.raw[column.key])
  if (Array.isArray(shown)) return <span className="base-value-list">{shown.map((item, index) => <span key={index} className="base-value-list-item"><RichText value={item} actions={actions} /></span>)}</span>
  return <RichText value={shown} actions={actions} />
}

export function ListView({ view, rows, actions }: { view: BaseEvaluatedView; rows: BaseRow[]; actions: CellActions }) {
  const markers = view.options.markers === 'number' || view.options.markers === 'none' ? view.options.markers : 'bullet'
  const indent = view.options.indentProperties === true
  const separator = typeof view.options.separator === 'string' ? view.options.separator : ', '
  const [first, ...rest] = view.columns
  const item = (row: BaseRow) => {
    const properties = rest.filter((column) => hasValue(row, column))
    const title = first ? (
      first.key === 'file.name' ? (
        <a href="#" className="base-link" onClick={(event) => { event.preventDefault(); actions.openFile(row.id, event) }}>{cellText(row.cells['file.name'])}</a>
      ) : hasValue(row, first) ? <PropertyValue row={row} column={first} actions={actions} /> : null
    ) : null
    return (
      <li
        key={row.id}
        className="base-list-item"
        onContextMenu={(event) => {
          event.preventDefault()
          openMenuAt([
            { id: 'open', label: text('open'), onSelect: () => actions.openFile(row.id) },
            { id: 'open-tab', label: text('openInNewTab'), onSelect: () => void api.workspace.openFile(row.id, undefined, { newTab: true }) },
          ], event.clientX, event.clientY)
        }}
      >
        <span className="base-list-line">
          {title}
          {!indent && properties.map((column, index) => (
            <React.Fragment key={column.key}>
              {(index > 0 || title) && <span className="base-list-separator">{separator}</span>}
              <span className="base-list-property"><PropertyValue row={row} column={column} actions={actions} /></span>
            </React.Fragment>
          ))}
        </span>
        {indent && properties.length > 0 && (
          <ul className="base-list-nested">
            {properties.map((column) => <li key={column.key} className="base-list-property"><PropertyValue row={row} column={column} actions={actions} /></li>)}
          </ul>
        )}
      </li>
    )
  }
  const list = (items: BaseRow[], key?: string) => {
    const Tag = markers === 'number' ? 'ol' : 'ul'
    return <Tag key={key} className={`base-list is-${markers}`}>{items.map(item)}</Tag>
  }
  const visible = new Set(rows.map((row) => row.id))
  const groupLabel = view.groupBy ? view.available.find((column) => column.key === view.groupBy!.property)?.label ?? '' : ''
  return (
    <div className="base-view base-list-view">
      {view.groups
        ? view.groups.map((group, index) => (
            <div key={index} className="base-list-group">
              <div className="base-group-heading">
                <span className="base-group-property">{groupLabel}</span>
                <span className="base-group-value">{group.key === null ? text('none') : <CellValue cell={group.key} actions={actions} />}</span>
              </div>
              {list(group.rowIds.filter((id) => visible.has(id)).map((id) => rows.find((row) => row.id === id)!).filter(Boolean))}
            </div>
          ))
        : list(rows)}
    </div>
  )
}
