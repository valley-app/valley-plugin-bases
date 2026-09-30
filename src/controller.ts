import { React, currentSession } from './runtime'
import { baseStore } from './store'
import { changeBase } from './files'
import { parseBaseConfiguration, serializeBaseViews, viewSourceIndex, type BaseEditableView } from './configuration'
import { evaluateBase, cellText, displayPropertyId } from './engine/document'
import type { BaseEvaluatedView, BaseRow } from './engine/types'
import { createPropertyMutations } from './propertyMutations'

export interface BaseEditorProps {
  relPath: string
  tab?: { id: string }
  thisPath?: string
  viewName?: string
  source?: string
  editableSource?: boolean
}

function propertyTypes(): Record<string, string> {
  try {
    const value = currentSession().api.settings.core.get('markdownPropertyTypes')
    return value && typeof value === 'object' ? (value as Record<string, string>) : {}
  } catch { return {} }
}

/** Rows whose visible cells contain `search` (case-insensitive). */
export function searchRows(view: BaseEvaluatedView | undefined, search: string): BaseRow[] {
  if (!view) return []
  const query = search.trim().toLowerCase()
  if (!query) return view.rows
  return view.rows.filter((row) => view.columns.some((column) => {
    if (column.kind === 'note') {
      const raw = row.raw[column.key]
      if (raw !== undefined && raw !== null && JSON.stringify(raw).toLowerCase().includes(query)) return true
    }
    return cellText(row.cells[column.key]).toLowerCase().includes(query)
  }))
}

