import { normalizeLinkPreferences, parseLinkUrl, recognizeLinkValue } from '@valley/plugin-sdk/linkTargets'
import DOMPurify from 'dompurify'
import { assetUrlForRelPath } from '@valley/plugin-sdk/fileTypes'
import { React, api, text } from './runtime'
import { Icon } from './icons'
import type { BaseCell } from './engine/types'

export interface CellActions {
  resolveLink: (reference: string) => string | null
  openFile: (path: string, event?: React.MouseEvent) => void
}

const pad = (value: number): string => String(value).padStart(2, '0')
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Format with Valley's General → Date format pattern (dd, mm, mmm, yyyy, ddd…). */
export function formatDate(date: Date, pattern: string): string {
  return pattern.replace(/dddd|ddd|dd|d|mmmm|mmm|mm|m|yyyy|yy/gi, (token) => {
    switch (token.toLowerCase()) {
      case 'dddd': return DAYS[date.getDay()]
      case 'ddd': return DAYS[date.getDay()].slice(0, 3)
      case 'dd': return pad(date.getDate())
      case 'd': return String(date.getDate())
      case 'mmmm': return MONTHS[date.getMonth()]
      case 'mmm': return MONTHS[date.getMonth()].slice(0, 3)
      case 'mm': return pad(date.getMonth() + 1)
      case 'm': return String(date.getMonth() + 1)
      case 'yyyy': return String(date.getFullYear())
      case 'yy': return String(date.getFullYear()).slice(-2)
    }
    return token
  })
}

export function formatTime(date: Date): string {
  const twelve = api.getState().timeFormat === '12h'
  const seconds = date.getSeconds() ? `:${pad(date.getSeconds())}` : ''
  if (!twelve) return `${pad(date.getHours())}:${pad(date.getMinutes())}${seconds}`
  const hours = date.getHours() % 12 || 12
  return `${hours}:${pad(date.getMinutes())}${seconds} ${date.getHours() < 12 ? 'AM' : 'PM'}`
}

/** Parse `YYYY-MM-DD` / `YYYY-MM-DDTHH:mm[:ss]` as a local date. */
export function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value)
  if (!match) return null
  const date = new Date(+match[1], +match[2] - 1, +match[3], +(match[4] ?? 0), +(match[5] ?? 0), +(match[6] ?? 0))
  return Number.isNaN(date.getTime()) ? null : date
}

export function displayDate(value: string, time: boolean): string {
  const date = parseLocalDate(value)
  if (!date) return value
  const day = formatDate(date, api.getState().dateFormat || 'yyyy-mm-dd')
  return time ? `${day} ${formatTime(date)}` : day
}

function InternalLink({ label, target, actions, unresolved }: { label: string; target: string | null; actions: CellActions; unresolved?: boolean }) {
  return (
    <a
      href="#"
      className={unresolved ? 'base-link is-unresolved' : 'base-link'}
      data-base-link={target ?? ''}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (target) actions.openFile(target, event)
      }}
    >
      {label}
    </a>
  )
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href="#"
      className="base-link is-external"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (parseLinkUrl(href)) void api.links.open(href)
      }}
    >
      {label}
    </a>
  )
}

function PlainValues({ value }: { value: string }) {
  const preferences = normalizeLinkPreferences(api.settings.core.get('linkActions'))
  const parts: React.ReactNode[] = []
  let copied = 0
  for (const match of value.matchAll(/(^|[\s(])(?=[+\p{L}\d])/gu)) {
    const from = match.index! + match[0].length
    if (from < copied) continue
    const link = recognizeLinkValue(value.slice(from), api.getState().dateFormat)
    if (!link || !preferences[link.target.category].recognize) continue
    parts.push(value.slice(copied, from), <span key={from} className="base-link is-external" role="link" tabIndex={0}
      onClick={event => { event.stopPropagation(); if (!event.shiftKey && !event.altKey && event.currentTarget.ownerDocument.getSelection()?.isCollapsed !== false) void api.links.open(link.target) }}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.altKey) { event.preventDefault(); event.stopPropagation(); void api.links.open(link.target) } }}
    >{value.slice(from, from + link.length)}</span>)
    copied = from + link.length
  }
  parts.push(value.slice(copied))
  return <>{parts}</>
}

/** Inline text with wikilinks and web links rendered as links. */
export function RichText({ value, actions }: { value: string; actions: CellActions }) {
  const parts: React.ReactNode[] = []
  const pattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|(https?:\/\/[^\s)]+)/g
  let last = 0
  for (const match of value.matchAll(pattern)) {
    if (match.index! > last) parts.push(<PlainValues key={`text:${last}`} value={value.slice(last, match.index)} />)
    if (match[3]) parts.push(<ExternalLink key={match.index} href={match[3]} label={match[3]} />)
    else {
      const target = actions.resolveLink(match[1].split('#')[0])
      parts.push(<InternalLink key={match.index} label={match[2] ?? match[1]} target={target} unresolved={!target} actions={actions} />)
    }
    last = match.index! + match[0].length
  }
  if (last < value.length) parts.push(<PlainValues key={`text:${last}`} value={value.slice(last)} />)
  return <>{parts}</>
}

