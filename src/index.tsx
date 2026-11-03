import {
  NEW_TAB_ENTRY_V1,
  FILE_TREE_CONTEXT_ITEM_V1,
  type ValleyPluginApi,
  type PluginCommand,
  type ValleyPluginModule,
} from '@valley/plugin-sdk'
import { React, initRuntime } from './runtime'
import BaseEditor from './BaseEditor'
import { createBase, EMPTY_BASE } from './files'
import { stores } from './store'
import css from './styles'
import { registerEditorDetails } from './editorViews'
import { registerBaseViewCommands } from './viewActions'
import { initLocalization, uiText } from './localization'

export function register(api: ValleyPluginApi): () => Promise<void> {
  const failureMessage = (error: { message: string; localized?: { key: string; values?: Record<string, unknown> } }): string => {
    const localized = error.localized && api.ui.t(error.localized.key, error.localized.values as Parameters<typeof api.ui.t>[1])
    return localized && localized !== error.localized?.key ? localized : error.message
  }
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
  const registerCreate = (command: PluginCommand<{ folder?: string }, { relPath: string }, 'write'> & { outputSchema: Record<string, unknown> }) => api.commands.register(command)
  const disposers = [
    registerBaseViewCommands(session),
    registerEditorDetails(session),
    registerCreate({
      id: 'create',
      outputSchema: { type: 'object', properties: { relPath: { type: 'string', minLength: 1, maxLength: 4096 } }, required: ['relPath'], additionalProperties: false },
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
        // A file row creates beside the file, a folder row inside it; the vault answers at once, while the index can still be starting.
        const file = await session.run(() => api.vault.fileInfo(path))
        session.assertActive()
        const folder = file ? path.slice(0, Math.max(0, path.lastIndexOf('/'))) : path
        const result = await api.commands.executeOwn('create', { folder })
        if (result.ok || !session.isActive() || result.error.kind === 'cancelled') return
        await api.ui.confirm({ title: uiText('bases.create.failed'), message: failureMessage(result.error), actions: [{ label: uiText('bases.create.close'), value: 'close' }] })
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