export function useBaseController({ relPath, thisPath, viewName, source, editableSource = false }: BaseEditorProps) {
  const session = React.useMemo(currentSession, [])
  const api = session.api
  const store = React.useMemo(() => (source === undefined || editableSource ? baseStore(relPath, source, session) : null), [relPath, source, editableSource, session])
  const snapshot = React.useSyncExternalStore(store?.subscribe ?? (() => () => {}), () => store?.snapshot ?? null)
  const indexOwner = React.useMemo(() => session.index, [session])
  const [entries, setEntries] = React.useState(indexOwner.entries)
  const [indexError, setIndexError] = React.useState('')
  const [active, setActive] = React.useState(0)
  const [search, setSearch] = React.useState('')
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [error, setError] = React.useState('')
  const [types, setTypes] = React.useState(propertyTypes)
  const content = snapshot?.loaded && snapshot.file ? snapshot.content : source ?? snapshot?.content ?? ''
  const doc = React.useMemo(() => evaluateBase(content, relPath, entries, thisPath, { propertyTypes: types }), [content, relPath, entries, thisPath, types])
  const raw = React.useMemo(() => parseBaseConfiguration(content), [content])
  const requestedView = viewName ? doc.views.findIndex((item) => item.name === viewName) : -1
  const index = Math.min(active, Math.max(0, doc.views.length - 1))
  const view = doc.views[index]
  const config: BaseEditableView = raw.views[index] ?? {}
  const readonly = !store || !snapshot?.file
  const context = React.useMemo(() => ({}), [session, relPath, source])
  const mutations = React.useRef<{ context: object; owner: ReturnType<typeof createPropertyMutations> } | null>(null)
  React.useEffect(() => {
    const owner = createPropertyMutations(session, (path, frontmatter) => {
      setEntries((entries) => entries.map((entry) => (entry.relPath === path ? { ...entry, frontmatter } : entry)))
    })
    mutations.current = { context, owner }
    return () => { mutations.current = null; void owner.dispose() }
  }, [session, context])
  React.useEffect(() => {
    let live = true
    const update = (): void => {
      if (!live || !session.isActive()) return
      setEntries(indexOwner.entries())
      const snapshot = indexOwner.getSnapshot()
      setIndexError(snapshot.status === 'error' ? snapshot.error ?? 'The base index is unavailable.' : '')
    }
    const off = indexOwner.subscribe(update)
    update()
    return () => { live = false; off() }
  }, [indexOwner, session])
  React.useEffect(() => {
    try { return api.settings.core.subscribe(() => setTypes(propertyTypes())) } catch { return undefined }
  }, [api])
  React.useEffect(() => { if (requestedView >= 0) setActive(requestedView) }, [viewName, requestedView])

  /** Merge keys into the active view (or the root with `root`); `undefined` removes a key. */
  const patch = (value: Record<string, unknown>, root = false): void => {
    if (!store || readonly || !session.isActive() || mutations.current?.context !== context) return
    if (store.snapshot.revision !== snapshot!.revision) {
      setError('The base changed elsewhere. Reopen its configuration before editing.')
      return
    }
    try {
      store.edit(changeBase(store.snapshot.content, root ? null : viewSourceIndex(config, index), value))
      setError('')
    } catch (reason) { setError(String(reason)) }
  }
  /** Apply a view patch and a root patch as one edit. */
  const patchAll = (viewValue: Record<string, unknown> | null, rootValue: Record<string, unknown> | null): void => {
    if (!store || readonly || !session.isActive() || mutations.current?.context !== context) return
    if (store.snapshot.revision !== snapshot!.revision) {
      setError('The base changed elsewhere. Reopen its configuration before editing.')
      return
    }
    try {
      let next = store.snapshot.content
      if (rootValue) next = changeBase(next, null, rootValue)
      if (viewValue) next = changeBase(next, viewSourceIndex(config, index), viewValue)
      store.edit(next)
      setError('')
    } catch (reason) { setError(String(reason)) }
  }
  const viewsPatch = (views: BaseEditableView[]): void => patch({ views: serializeBaseViews(views, raw.originalViews) }, true)

  const setSortProperty = (property: string, direction: 'ASC' | 'DESC' | 'NONE' | 'TOGGLE'): void => {
    const current = (view?.sort ?? []).slice()
    const at = current.findIndex((rule) => rule.property === property)
    let next = direction
    if (at >= 0) {
      if (next === 'TOGGLE') next = current[at].direction === 'ASC' ? 'DESC' : 'NONE'
      current.splice(at, 1)
    }
    if (next === 'TOGGLE') next = 'ASC'
    if (next === 'ASC' || next === 'DESC') current.unshift({ property, direction: next })
    patch({ sort: current.length ? current.map((rule) => ({ property: displayPropertyId(rule.property), direction: rule.direction })) : undefined })
  }
  const setOrder = (order: string[]): void => patch({ order: order.map(displayPropertyId) })
  const setGroupBy = (groupBy: { property: string; direction: 'ASC' | 'DESC' } | null): void =>
    patch({ groupBy: groupBy ? { property: displayPropertyId(groupBy.property), direction: groupBy.direction } : undefined })
  const setSummary = (property: string, name: string | null): void => {
    const current: Record<string, string> = { ...(config.summaries ?? {}) }
    const key = displayPropertyId(property)
    for (const existing of Object.keys(current)) if (existing === key || existing === property) delete current[existing]
    if (name) current[key] = name
    patch({ summaries: Object.keys(current).length ? current : undefined })
  }
  const setDisplayName = (property: string, displayName: string): void => {
    const properties = { ...(raw.properties ?? {}) } as Record<string, unknown>
    const entry = { ...((properties[property] as Record<string, unknown>) ?? {}) }
    if (displayName.trim()) entry.displayName = displayName.trim()
    else delete entry.displayName
    if (Object.keys(entry).length) properties[property] = entry
    else delete properties[property]
    patch({ properties: Object.keys(properties).length ? properties : undefined }, true)
  }

  const rows = React.useMemo(() => searchRows(view, search), [view, search])
  const openFile = (path: string, event?: { metaKey: boolean; ctrlKey: boolean }): void => {
    if (session.isActive() && mutations.current?.context === context) void api.workspace.openFile(path, undefined, { newTab: event ? api.ui.hasModKey(event) : false })
  }
  const newNote = async (): Promise<void> => {
    const owner = mutations.current?.context === context ? mutations.current.owner : null
    if (!owner || !view) return
    const noteColumns = view.columns.filter((column) => column.kind === 'note').map((column) => displayPropertyId(column.key))
    try { await owner.newNote([raw.filters, config.filters], relPath, noteColumns) }
    catch (reason) { if (mutations.current?.owner === owner && session.isActive()) setError(String(reason)) }
  }
  const editProperty = async (path: string, key: string, value: unknown): Promise<void> => {
    const owner = mutations.current?.context === context ? mutations.current.owner : null
    if (!owner) throw new Error('The base editor has closed.')
    try { await owner.editProperty(path, key, value) }
    catch (reason) {
      if (mutations.current?.owner === owner && session.isActive()) setError(String(reason))
      throw reason
    }
  }
  return {
    api, resolveLink: indexOwner.resolve, store, snapshot, doc, raw, index, view, config, readonly,
    search, setSearch, searchOpen, setSearchOpen, error: error || indexError, setActive,
    patch, patchAll, viewsPatch, setSortProperty, setOrder, setGroupBy, setSummary, setDisplayName,
    rows, available: view?.available ?? [], openFile, newNote, editProperty,
  }
}

export type BaseController = ReturnType<typeof useBaseController>