/** Read-only rendering of an evaluated value. */
export function CellValue({ cell, actions }: { cell: BaseCell | undefined; actions: CellActions }): React.ReactElement | null {
  if (cell === null || cell === undefined) return null
  if (typeof cell === 'boolean') return <input className="base-checkbox" type="checkbox" checked={cell} disabled aria-label={String(cell)} />
  if (typeof cell === 'number') return <span className="base-value-number">{String(cell)}</span>
  if (typeof cell === 'string') return <span className="base-value-text">{cell}</span>
  switch (cell.__baseValue) {
    case 'error':
      return (
        <span className="base-formula-error" title={cell.message}>
          <Icon name="triangle-alert" size={14} />
          <span className="base-formula-error-message">{cell.message}</span>
        </span>
      )
    case 'link': {
      const label = cell.display ?? (cell.path ? cell.link.split('/').pop()!.replace(/\.md$/i, '') : cell.link)
      return <InternalLink label={cell.display ?? (cell.link.includes('/') ? cell.link : label)} target={cell.path} unresolved={!cell.path} actions={actions} />
    }
    case 'url': return <ExternalLink href={cell.value} label={cell.display ?? cell.value} />
    case 'file': return <InternalLink label={cell.name} target={cell.path} actions={actions} />
    case 'image': {
      const src = cell.path ? assetUrlForRelPath(cell.path) : /^(https?:|data:)/i.test(cell.value) ? cell.value : null
      return src ? <img className="base-value-image" src={src} alt="" /> : null
    }
    case 'html':
      return <span className="base-value-html" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(cell.value, { USE_PROFILES: { html: true } }) }} />
    case 'icon': return <span className="base-value-icon"><Icon name={cell.value} /></span>
    case 'tag': return <span className="base-tag">{cell.value.replace(/^#/, '')}</span>
    case 'number': return <span className="base-value-number">{cell.text}</span>
    case 'list':
      return (
        <span className="base-value-list">
          {cell.items.map((item, index) => (
            <span key={index} className="base-value-list-item"><CellValue cell={item} actions={actions} /></span>
          ))}
        </span>
      )
    case 'date': return <span className="base-value-date">{displayDate(cell.value, cell.time)}</span>
    case 'duration': case 'relative': case 'object': return <span className="base-value-text">{cell.text}</span>
    case 'regexp': return <span className="base-value-text">{cell.value}</span>
  }
  return null
}

// ---- Property editors --------------------------------------------------------------

export interface PropertyEditorProps {
  widget: string
  value: unknown
  label: string
  readonly: boolean
  actions: CellActions
  onSave: (value: unknown) => Promise<void>
  /** Focus request from the grid (Enter / click on the cell). */
  editing: boolean
  onEditingChange: (editing: boolean) => void
}

const jsonText = (value: unknown): string => (typeof value === 'string' ? value : value === null || value === undefined ? '' : JSON.stringify(value))

function useCommit(onSave: (value: unknown) => Promise<void>) {
  const [error, setError] = React.useState('')
  const commit = (value: unknown): void => { void onSave(value).then(() => setError(''), (reason) => setError(String(reason instanceof Error ? reason.message : reason))) }
  return { error, commit }
}

function TextEditor({ value, label, readonly, actions, onSave, editing, onEditingChange, numeric }: PropertyEditorProps & { numeric?: boolean }) {
  const { error, commit } = useCommit(onSave)
  const [draft, setDraft] = React.useState('')
  const [invalid, setInvalid] = React.useState(false)
  const cancelled = React.useRef(false)
  React.useEffect(() => { if (editing) { setDraft(jsonText(value)); setInvalid(false); cancelled.current = false } }, [editing])
  const isInvalidNumber = (current: string): boolean => current.trim() !== '' && !Number.isFinite(Number(current.trim()))
  const finish = (current: string): void => {
    onEditingChange(false)
    if (cancelled.current) return
    if (numeric) {
      const trimmed = current.trim()
      if (trimmed === '') { if (value !== null && value !== undefined) commit(null); return }
      if (isInvalidNumber(trimmed)) return
      const next = Number(trimmed)
      if (next !== value) commit(next)
      return
    }
    if (current !== jsonText(value)) commit(current === '' && (value === null || value === undefined) ? value : current)
  }
  if (editing && !readonly)
    return (
      <>
        <input
          className={numeric ? 'base-cell-input is-number' : 'base-cell-input'}
          autoFocus
          type="text"
          inputMode={numeric ? 'decimal' : undefined}
          aria-label={label}
          aria-invalid={invalid || undefined}
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setInvalid(false) }}
          onBlur={(event) => finish(event.currentTarget.value)}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter') {
              event.preventDefault()
              if (numeric && isInvalidNumber(event.currentTarget.value)) { setInvalid(true); return }
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') { event.preventDefault(); cancelled.current = true; event.currentTarget.blur() }
          }}
        />
        {invalid && <span className="base-visually-hidden" role="alert">{text('invalidNumber')}</span>}
      </>
    )
  const shown = value === null || value === undefined ? '' : typeof value === 'string' ? value : typeof value === 'number' ? String(value) : JSON.stringify(value)
  return (
    <span className={numeric ? 'base-cell-text is-number' : 'base-cell-text'} title={error || undefined} data-invalid={error ? 'true' : undefined}>
      {numeric ? shown : <RichText value={shown} actions={actions} />}
    </span>
  )
}

