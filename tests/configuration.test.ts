import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { parseBaseConfiguration, serializeBaseViews, viewSourceIndex, filterGroup } from '../src/configuration'
import { changeBase } from '../src/files'
import { evaluateBase } from '../src/engine/document'
import { searchRows } from '../src/controller'

describe('parsed Base configuration', () => {
  it('preserves unknown fields and YAML comments while renaming and reordering views', () => {
    const content = '# Root comment\ncustom: keep\nviews:\n  - name: First # View comment\n    type: table\n    pluginOption: keep\n    columnSize: {file.name: 230}\n  - name: Second\n    type: list\n'
    const config = parseBaseConfiguration(content)
    const edited = [{ ...config.views[1], name: 'Renamed' }, config.views[0]]
    const next = changeBase(content, null, { views: serializeBaseViews(edited, config.originalViews) })
    expect(next).toContain('# Root comment')
    expect(next).toContain('# View comment')
    expect(parse(next)).toMatchObject({ custom: 'keep', views: [{ name: 'Renamed', type: 'list' }, { name: 'First', pluginOption: 'keep', columnSize: { 'file.name': 230 } }] })
  })

  it('retains malformed known fields until those fields are explicitly edited', () => {
    const content = 'views:\n  - name: First\n    type: table\n    sort: broken\n    order: [file.name, 7]\n    columnSize: {file.name: wide}\n'
    const config = parseBaseConfiguration(content)
    expect(config.views[0]).toMatchObject({ order: ['file.name'], columnSize: {} })
    expect(config.views[0].sort).toBeUndefined()
    const next = changeBase(content, null, { views: serializeBaseViews([{ ...config.views[0], name: 'Renamed' }], config.originalViews) })
    expect(parse(next).views[0]).toMatchObject({ sort: 'broken', order: ['file.name', 7], columnSize: { 'file.name': 'wide' } })
    const replaced = changeBase(content, null, { views: serializeBaseViews([{ ...config.views[0], sort: [{ property: 'file.name', direction: 'DESC' }] }], config.originalViews) })
    expect(parse(replaced).views[0].sort).toEqual([{ property: 'file.name', direction: 'DESC' }])
  })

  it('aligns evaluated view positions with their source nodes while retaining unknown entries', () => {
    const content = 'views:\n  - reserved\n  - type: table\n    name: First\n  - null\n  - type: list\n    name: Second\n'
    const config = parseBaseConfiguration(content)
    const doc = evaluateBase(content, 'Test.base', [])
    expect(config.views.map((view) => view.name)).toEqual(doc.views.map((view) => view.name))
    const patched = changeBase(content, viewSourceIndex(config.views[1], 1), { name: 'Selected' })
    expect(parse(patched).views[3].name).toBe('Selected')
    const reordered = changeBase(content, null, { views: serializeBaseViews([...config.views].reverse(), config.originalViews) })
    expect(parse(reordered).views).toEqual(['reserved', { type: 'list', name: 'Second' }, null, { type: 'table', name: 'First' }])
  })

  it.each(['[]', 'views: ['])('handles non-document or malformed YAML %s', (content) => {
    expect(parseBaseConfiguration(content).views).toEqual([])
    expect(evaluateBase(content, 'Test.base', []).issues.length).toBeGreaterThan(0)
  })

  it('opens an empty document with a default table view', () => {
    expect(evaluateBase('null', 'Test.base', []).views.map((view) => [view.type, view.name])).toEqual([['table', 'Table']])
  })

  it('preserves supported scalar negation and grouped filter shapes', () => {
    expect(filterGroup({ not: 'price > 4' })).toEqual({ kind: 'not', items: ['price > 4'] })
    expect(filterGroup({ and: ['price > 4', { or: ['done', 'other'] }] })).toEqual({ kind: 'and', items: ['price > 4', { or: ['done', 'other'] }] })
    expect(filterGroup(null)).toEqual({ kind: 'and', items: [] })
  })

  it('filters only displayed columns and retains all matching rows and their identity', () => {
    const entries = Array.from({ length: 1001 }, (_, index) => ({ relPath: `Note${index}.md`, title: `Note${index}`, kind: 'note' as const, mtimeMs: 1, frontmatter: { shown: index % 2 ? 'Fern' : 'Moss', hidden: 'secret' } }))
    const view = evaluateBase('views:\n  - type: table\n    name: Table\n    order: [shown]\n', 'Test.base', entries).views[0]
    expect(searchRows(view, '')).toBe(view.rows)
    const filtered = searchRows(view, 'FERN')
    expect(filtered).toHaveLength(500)
    expect(filtered.every((row) => view.rows.includes(row))).toBe(true)
    expect(searchRows(view, 'secret')).toEqual([])
    expect(searchRows(undefined, '')).toEqual([])
  })
})
