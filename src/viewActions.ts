import type { MountedPluginView } from '@valley/plugin-sdk'
import type { CommandContext, CommandFileTarget } from '@valley/plugin-sdk/commands'
import { React, currentSession, type BaseSession } from './runtime'
import type { BaseController } from './controller'
import { matchesSchema } from './jsonSchema'

export interface BaseViewAction {
  effect: 'read' | 'write' | 'execute'
  schema: Record<string, unknown>
  state?: unknown
  allowError?: boolean
  fileTargets?(value: any): CommandFileTarget[]
  run(value: any, invocation: { validateBeforeEffect(additionalFiles?: CommandFileTarget[]): Promise<void> }): unknown | Promise<unknown>
}
type Owner = { mounted: MountedPluginView; controller: BaseController; actions: Map<symbol, Record<string, BaseViewAction>>; revision: string; signature: string; busy: boolean; listeners: Set<() => void> }
const owners = new WeakMap<BaseSession, Map<string, Owner>>()
const id = { type: 'string', minLength: 1, maxLength: 256 }
const targetSchema = { type: 'object', additionalProperties: false, required: ['mountId', 'generation', 'area', 'paneId', 'tabId', 'filePath', 'pluginId'], properties: { mountId: id, generation: { type: 'integer', minimum: 0 }, area: { enum: ['main', 'right'] }, paneId: id, tabId: id, filePath: { type: 'string', minLength: 1, maxLength: 32768 }, pluginId: id } }
const revision = (): string => `base-view:${crypto.randomUUID()}`
const notApplied = (message: string): Error => Object.assign(new Error(message), { code: 'REVISION_CONFLICT', outcome: 'not-applied' })
function state(session: BaseSession): Map<string, Owner> { let value = owners.get(session); if (!value) { value = new Map(); owners.set(session, value) }; return value }
function signature(controller: BaseController): string { return JSON.stringify([controller.snapshot?.revision, controller.snapshot?.content, controller.snapshot?.error, controller.index, controller.search, controller.searchOpen, controller.error, controller.viewDraftRevision, controller.readonly, controller.view?.columns.map(column => [column.key, column.kind, column.widget]), controller.rows.map(row => [row.id, row.hasFrontmatter, row.widgets])]) }
const targetKey = (target: MountedPluginView): string => JSON.stringify([target.mountId, target.generation, target.area, target.paneId, target.tabId, target.filePath, target.pluginId])
const files = (target: MountedPluginView, effect: 'read' | 'write'): CommandFileTarget[] => [{ kind: 'file', path: target.filePath, fileOperation: effect }]
function refresh(owner: Owner): void { const next = JSON.stringify([signature(owner.controller), ...[...owner.actions.values()].map(actions => Object.entries(actions).map(([id, action]) => [id, action.state]))]); if (owner.signature !== next) { owner.signature = next; owner.revision = revision() } }
function parse(raw: unknown, observed = false) {
  const schema = { type: 'object', additionalProperties: false, required: observed ? ['target', 'expectedRevision', 'action', 'value'] : ['target'], properties: { target: targetSchema, ...(observed ? { expectedRevision: id, action: id, value: {} } : {}) } }
  if (!matchesSchema(schema, raw)) throw notApplied('Use an exact mounted Base target and strict action arguments.')
  if (new TextEncoder().encode(JSON.stringify(raw)).byteLength > 131072) throw notApplied('Base actions are limited to 128 KiB.')
  return raw as { target: MountedPluginView; expectedRevision: string; action: string; value: unknown }
}
function find(session: BaseSession, target: MountedPluginView, allowError = false): Owner {
  session.assertActive()
  const owner = state(session).get(target.mountId)
  if (!owner || targetKey(owner.mounted) !== targetKey(target)) throw notApplied('The exact Base mount was replaced or closed.')
  owner.controller.assertViewCurrent(allowError)
  refresh(owner)
  return owner
}
function describe(owner: Owner) {
  refresh(owner)
  const actions = Object.assign({}, ...owner.actions.values()) as Record<string, BaseViewAction>
  const result = { target: owner.mounted, revision: owner.revision, contentRevision: owner.controller.snapshot?.revision ?? null, view: owner.controller.index, search: owner.controller.search, source: (owner.controller.snapshot?.content ?? '').slice(0, 32768), sourceTruncated: (owner.controller.snapshot?.content.length ?? 0) > 32768, error: owner.controller.snapshot?.error || owner.controller.error || null, actions: Object.entries(actions).map(([id, action]) => ({ id, effect: action.effect, schema: action.schema, state: action.state ?? null })) }
  if (result.actions.length > 1024 || new TextEncoder().encode(JSON.stringify(result)).byteLength > 262144) throw notApplied('Inspect a smaller Base configuration; complete action descriptions exceed the response limit.')
  return result
}
export function useBaseViewActions(controller: BaseController, actions: Record<string, BaseViewAction>, primary = false): void {
  const session = React.useMemo(currentSession, [])
  const mounted = controller.mountedView
  const token = React.useMemo(() => Symbol(), [])
  const latest = React.useRef({ controller, actions })
  latest.current = { controller, actions }
  React.useLayoutEffect(() => {
    if (!mounted) return
    const map = state(session)
    let owner = map.get(mounted.mountId)
    if (!owner || targetKey(owner.mounted) !== targetKey(mounted)) {
      owner = { mounted, controller: latest.current.controller, actions: new Map(), revision: revision(), signature: signature(latest.current.controller), busy: false, listeners: new Set() }
      map.set(mounted.mountId, owner)
    }
    const captured = owner
    captured.actions.set(token, latest.current.actions)
    captured.revision = revision()
    return () => { captured.actions.delete(token); captured.revision = revision(); if (!captured.actions.size && map.get(mounted.mountId) === captured) map.delete(mounted.mountId) }
  }, [session, mounted?.mountId, mounted?.generation, token])
  React.useLayoutEffect(() => {
    if (!mounted) return
    const owner = state(session).get(mounted.mountId)
    if (owner?.actions.has(token)) {
      const previous = owner.actions.get(token)!
      if (JSON.stringify(Object.entries(previous).map(([id, action]) => [id, action.schema, action.effect])) !== JSON.stringify(Object.entries(actions).map(([id, action]) => [id, action.schema, action.effect]))) owner.revision = revision()
      const changed = primary && owner.controller !== controller
      if (primary) owner.controller = controller
      owner.actions.set(token, actions)
      refresh(owner)
      if (changed) owner.listeners.forEach(listener => listener())
    }
  })
}
export function useLiveBaseController(seed: BaseController): BaseController {
  const session = React.useMemo(currentSession, [])
  const mountId = seed.mountedView?.mountId
  return React.useSyncExternalStore(React.useCallback(listener => {
    const owner = mountId ? state(session).get(mountId) : undefined
    owner?.listeners.add(listener)
    return () => { owner?.listeners.delete(listener) }
  }, [session, mountId]), () => (mountId ? state(session).get(mountId)?.controller : undefined) ?? seed)
}
export function registerBaseViewCommands(session: BaseSession): () => void {
  const outputSchema = { type: 'object', additionalProperties: false, required: ['target', 'revision', 'contentRevision', 'view', 'search', 'source', 'sourceTruncated', 'error', 'actions'], properties: { target: targetSchema, revision: id, contentRevision: { type: ['integer', 'null'] }, view: { type: 'integer', minimum: 0 }, search: { type: 'string' }, source: { type: 'string', maxLength: 32768 }, sourceTruncated: { type: 'boolean' }, error: { type: ['string', 'null'], maxLength: 4096 }, actions: { type: 'array', maxItems: 1024, items: { type: 'object', additionalProperties: false, required: ['id', 'effect', 'schema', 'state'], properties: { id, effect: { enum: ['read', 'write', 'execute'] }, schema: { type: 'object' }, state: {} } } } } }
  const inspect = session.api.commands.register({ id: 'view-inspect', label: 'Bases: inspect exact mounted actions', sideEffect: 'read', paletteSafe: false, input: { schema: { type: 'object', additionalProperties: false, required: ['target'], properties: { target: targetSchema } }, parse: raw => parse(raw) }, outputSchema, recovery: 'observational', idempotent: true, limits: { requestBytes: 131072, responseBytes: 262144 }, fileTargets: input => files(input.target, 'read'), run: input => describe(find(session, input.target, true)) })
  const commands = (['read', 'write', 'execute'] as const).map(effect => session.api.commands.register({
    id: effect === 'read' ? 'view-read' : effect === 'write' ? 'view-action' : 'view-execute', label: 'Bases: use exact mounted action', sideEffect: effect, paletteSafe: false,
    input: { schema: { type: 'object', additionalProperties: false, required: ['target', 'expectedRevision', 'action', 'value'], properties: { target: targetSchema, expectedRevision: id, action: id, value: {} } }, parse: raw => parse(raw, true) },
    outputSchema: { type: 'object', additionalProperties: false, required: ['status', 'state'], properties: { status: { const: 'acknowledged' }, state: outputSchema, result: { anyOf: [{ type: 'object', additionalProperties: false, required: ['row', 'column', 'rawRevision', 'value'], properties: { row: { type: 'string', maxLength: 32768 }, column: id, rawRevision: { type: 'string', maxLength: 65536 }, value: {} } }, { type: 'object', additionalProperties: false, required: ['row', 'column', 'saved'], properties: { row: { type: 'string', maxLength: 32768 }, column: id, saved: { const: true } } }, { type: 'object', additionalProperties: false, required: ['zoom'], properties: { zoom: { type: 'number', minimum: 0, maximum: 24 } } }, { type: 'object', additionalProperties: false, required: ['path'], properties: { path: { type: 'string', minLength: 1, maxLength: 32768 } } }] } } },
    recovery: effect === 'execute' ? 'non-replayable' : 'observational', idempotent: effect === 'read', limits: { requestBytes: 131072, responseBytes: 262144 },
    revisionRequirements: [{ argument: 'expectedRevision', inspectionCommand: 'bases:view-inspect', description: 'Exact mounted Base owner and current document/view state.' }],
    fileTargets: input => { const owner = find(session, input.target, true), action = Object.assign({}, ...owner.actions.values())[input.action] as BaseViewAction | undefined; return [...files(input.target, effect === 'write' ? 'write' : 'read'), ...(action?.fileTargets?.(input.value) ?? [])] },
    revision: input => describe(find(session, input.target, true)),
    preview: input => input,
    run: async (input, context: CommandContext) => {
      const owner = find(session, input.target, true), action = Object.assign({}, ...owner.actions.values())[input.action] as BaseViewAction | undefined
      const assert = (): void => {
        if (context.cancellation?.aborted || state(session).get(input.target.mountId) !== owner || find(session, input.target, !!action?.allowError).revision !== input.expectedRevision || owner.busy) throw notApplied('The Base action target, revision or cancellation changed.')
      }
      assert()
      if (!action || action.effect !== effect) throw notApplied(`Base action ${input.action} is absent in this surface or has another effect.`)
      if (!matchesSchema(action.schema, input.value)) throw notApplied('The Base action value does not match its strict schema.')
      const effectFiles = [...files(input.target, effect === 'write' ? 'write' : 'read'), ...(action.fileTargets?.(input.value) ?? [])]
      if (context.validateBeforeRun && !await context.validateBeforeRun(effectFiles)) throw notApplied('Current authorization denies this Base action.')
      assert()
      owner.controller.assertAutonomousInput()
      describe(owner)
      owner.busy = true
      owner.revision = revision()
      const reservedRevision = owner.revision
      try {
        const result = await owner.controller.invokeViewAction(() => action.run(input.value, { validateBeforeEffect: async (additionalFiles = []) => {
          if (context.validateBeforeRun && !await context.validateBeforeRun([...effectFiles, ...additionalFiles])) throw notApplied('Current authorization denies this Base action.')
          if (context.cancellation?.aborted || state(session).get(input.target.mountId) !== owner || find(session, input.target, !!action.allowError).revision !== reservedRevision) throw notApplied('The exact Base owner, observed state or cancellation changed before the effect.')
          owner.controller.assertViewCurrent(!!action.allowError)
          owner.controller.assertAutonomousInput()
        } }))
        session.assertActive()
        if (state(session).get(input.target.mountId) !== owner) throw new Error('Base owner replaced after dispatch.')
        const value = { status: 'acknowledged', state: describe(owner), ...(result === undefined ? {} : { result }) }; if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 262144) throw new Error('The action result exceeds its response limit.')
        return effect === 'write' ? { value, revert: null } : value
      } catch (cause) {
        if ((cause as { outcome?: string })?.outcome === 'not-applied') throw cause
        throw Object.assign(new Error('The Base action has no confirmed acknowledgement. Inspect its original execution and mounted state; do not replay.'), { code: 'EFFECT_UNVERIFIED', outcome: 'unknown', retryable: false, cause })
      } finally { owner.busy = false }
    }
  }))
  return () => { inspect(); commands.forEach(dispose => dispose()); state(session).clear() }
}

export const noValue = { type: 'null' }
export const stringValue = { type: 'string', maxLength: 65536 }
export const numberValue = (minimum: number, maximum: number) => ({ type: 'number', minimum, maximum })
export const actionValue = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, required, properties })