function CheckboxEditor({ value, label, readonly, onSave }: PropertyEditorProps) {
  const { error, commit } = useCommit(onSave)
  const indeterminate = value === null || value === undefined
  return (
    <input
      ref={(element) => { if (element) element.indeterminate = indeterminate }}
      className="base-checkbox"
      type="checkbox"
      aria-label={label}
      title={error || undefined}
      checked={value === true}
      disabled={readonly}
      onClick={(event) => event.stopPropagation()}
      onChange={() => commit(!(value === true))}
    />
  )
}

function DateEditor({ widget, value, label, readonly, onSave, editing, onEditingChange }: PropertyEditorProps) {
  const { error, commit } = useCommit(onSave)
  const time = widget === 'datetime'
  const raw = typeof value === 'string' ? value : ''
  if (editing && !readonly) {
    const inputValue = time ? raw.replace(' ', 'T').slice(0, 16) : raw.slice(0, 10)
    return (
      <input
        className="base-cell-input"
        autoFocus
        type={time ? 'datetime-local' : 'date'}
        aria-label={label}
        defaultValue={inputValue}
        onBlur={(event) => {
          onEditingChange(false)
          const next = event.target.value
          if (next !== inputValue) commit(next || null)
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
          if (event.key === 'Escape') { event.preventDefault(); onEditingChange(false) }
        }}
      />
    )
  }
  return (
    <span className="base-cell-text" title={error || undefined}>
      {raw ? <><Icon name={time ? 'clock' : 'calendar'} size={13} className="base-date-icon" />{displayDate(raw, time)}</> : null}
    </span>
  )
}

function ListEditor({ widget, value, label, readonly, actions, onSave, editing, onEditingChange }: PropertyEditorProps) {
  const { error, commit } = useCommit(onSave)
  const items = (Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : [value]).filter((item) => item !== null && item !== undefined)
  const [draft, setDraft] = React.useState('')
  const tags = widget === 'tags'
  const save = (next: unknown[]): void => commit(next.length ? next : null)
  const add = (): void => {
    const entry = draft.trim().replace(tags ? /^#/ : /^$/, '')
    setDraft('')
    if (entry && !items.map(String).includes(entry)) save([...items, entry])
  }
  return (
    <span className="base-pills" title={error || undefined}>
      {items.map((item, index) => (
        <span key={`${index}:${String(item)}`} className={tags ? 'base-pill is-tag' : 'base-pill'}>
          <span className="base-pill-label">{tags ? String(item).replace(/^#/, '') : <RichText value={String(item)} actions={actions} />}</span>
          {!readonly && (
            <button
              type="button"
              className="base-pill-remove"
              aria-label={`${text('remove')} ${String(item)}`}
              onClick={(event) => { event.stopPropagation(); save(items.filter((_, i) => i !== index)) }}
            >
              <Icon name="x" size={12} />
            </button>
          )}
        </span>
      ))}
      {editing && !readonly && (
        <input
          className="base-pill-input"
          autoFocus
          aria-label={label}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => { add(); onEditingChange(false) }}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add() }
            if (event.key === 'Backspace' && !draft && items.length) save(items.slice(0, -1))
            if (event.key === 'Escape') { event.preventDefault(); setDraft(''); onEditingChange(false) }
          }}
        />
      )}
    </span>
  )
}

/** Editor for a note property cell, chosen by the cell's widget. */
export function PropertyEditor(props: PropertyEditorProps) {
  switch (props.widget) {
    case 'checkbox': return <CheckboxEditor {...props} />
    case 'number': return <TextEditor {...props} numeric />
    case 'date': case 'datetime': return <DateEditor {...props} />
    case 'multitext': case 'tags': case 'aliases': return <ListEditor {...props} />
    case 'unknown': return <span className="base-cell-text">{jsonText(props.value)}</span>
  }
  return <TextEditor {...props} />
}
