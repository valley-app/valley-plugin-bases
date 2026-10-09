import { React, text, api } from './runtime'
import { useSourceView } from './editorViews'
import { Icon } from './icons'
import { SearchField } from './menuKit'
import { useBaseController, type BaseEditorProps } from './controller'
import { usePopover } from './Popover'
import { FilterMenu, PropertiesMenu, ResultsMenu, SortMenu, ViewsMenu, viewIcon } from './menus'
import { TableView } from './views/TableView'
import { CardsView } from './views/CardsView'
import { ListView } from './views/ListView'
import { MapView } from './views/MapView'
import type { CellActions } from './cells'
import { useBaseViewActions, noValue, stringValue, actionValue } from './viewActions'
import { controllerActions } from './controllerActions'
import { newNoteDefaults } from './files'

function ToolbarButton({ icon, label, onClick, active, showLabel = true, className, disabled, children }: {
  icon?: string
  label: string
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
  active?: boolean
  showLabel?: boolean
  className?: string
  disabled?: boolean
  children?: React.ReactNode
}) {
  return (
    <button
      type="button"
      className={`base-toolbar-button${active ? ' is-active' : ''}${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={showLabel ? undefined : label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon && <Icon name={icon} size={16} />}
      {showLabel && <span className="base-toolbar-label">{label}</span>}
      {children}
    </button>
  )
}

export default function BaseEditor(props: BaseEditorProps) {
  const controller = useBaseController(props)
  const { relPath, source } = props
  const { store, snapshot, doc, view, readonly, search, setSearch, searchOpen, setSearchOpen, error, rows } = controller
  const embedded = source !== undefined || Boolean(props.thisPath && props.thisPath !== relPath)
  const sourceView = useSourceView(relPath, props.tab?.id, embedded, controller)
  const CodeEditor = api.ui.CodeEditor
  const popover = usePopover(controller.guardInput, controller.setPopoverDraft)
  const toolbarRef = React.useRef<HTMLDivElement>(null)
  const noteFolder = newNoteDefaults([controller.raw.filters, controller.config.filters], relPath).folder
  const notePrefix = (noteFolder ? `${noteFolder}/` : '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  useBaseViewActions(controller, {
    ...controllerActions(controller),
    'menu-open': { effect: 'write', schema: { enum: ['views', 'results', 'sort', 'filter', 'properties'] }, state: popover.state?.anchor.getAttribute('aria-label') ?? null, run: value => {
      const names = ['views', 'results', 'sort', 'filter', 'properties']
      const anchor = toolbarRef.current?.querySelectorAll<HTMLButtonElement>('button.base-toolbar-button')[names.indexOf(value)]
      if (!anchor) throw Object.assign(new Error('The Base toolbar is not mounted.'), { outcome: 'not-applied' })
      const render = { views: (close: () => void) => <ViewsMenu controller={controller} close={close} />, results: (close: () => void) => <ResultsMenu controller={controller} close={close} />, sort: () => <SortMenu controller={controller} />, filter: () => <FilterMenu controller={controller} />, properties: () => <PropertiesMenu controller={controller} /> }[value as 'views' | 'results' | 'sort' | 'filter' | 'properties']
      popover.open(anchor, render, { align: value === 'views' || value === 'results' ? 'start' : 'end', className: value === 'filter' ? 'is-wide' : undefined })
    } },
    'search-visibility': { effect: 'write', schema: { type: 'boolean' }, run: value => { if (!value) setSearch(''); setSearchOpen(value) } },
    'search-query': { effect: 'write', schema: stringValue, run: value => setSearch(value) },
    'source-draft-edit': { effect: 'write', schema: stringValue, run: value => controller.editSource(value) },
    'source-save': { effect: 'write', schema: noValue, allowError: true, run: (_, invocation) => controller.flushSource(invocation.validateBeforeEffect) },
    'view-select': { effect: 'write', schema: { type: 'integer', minimum: 0, maximum: Math.max(0, doc.views.length - 1) }, run: value => controller.setActive(value) },
    'new-note': { effect: 'write', schema: actionValue({ path: { ...stringValue, pattern: `^${notePrefix}Untitled(?: [1-9][0-9]{0,2})?\\.md$` }, expectedRevision: { type: 'null' } }), fileTargets: value => [{ kind: 'file', path: value.path, fileOperation: 'write' }], run: (value, invocation) => controller.newNote(true, () => invocation.validateBeforeEffect(), value.path) },
  }, true)
  const [compact, setCompact] = React.useState(false)
  const needed = React.useRef(0)
  const count = view?.type === 'unsupported' ? 0 : rows.length
  React.useLayoutEffect(() => { setCompact(false) }, [view?.name, count])
  React.useLayoutEffect(() => {
    const toolbar = toolbarRef.current
    if (!toolbar) return
    const check = (): void => {
      const width = toolbar.clientWidth
      if (compact) { if (width >= needed.current) setCompact(false); return }
      const labels = toolbar.querySelectorAll<HTMLElement>('.base-toolbar-views .base-toolbar-label, .base-toolbar-count .base-toolbar-label')
      const deficit = Array.from(labels).reduce((sum, label) => sum + Math.max(0, label.scrollWidth - label.clientWidth), 0)
      if (deficit > 1) { needed.current = width + deficit; setCompact(true) }
    }
    check()
    const observer = new ResizeObserver(check)
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [compact, view?.name, count, sourceView])
  const actions: CellActions = React.useMemo(() => ({ resolveLink: controller.resolveLink, openFile: controller.openFile }), [controller.resolveLink, controller.openFile])
  if (source === undefined && !snapshot?.loaded) return <div className="base-surface"><div className="base-empty">{text('loading')}</div></div>
  const openMenu = (event: React.MouseEvent<HTMLElement>, render: (close: () => void) => React.ReactNode, align: 'start' | 'end' = 'start', className?: string): void =>
    popover.open(event.currentTarget, render, { align, className })
  const sortActive = Boolean(view && (view.sort.length || view.groupBy))
  const filterActive = Boolean(view && view.filters !== undefined && view.filters !== null)
  return (
    <div ref={controller.editorRoot} className={`base-surface${embedded ? ' is-embedded' : ''}`} data-base-path={relPath} onInputCapture={controller.guardInput} onChangeCapture={controller.guardInput} onFocusCapture={controller.guardInput} onBlurCapture={controller.guardInput} onPointerDownCapture={controller.guardInput} onKeyDownCapture={controller.guardInput}>
      {!sourceView && view && (
        <div className="base-header">
          <div ref={toolbarRef} className={`base-toolbar${compact ? ' is-compact' : ''}`}>
            <ToolbarButton icon={viewIcon(view.type)} label={view.name} className="base-toolbar-views" onClick={(event) => openMenu(event, (close) => <ViewsMenu controller={controller} close={close} />)}>
              <Icon name="chevrons-up-down" size={14} className="base-toolbar-aux" />
            </ToolbarButton>
            <ToolbarButton label={text(count === 1 ? 'resultOne' : 'resultMany', { count })} className="base-toolbar-count" active={Boolean(view.limit)}
              onClick={(event) => openMenu(event, (close) => <ResultsMenu controller={controller} close={close} />)} />
            <span className="base-toolbar-spacer" />
            <ToolbarButton icon="arrow-up-down" label={text('sort')} active={sortActive} onClick={(event) => openMenu(event, () => <SortMenu controller={controller} />, 'end')} />
            <ToolbarButton icon="list-filter" label={text('filter')} active={filterActive} onClick={(event) => openMenu(event, () => <FilterMenu controller={controller} />, 'end', 'is-wide')} />
            <ToolbarButton icon="list" label={text('properties')} onClick={(event) => openMenu(event, () => <PropertiesMenu controller={controller} />, 'end')} />
            <ToolbarButton icon="search" label={text('search')} active={searchOpen} onClick={() => { if (searchOpen) setSearch(''); setSearchOpen(!searchOpen) }} />
            <ToolbarButton icon="plus" label={text('new')} disabled={readonly} onClick={() => void controller.newNote()} />
          </div>
        </div>
      )}
      {!sourceView && searchOpen && view && (
        <div className="base-search-row search-field-row">
          <SearchField label={text('search')} placeholder={text('searchPlaceholder')} value={search} onChange={setSearch}
            onKeyDown={(event) => { if (event.key === 'Escape') setSearchOpen(false) }} />
          <span className="base-search-count">{text('showingCount', { count })}</span>
        </div>
      )}
      {(snapshot?.error || error) && (
        <div className="base-error" role="alert">
          <p>{snapshot?.error || error}</p>
          {snapshot?.file && <button type="button" className="base-toolbar-button" onClick={() => void controller.flushSource()?.catch(() => {})}>{text('retry')}</button>}
        </div>
      )}
      {sourceView && <div className="base-source-editor" data-plugin-widget-layout="fill"><CodeEditor value={snapshot?.content ?? ''} relPath={relPath} language="yaml" readOnly={readonly} ariaLabel={text('sourceEditor')} onChange={controller.editSource} onSave={async () => { if (!store || readonly) return false; try { await controller.flushSource(); return true } catch { return false } }} /></div>}
      {!sourceView && doc.parseError && <div className="base-error" role="alert"><p>{text('unableToParse')}</p><p>{doc.issues[0]}</p></div>}
      {!sourceView && !doc.parseError && doc.issues.map((issue, index) => <div className="base-error" role="alert" key={index}><p>{issue}</p></div>)}
      {!sourceView && view && view.type === 'unsupported' && <div className="base-error" role="alert"><p>{view.message}</p></div>}
      {!sourceView && view && view.type === 'table' && <TableView controller={controller} view={view} rows={rows} actions={actions} />}
      {!sourceView && view && view.type === 'cards' && <CardsView controller={controller} view={view} rows={rows} actions={actions} />}
      {!sourceView && view && view.type === 'list' && <ListView view={view} rows={rows} actions={actions} />}
      {!sourceView && view && view.type === 'map' && <MapView controller={controller} view={view} rows={rows} actions={actions} embedded={embedded} />}
      {popover.node}
    </div>
  )
}
