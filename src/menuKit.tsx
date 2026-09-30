import { React, api, text } from './runtime'
import { Icon } from './icons'

export function SearchField({ value, onChange, label, placeholder = label, className = '', onKeyDown }: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  className?: string
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
}) {
  const input = React.useRef<HTMLInputElement>(null)
  return (
    <div className={`search-field base-search ${className}`}>
      <Icon name="search" size={16} className="search-field-icon" />
      <input ref={input} autoFocus className="search-field-input" aria-label={label} placeholder={placeholder}
        value={value} spellCheck={false} autoComplete="off" onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && value && !event.nativeEvent.isComposing) {
            event.preventDefault()
            event.stopPropagation()
            onChange('')
          } else onKeyDown?.(event)
        }} />
      {value && <button type="button" className="search-field-action base-search-clear" aria-label={text('clear')} title={text('clear')}
        onClick={() => { onChange(''); input.current?.focus() }}><Icon name="x" size={14} /></button>}
    </div>
  )
}

/** Open a host menu at a pointer position inside this surface. */
export function openMenuAt(items: Parameters<typeof api.ui.openMenu>[0], x: number, y: number): void {
  const marker = document.createElement('span')
  marker.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:0;height:0;pointer-events:none`
  document.body.append(marker)
  void api.ui.openMenu(items, { anchor: marker }).finally(() => marker.remove())
  queueMicrotask(() => setTimeout(() => marker.remove(), 0))
}

export interface PickerOption { value: string; label: string }

/** Compact value button (`label ⌃⌄`) that opens a Valley menu of options. */
export function Picker({ value, options, onChange, label, icon, placeholder, disabled, className }: {
  value: string
  options: PickerOption[]
  onChange: (value: string) => void
  label: string
  icon?: string
  placeholder?: string
  disabled?: boolean
  className?: string
}) {
  const current = options.find((option) => option.value === value)
  return (
    <button
      type="button"
      className={`base-picker${className ? ` ${className}` : ''}${current ? '' : ' is-placeholder'}`}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        void api.ui.openMenu(
          options.map((option) => ({ id: option.value || '(empty)', label: option.label, type: 'radio' as const, checked: option.value === value, onSelect: () => onChange(option.value) })),
          { anchor: event.currentTarget },
        )
      }}
    >
      {icon && <Icon name={icon} size={14} />}
      <span className="base-picker-label">{current?.label ?? placeholder ?? ''}</span>
      <Icon name="chevrons-up-down" size={12} className="base-picker-chevron" />
    </button>
  )
}

export function MenuButton({ icon, label, onClick, disabled, danger, className }: { icon?: string; label: string; onClick: () => void; disabled?: boolean; danger?: boolean; className?: string }) {
  return (
    <button type="button" className={`base-menu-item${danger ? ' is-danger' : ''}${className ? ` ${className}` : ''}`} disabled={disabled} onClick={onClick}>
      {icon && <Icon name={icon} size={16} />}
      <span className="base-menu-item-label">{label}</span>
    </button>
  )
}

export function IconButton({ icon, label, onClick, disabled, className }: { icon: string; label: string; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void; disabled?: boolean; className?: string }) {
  return (
    <button type="button" className={`base-icon-button${className ? ` ${className}` : ''}`} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={16} />
    </button>
  )
}

/** Drag-to-reorder handler set for a vertical list (HTML5 drag and drop). */
export function useReorder(onMove: (from: number, to: number) => void, kind: string) {
  const [over, setOver] = React.useState<number | null>(null)
  const props = (index: number, enabled = true) => enabled ? {
    draggable: true,
    onDragStart: (event: React.DragEvent) => { event.dataTransfer.setData(`text/x-base-${kind}`, String(index)); event.dataTransfer.effectAllowed = 'move' },
    onDragOver: (event: React.DragEvent) => { if (event.dataTransfer.types.includes(`text/x-base-${kind}`)) { event.preventDefault(); setOver(index) } },
    onDragLeave: () => setOver((current) => (current === index ? null : current)),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault()
      setOver(null)
      const from = Number(event.dataTransfer.getData(`text/x-base-${kind}`))
      if (Number.isInteger(from) && from !== index) onMove(from, index)
    },
    'data-drop-target': over === index ? 'true' : undefined,
  } : {}
  return props
}
