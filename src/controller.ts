import { React, currentSession } from './runtime'
import { baseStore } from './store'
import { changeBase } from './files'
import { parseBaseConfiguration, serializeBaseViews, viewSourceIndex, type BaseEditableView } from './configuration'
import { evaluateBase, cellText, displayPropertyId } from './engine/document'
import type { BaseEvaluatedView, BaseRow } from './engine/types'
import { createPropertyMutations } from './propertyMutations'
import type { MountedPluginView } from '@valley/plugin-sdk'

export interface BaseEditorProps {
  relPath: string
  tab?: { id: string }
  thisPath?: string
  viewName?: string
  source?: string
  editableSource?: boolean
  mountedView?: MountedPluginView
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

// Only focused text-entry controls hold unsaved input; a focused cell or button does not.
const editableTarget = (target: EventTarget | null): boolean => { const element = target as HTMLElement | null; return !!element && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) }

export function useBaseController({ relPath, thisPath, viewName, source, editableSource = false, mountedView }: BaseEditorProps) {
  const session = React.useMemo(currentSession, [])
  const api = session.api
  const store = React.useMemo(() => (source === undefined || editableSource ? baseStore(relPath, source, session) : null), [relPath, source, editableSource, session])
  const snapshot = React.useSyncExternalStore(store?.subscribe ?? (() => () => {}), () => store?.snapshot ?? null)
  const editorRoot = React.useRef<HTMLDivElement>(null)
  const draft = React.useMemo(() => ({ active: true, revision: 0, popover: false, inputs: new Set<EventTarget>(), typedInputs: new Set<EventTarget>(), strictAction: false }), [store, mountedView?.mountId, mountedView?.generation])
  const guardInput = React.useCallback((event: React.SyntheticEvent): void => {
    if (!draft.active || store?.isFrozen()) { event.preventDefault(); event.stopPropagation(); return }
    if (event.type === 'focus' && editableTarget(event.target)) draft.inputs.add(event.target)
    if (event.type === 'blur') { draft.inputs.delete(event.target); draft.typedInputs.delete(event.target) }
    if (['input', 'change'].includes(event.type)) draft.typedInputs.add(event.target)
    if (['focus', 'blur', 'input', 'change'].includes(event.type)) { draft.revision++; if (mountedView) store?.notifyEditor() }
  }, [store, draft, mountedView?.mountId, mountedView?.generation])
  const setPopoverDraft = React.useCallback((open: boolean): void => {
    if (!draft.active || store?.isFrozen()) return
    let changed = draft.popover !== open
    // A closing popover's frame is removed without blur, so its inputs would otherwise keep the document dirty.
    if (!open) for (const inputs of [draft.inputs, draft.typedInputs]) for (const input of inputs) if ((input as Node).ownerDocument !== (editorRoot.current?.ownerDocument ?? document)) { inputs.delete(input); changed = true }
    if (changed) { draft.popover = open; draft.revision++; if (mountedView) store?.notifyEditor() }
  }, [store, draft, mountedView?.mountId, mountedView?.generation])
  React.useLayoutEffect(() => {
    // Removing a focused input (a closed search row or popover) fires no blur, so drop inputs that left the page.
    let pruned = false
    for (const inputs of [draft.inputs, draft.typedInputs]) for (const input of inputs) if (!(input as Node).isConnected || !(input as Node).ownerDocument?.defaultView) { inputs.delete(input); pruned = true }
    if (pruned) { draft.revision++; if (mountedView) store?.notifyEditor() }
  })
  React.useEffect(() => {
    draft.active = true
    if (!store || !mountedView) return () => { draft.active = false }
    const off = store.attachEditor(mountedView, () => ({ revision: draft.revision, dirty: draft.popover || draft.inputs.size > 0, active: draft.active }), frozen => {
      if (editorRoot.current) editorRoot.current.inert = frozen
      store.notifyEditor()
    })
    return () => { draft.active = false; off() }
  }, [store, draft, mountedView?.mountId, mountedView?.generation])
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
  const readonly = !store || store.isFrozen() || !snapshot?.file
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
    if (!store || readonly || !session.isActive() || mutations.current?.context !== context) { if (draft.strictAction) throw Object.assign(new Error('The exact Base mutation owner is unavailable.'), { outcome: 'not-applied' }); return }
    if (store.snapshot.revision !== snapshot!.revision) {
      setError('The base changed elsewhere. Reopen its configuration before editing.')
      if (draft.strictAction) throw Object.assign(new Error('The observed Base source changed.'), { outcome: 'not-applied' })
      return
    }
    try {
      store.edit(changeBase(store.snapshot.content, root ? null : viewSourceIndex(config, index), value), true, mountedView)
      setError('')
    } catch (reason) { setError(String(reason)); if (draft.strictAction) throw reason }
  }
  /** Apply a view patch and a root patch as one edit. */
  const patchAll = (viewValue: Record<string, unknown> | null, rootValue: Record<string, unknown> | null): void => {
    if (!store || readonly || !session.isActive() || mutations.current?.context !== context) { if (draft.strictAction) throw Object.assign(new Error('The exact Base mutation owner is unavailable.'), { outcome: 'not-applied' }); return }
    if (store.snapshot.revision !== snapshot!.revision) {
      setError('The base changed elsewhere. Reopen its configuration before editing.')
      if (draft.strictAction) throw Object.assign(new Error('The observed Base source changed.'), { outcome: 'not-applied' })
      return
    }
    try {
      let next = store.snapshot.content
      if (rootValue) next = changeBase(next, null, rootValue)
      if (viewValue) next = changeBase(next, viewSourceIndex(config, index), viewValue)
      store.edit(next, true, mountedView)
      setError('')
    } catch (reason) { setError(String(reason)); if (draft.strictAction) throw reason }
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
  const openFile = async (path: string, event?: { metaKey: boolean; ctrlKey: boolean }): Promise<void> => {
    if (session.isActive() && mutations.current?.context === context) await api.workspace.openFile(path, undefined, { newTab: event ? api.ui.hasModKey(event) : false })
  }
  const newNote = async (strict = false, beforeEffect?: (path: string) => Promise<void>, expectedPath?: string): Promise<void> => {
    const owner = mutations.current?.context === context ? mutations.current.owner : null
    if (!owner || !view) { if (strict) throw Object.assign(new Error('The exact Base note owner is unavailable.'), { outcome: 'not-applied' }); return }
    const noteColumns = view.columns.filter((column) => column.kind === 'note').map((column) => displayPropertyId(column.key))
    try { await owner.newNote([raw.filters, config.filters], relPath, noteColumns, beforeEffect, expectedPath) }
    catch (reason) { if (mutations.current?.owner === owner && session.isActive()) setError(String(reason)); if (strict) throw reason }
  }
  const editProperty = async (path: string, key: string, value: unknown, guard?: { expectedRevision: string; beforeEffect(): Promise<void> }): Promise<void> => {
    const owner = mutations.current?.context === context ? mutations.current.owner : null
    if (!owner) throw new Error('The base editor has closed.')
    try { await owner.editProperty(path, key, value, guard) }
    catch (reason) {
      if (mutations.current?.owner === owner && session.isActive()) setError(String(reason))
      throw reason
    }
  }
  return {
    invokeViewAction: <T,>(run: () => T): T => { draft.strictAction = true; try { return run() } finally { draft.strictAction = false } },
    mountedView,
    viewDraftRevision: draft.revision,
    assertViewCurrent: (allowError = false) => { session.assertActive(); if (!draft.active || !store || store.isFrozen() || !store.snapshot.loaded || !allowError && store.snapshot.error || store.snapshot.revision !== snapshot?.revision) throw Object.assign(new Error('The exact Base editor changed or is unavailable.'), { outcome: 'not-applied' }) },
    assertAutonomousInput: () => { for (const input of draft.typedInputs) if (input instanceof Element && !input.isConnected) draft.typedInputs.delete(input); if (draft.typedInputs.size) throw Object.assign(new Error('Finish or cancel native typing in this Base before using autonomous actions.'), { outcome: 'not-applied' }) },
    api, resolveLink: indexOwner.resolve, store, snapshot, doc, raw, index, view, config, readonly, editorRoot, guardInput, setPopoverDraft,
    editSource: (value: string) => { if (!draft.active) throw new Error('The Base editor has closed.'); store?.edit(value, true, mountedView) },
    flushSource: (beforeSave?: () => Promise<void>) => draft.active ? store?.flush(true, mountedView, beforeSave) : Promise.reject(new Error('The Base editor has closed.')),
    search, setSearch, searchOpen, setSearchOpen, error: error || indexError, setActive,
    patch, patchAll, viewsPatch, setSortProperty, setOrder, setGroupBy, setSummary, setDisplayName,
    rows, available: view?.available ?? [], openFile, newNote, editProperty,
  }
}

export type BaseController = ReturnType<typeof useBaseController>
