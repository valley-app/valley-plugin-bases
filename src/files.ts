import { parseDocument, parse, isMap, isSeq } from 'yaml'
import { guardedCreatedFileRevert, type ValleyPluginApi } from '@valley/plugin-sdk'
import { normalizeRelPathOpt } from '@valley/plugin-sdk/paths'
import type { BaseSession } from './runtime'
export const EMPTY_BASE = 'views:\n  - type: table\n    name: Table\n    order:\n      - file.name\n'
export function changeBase(content: string, view: number | null, patch: Record<string, unknown>): string {
  const doc = parseDocument(content)
  if (doc.errors.length || !isMap(doc.contents)) throw new Error('Invalid base YAML')
  const views = doc.get('views')
  const target = view === null ? doc.contents : isSeq(views) ? views.items[view] : null
  if (!isMap(target)) throw new Error('The view no longer exists')
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null) target.delete(key)
    else target.set(key, doc.createNode(value))
  }
  return doc.toString()
}
export async function createBase(api: ValleyPluginApi, folder?: string, session?: BaseSession) {
  session?.assertActive()
  const active = api.getState().activePath ?? ''
  const parent = folder ?? (active.includes('/') ? active.slice(0, active.lastIndexOf('/')) : '')
  if (parent && normalizeRelPathOpt(parent) !== parent) throw new Error('Expected a vault folder')
  for (let n = 0; n < 1000; n++) {
    session?.assertActive()
    const relPath = `${parent ? `${parent}/` : ''}Untitled${n ? ` ${n}` : ''}.base`
    const result = await api.vault.writeFileGuarded(relPath, EMPTY_BASE, null)
    if (result.ok) {
      if (!session || session.isActive()) await api.workspace.openFile(relPath)
      const guardedVault = session ? {
        ...api.vault,
        readFileBaseline: (...args: Parameters<typeof api.vault.readFileBaseline>) => { session.assertActive(); return api.vault.readFileBaseline(...args) },
        writeFileGuarded: (...args: Parameters<typeof api.vault.writeFileGuarded>) => { session.assertActive(); return api.vault.writeFileGuarded(...args) },
        trashFileGuarded: (...args: Parameters<typeof api.vault.trashFileGuarded>) => { session.assertActive(); return api.vault.trashFileGuarded(...args) },
        restoreTrashed: (...args: Parameters<typeof api.vault.restoreTrashed>) => { session.assertActive(); return api.vault.restoreTrashed(...args) }
      } : api.vault
      const revert = guardedCreatedFileRevert(guardedVault, relPath, EMPTY_BASE, result.baseline, 'Create base')
      return {
        value: { relPath },
        revert: session ? { ...revert, run: (...args: Parameters<typeof revert.run>) => session.run(() => revert.run(...args)), reapply: (...args: Parameters<NonNullable<typeof revert.reapply>>) => session.run(() => revert.reapply!(...args)) } : revert,
      }
    }
    session?.assertActive()
    if (result.reason === 'error') throw new Error('Could not create base')
  }
  throw new Error('No free base filename')
}

export function newNoteDefaults(
  filters: unknown[],
  relPath: string,
): { folder: string; properties: Record<string, unknown> } {
  let folder = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : ''
  const properties: Record<string, unknown> = {}
  const visit = (filter: unknown): void => {
    if (Array.isArray(filter)) {
      filter.forEach(visit)
      return
    }
    if (filter && typeof filter === 'object' && 'and' in filter) {
      visit(filter.and)
      return
    }
    if (typeof filter !== 'string') return
    const equality =
      /^\s*(?:note\.)?([\w-]+|file\.folder)\s*==\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|true|false|[-+]?\d+(?:\.\d+)?)\s*$/.exec(
        filter,
      )
    if (equality) {
      const value = parse(equality[2])
      if (equality[1] === 'file.folder') {
        if (typeof value === 'string' && (!value || normalizeRelPathOpt(value) === value)) folder = value
      } else if (!['constructor', 'prototype', '__proto__'].includes(equality[1])) properties[equality[1]] = value
    }
    const inside = /^\s*file\.inFolder\(("[^"\n]+"|'[^'\n]+')\)\s*$/.exec(filter)
    if (inside) {
      const value = parse(inside[1])
      if (typeof value === 'string' && normalizeRelPathOpt(value) === value) folder = value
    }
    const tag = /^\s*file\.hasTag\(("[^"\n]+"|'[^'\n]+')\)\s*$/.exec(filter)
    if (tag) {
      const tags = Array.isArray(properties.tags) ? properties.tags : []
      properties.tags = [...new Set([...tags, String(parse(tag[1])).replace(/^#/, '')])]
    }
  }
  filters.forEach(visit)
  return { folder, properties }
}

export function replaceInlineBase(content: string, previous: string, next: string): string {
  const normalized = (value: string): string => value.replace(/\r\n/g, '\n').trimEnd()
  const blocks = [...content.matchAll(/^([ \t]{0,3})(`{3,}|~{3,})base[^\r\n]*\r?\n([\s\S]*?)^\1\2[ \t]*(?=\r?$)/gm)]
    .filter((match) => normalized(match[3]) === normalized(previous))
  if (blocks.length !== 1) throw new Error('The inline base changed or cannot be identified uniquely. Your draft is preserved.')
  const match = blocks[0]
  const start = match.index! + match[0].indexOf('\n') + 1
  const end = start + match[3].length
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  return content.slice(0, start) + normalized(next).replace(/\n/g, newline) + newline + content.slice(end)
}
