import {
  NEW_TAB_ENTRY_V1,
  FILE_TREE_CONTEXT_ITEM_V1,
  type ValleyPluginApi,
  type ValleyPluginModule,
} from '@valley/plugin-sdk'
import { React, initRuntime } from './runtime'
import BaseEditor from './BaseEditor'
import { createBase, EMPTY_BASE } from './files'
import { stores } from './store'
import css from './styles'
import { registerEditorDetails } from './editorViews'
import { initLocalization } from './localization'

export function register(api: ValleyPluginApi): () => Promise<void> {
  const session = initRuntime(api)
  const documents = stores(session)
  initLocalization(api)
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
  api.registerView('bases.editor', BaseEditor)
  const create = (): void => {
    if (!session.isActive()) return
    void api.commands.executeOwn('create')
  }
  const disposers = [
    registerEditorDetails(session),
    api.commands.register({
      id: 'create',
      label: 'Bases: Create new base',
      labelKey: 'bases.command.create',
      sideEffect: 'write',
      revision: ({ folder }: { folder?: string }) => { session.assertActive(); return folder ?? api.getState().activePath },
      preview: ({ folder }) => ({ folder }),
      input: {
        schema: { type: 'object', properties: { folder: { type: 'string' } }, additionalProperties: false },
        parse: (value) => {
          const input = (value ?? {}) as { folder?: string }
          if (input.folder !== undefined && typeof input.folder !== 'string') throw new Error('Expected a folder')
          return input
        },
      },
      run: ({ folder }) => session.run(() => createBase(api, folder, session)),
    }),
    api.interop.extensions.provide(NEW_TAB_ENTRY_V1, {
      id: 'bases:create',
      label: 'New base',
      labelKey: 'bases.create',
      icon: 'table-rows',
      hotkeyCommand: 'create',
      defaultVisible: true,
      run: create,
    }),
    api.interop.extensions.provide(FILE_TREE_CONTEXT_ITEM_V1, {
      id: 'new-base',
      label: 'New base',
      labelKey: 'bases.create',
      icon: 'table-rows',
      directories: true,
      run: async (path) => {
        session.assertActive()
        const index = session.index
        await session.run(() => index.ready())
        session.assertActive()
        const entry = index.entries().find((entry) => entry.relPath === path)
        const folder = entry ? path.slice(0, Math.max(0, path.lastIndexOf('/'))) : path
        await api.commands.executeOwn('create', { folder })
      },
    }),
    api.markdown.registerCodeBlockRenderer(
      'base',
      (code, el, context) =>
        api.ui.renderReact(
          el,
          <BaseEditor editableSource={Boolean(context.path)} relPath={context.path ?? 'Embedded.base'} thisPath={context.path ?? undefined} source={code} />,
        ),
      {
        examples: [
          { id: 'table', label: 'Table of vault files', code: EMPTY_BASE },
          {
            id: 'context',
            label: 'Files in the embedding note’s folder',
            code: 'filters: file.folder == this.file.folder\n' + EMPTY_BASE,
          },
        ],
      },
    ),
    api.runtime.onBeforeUnload(async () => {
      session.assertActive()
      const settled = await Promise.allSettled([session.settle(), ...[...documents.values()].map((store) => store.flush())])
      const failed = settled.find((result) => result.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
    }),
  ]
  return () => {
    const draining = session.dispose()
    disposers.forEach((dispose) => dispose())
    style.remove()
    return draining
  }
}
const plugin: ValleyPluginModule = { register }
export default plugin
