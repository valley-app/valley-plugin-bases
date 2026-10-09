import { WORKSPACE_DETAILS_V1, provideBookmarkSurface, type WorkspaceDetailsSnapshot, type WorkspaceDetailsContext } from '@valley/plugin-sdk'
import { React, currentSession, text, type BaseSession } from './runtime'
import type { BaseController } from './controller'
import { useBaseViewActions } from './viewActions'

type EditorView = { path: string; instanceId?: string; source: boolean; setSource(value: boolean): void; controller?: BaseController }
type SavedView = { v: 1; path: string; viewName: string; search: string; source: boolean }
const sessions = new WeakMap<BaseSession, { views: Set<EditorView>; listeners: Set<() => void>; pending: Map<string, SavedView> }>()
function state(session: BaseSession) {
  let value = sessions.get(session)
  if (!value) { value = { views: new Set(), listeners: new Set(), pending: new Map() }; sessions.set(session, value) }
  return value
}

export function registerEditorDetails(session: BaseSession): () => void {
  const owned = state(session)
  const find = (context: WorkspaceDetailsContext): EditorView | undefined => [...owned.views].find(view =>
    view.path === context.filePath && view.instanceId === context.instanceId)
  const offBookmark = provideBookmarkSurface(session.api, {
    id: 'bases.editor', surface: 'main_workspace',
    subscribe(listener) { owned.listeners.add(listener); return () => { owned.listeners.delete(listener) } },
    getSnapshot(instanceId) {
      session.assertActive()
      const view = [...owned.views].find(view => view.path === instanceId || view.instanceId === instanceId)
      const controller = view?.controller
      if (!view || !controller?.snapshot?.loaded || !controller.view) return { title: 'Bases', view: {} }
      return { title: view.path.split('/').pop() ?? view.path, view: { v: 1, path: view.path, viewName: controller.view.name, search: controller.search, source: view.source } }
    },
    async restore(raw) {
      session.assertActive()
      const saved = raw as SavedView
      if (!(await session.api.vault.fileInfo(saved.path))) throw new Error('Base file is unavailable')
      session.assertActive()
      owned.pending.set(saved.path, saved)
      owned.listeners.forEach(listener => listener())
      session.api.workspace.openFile(saved.path)
    }
  }, {
    stateSchema: { type: 'object', properties: { v: { type: 'literal', value: 1 }, path: { type: 'string' }, viewName: { type: 'string' }, search: { type: 'string' }, source: { type: 'boolean' } }, required: ['v', 'path', 'viewName', 'search', 'source'], additionalProperties: false },
    validate: value => String(value.path).endsWith('.base'),
    description: snapshot => String(snapshot.view.viewName)
  })
  const offDetails = session.api.interop.extensions.provide(WORKSPACE_DETAILS_V1, {
    id: 'bases-editor', label: 'Bases', fileExtensions: ['.base'], pluginViews: false,
    items: [{ id: 'view', label: 'View mode', labelKey: 'bases.viewMode', kind: 'select' }],
    defaultItems: ['view'],
    getSnapshot(context): WorkspaceDetailsSnapshot {
      const view = find(context)
      return { items: view ? { view: {
        value: view.source ? 'source' : 'preview', text: text(view.source ? 'source' : 'view'),
        options: [{ value: 'preview', label: text('view') }, { value: 'source', label: text('source') }],
      } } : {} }
    },
    subscribe(listener) { owned.listeners.add(listener); return () => { owned.listeners.delete(listener) } },
    invoke(context, id, value) {
      if (session.isActive() && id === 'view' && (value === 'source' || value === 'preview')) find(context)?.setSource(value === 'source')
    },
  })
  return () => { offBookmark(); offDetails(); owned.pending.clear() }
}

export function useSourceView(path: string, instanceId: string | undefined, embedded: boolean, controller: BaseController): boolean {
  const session = React.useMemo(currentSession, [])
  const [source, setSource] = React.useState(false)
  useBaseViewActions(controller, { 'view-mode': { effect: 'write', schema: { enum: ['source', 'preview'] }, run: value => setSource(value === 'source') } })
  const view = React.useMemo<EditorView>(() => ({ path, instanceId, source: false, setSource }), [path, instanceId])
  view.controller = controller
  const [revision, refresh] = React.useReducer((value: number) => value + 1, 0)
  React.useEffect(() => {
    const owned = state(session)
    owned.listeners.add(refresh)
    return () => { owned.listeners.delete(refresh) }
  }, [session])
  React.useEffect(() => {
    if (embedded || !controller.snapshot?.loaded) return
    const owned = state(session)
    const saved = owned.pending.get(path)
    if (!saved) return
    const index = controller.doc.views.findIndex(view => view.name === saved.viewName)
    owned.pending.delete(path)
    if (index >= 0) controller.setActive(index)
    controller.setSearch(saved.search)
    controller.setSearchOpen(Boolean(saved.search))
    setSource(saved.source)
  }, [session, path, embedded, controller.snapshot?.loaded, controller.doc, revision])
  React.useEffect(() => {
    if (embedded) return
    const owned = state(session)
    owned.views.add(view)
    owned.listeners.forEach(listener => listener())
    return () => { owned.views.delete(view); owned.listeners.forEach(listener => listener()) }
  }, [session, view, embedded])
  React.useEffect(() => {
    view.source = source
    state(session).listeners.forEach(listener => listener())
  }, [session, view, source, controller.view?.name, controller.search])
  return !embedded && source
}
