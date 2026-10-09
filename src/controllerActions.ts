import type { BaseController } from './controller'
import type { BaseEditableView } from './configuration'
import { cellText, displayPropertyId, normalizePropertyId, rawCellText } from './engine/document'
import { summaryNamesFor } from './summaries'
import { actionValue, noValue, numberValue, stringValue, type BaseViewAction } from './viewActions'

const integer = (maximum = 10000) => ({ type: 'integer', minimum: 0, maximum })
const strings = { type: 'array', maxItems: 256, uniqueItems: true, items: { type: 'string', maxLength: 256 } }
const name = { type: 'string', minLength: 1, maxLength: 256 }
const choices = (values: string[]) => values.length ? { enum: [...new Set(values)] } : { not: {} }
const direction = { enum: ['ASC', 'DESC'] }
const write = (schema: Record<string, unknown>, run: BaseViewAction['run']): BaseViewAction => ({ effect: 'write', schema, run })
const execute = (schema: Record<string, unknown>, run: BaseViewAction['run']): BaseViewAction => ({ effect: 'execute', schema, run })
const fail = (message: string): never => { throw Object.assign(new Error(message), { outcome: 'not-applied' }) }

export function controllerActions(controller: BaseController, configureIndex = controller.index): Record<string, BaseViewAction> {
  const views = controller.raw.views
  const at = (index: number): BaseEditableView => views[index] ?? fail('The requested Base view is absent.')
  const rename = (index: number, name: string) => {
    if (!name.trim() || views.some((view, other) => other !== index && view.name === name.trim())) fail('Base view names must be nonempty and unique.')
    at(index)
    controller.viewsPatch(views.map((view, other) => other === index ? { ...view, name: name.trim() } : view))
  }
  const property = (key: string): string => controller.available.find(column => column.key === key || displayPropertyId(column.key) === key)?.key ?? fail('The requested Base property is absent.')
  const sort = controller.view?.sort ?? []
  const sortAt = (index: number) => sort[index] ?? fail('The requested sort rule is absent.')
  const saveSort = (next: typeof sort) => controller.patch({ sort: next.length ? next.map(rule => ({ ...rule, property: displayPropertyId(rule.property) })) : undefined })
  const table = () => baseResultTable(controller)
  const actions: Record<string, BaseViewAction> = {
    'view-rename': write(actionValue({ index: integer(), name }), value => rename(value.index, value.name)),
    'view-add': write(actionValue({ name, type: { enum: ['table', 'cards', 'list', 'map'] } }), value => {
      if (views.some(view => view.name === value.name)) fail('The Base view name already exists.')
      controller.viewsPatch([...views, { name: value.name, type: value.type, order: ['file.name'] }]); controller.setActive(views.length)
    }),
    'view-reorder': write(actionValue({ from: integer(), to: integer() }), value => { at(value.from); at(value.to); const next = [...views]; next.splice(value.to, 0, next.splice(value.from, 1)[0]); controller.viewsPatch(next); if (controller.index === value.from) controller.setActive(value.to) }),
    'view-default': write(integer(), value => { at(value); const next = [...views]; next.unshift(next.splice(value, 1)[0]); controller.viewsPatch(next); controller.setActive(0) }),
    'view-duplicate': write(actionValue({ index: integer(), name }), value => { const source = at(value.index); if (views.some(view => view.name === value.name)) fail('The Base view name already exists.'); controller.viewsPatch([...views, { ...source, name: value.name }]); controller.setActive(views.length) }),
    'view-delete': write(integer(), value => { at(value); const next = views.filter((_, index) => index !== value); controller.viewsPatch(next); controller.setActive(Math.max(0, Math.min(value - 1, next.length - 1))) }),
    'results-limit': write({ anyOf: [noValue, { type: 'integer', minimum: 1, maximum: 1000000 }] }, value => controller.patch({ limit: value ?? undefined })),
    'results-show-all': write(noValue, () => controller.patch({ limit: undefined })),
    'group-property': write(choices(controller.available.filter(column => !['file.file', 'file.path', 'file.ctime', 'file.mtime', 'file.name', 'file.fullname', 'file.basename'].includes(column.key) && column.widget !== 'aliases').map(column => column.key)), value => controller.setGroupBy({ property: property(value), direction: controller.view?.groupBy?.direction ?? 'ASC' })),
    'group-direction': write(direction, value => { const group = controller.view?.groupBy; if (!group) return fail('No Base group is selected.'); controller.setGroupBy({ property: group.property, direction: value }) }),
    'group-remove': write(noValue, () => controller.setGroupBy(null)),
    'sort-add': write(actionValue({ property: name, direction }), value => saveSort([...sort, { property: property(value.property), direction: value.direction }])),
    'sort-property': write(actionValue({ index: integer(), property: name }), value => { sortAt(value.index); saveSort(sort.map((rule, index) => index === value.index ? { ...rule, property: property(value.property) } : rule)) }),
    'sort-direction': write(actionValue({ index: integer(), direction }), value => { sortAt(value.index); saveSort(sort.map((rule, index) => index === value.index ? { ...rule, direction: value.direction } : rule)) }),
    'sort-remove': write(integer(), value => { sortAt(value); saveSort(sort.filter((_, index) => index !== value)) }),
    'sort-reorder': write(actionValue({ from: integer(), to: integer() }), value => { sortAt(value.from); sortAt(value.to); const next = [...sort]; next.splice(value.to, 0, next.splice(value.from, 1)[0]); saveSort(next) }),
    'property-order': write(strings, value => { value.forEach(property); controller.setOrder(value) }),
    'property-visibility': write(actionValue({ property: name, visible: { type: 'boolean' } }), value => { const key = property(value.property), order = controller.view?.columns.map(column => column.key) ?? []; controller.setOrder(value.visible ? [...new Set([...order, key])] : order.filter(item => item !== key)) }),
    'properties-hide-all': write(noValue, () => controller.setOrder([])),
    'property-display-name': write(actionValue({ property: name, name: stringValue }), value => controller.setDisplayName(displayPropertyId(property(value.property)), value.name)),
    'column-width': write(actionValue({ property: name, width: numberValue(40, 100000) }), value => controller.patch({ columnSize: { ...controller.config.columnSize, [property(value.property)]: value.width } })),
    'column-summary': write(actionValue({ property: name, summary: { anyOf: [noValue, { enum: [...new Set([...controller.available.flatMap(column => summaryNamesFor(controller.rows.map(row => row.cells[column.key]))), ...Object.keys(controller.raw.summaries ?? {})])] }] } }), value => { const key = property(value.property); if (value.summary !== null && ![...summaryNamesFor(controller.rows.map(row => row.cells[key])), ...Object.keys(controller.raw.summaries ?? {})].includes(value.summary)) fail('This summary is unavailable for the observed column.'); controller.setSummary(key, value.summary) }),
    'column-sort': write(actionValue({ property: name, direction: { enum: ['ASC', 'DESC', 'NONE', 'TOGGLE'] } }), value => controller.setSortProperty(property(value.property), value.direction)),
    'formula-add': write(actionValue({ name, expression: stringValue }), value => { if (Object.hasOwn(controller.raw.formulas, value.name)) fail('The Base formula already exists.'); controller.patchAll({ order: [...(controller.view?.columns.map(column => displayPropertyId(column.key)) ?? []), `formula.${value.name}`] }, { formulas: { ...controller.raw.formulas, [value.name]: value.expression } }) }),
    'formula-expression': write(actionValue({ name, expression: stringValue }), value => { if (!Object.hasOwn(controller.raw.formulas, value.name)) fail('The Base formula is absent.'); controller.patch({ formulas: { ...controller.raw.formulas, [value.name]: value.expression } }, true) }),
    'formula-rename': write(actionValue({ name, newName: name }), value => { if (!Object.hasOwn(controller.raw.formulas, value.name) || Object.hasOwn(controller.raw.formulas, value.newName)) fail('The Base formula rename is stale or collides.'); controller.patch({ formulas: Object.fromEntries(Object.entries(controller.raw.formulas).map(([key, expression]) => [key === value.name ? value.newName : key, expression])) }, true) }),
    'formula-delete': write(name, value => { if (!Object.hasOwn(controller.raw.formulas, value)) fail('The Base formula is absent.'); const formulas = { ...controller.raw.formulas }; delete formulas[value]; controller.patchAll({ order: controller.view?.columns.map(column => displayPropertyId(column.key)).filter(key => key !== `formula.${value}`) ?? [] }, { formulas }) }),
    'row-open': execute(actionValue({ row: integer(), newTab: { type: 'boolean' } }), value => { const row = controller.rows[value.row] ?? fail('The Base result row is absent.'); return controller.openFile(row.id, value.newTab ? { metaKey: true, ctrlKey: true } : undefined) }),
    'results-copy-markdown': execute(noValue, () => { const rows = table(); return controller.api.ui.writeClipboardText([`| ${rows[0].join(' | ')} |`, `| ${rows[0].map(() => '---').join(' | ')} |`, ...rows.slice(1).map(row => `| ${row.map(cell => cell.replace(/\|/g, '\\|')).join(' | ')} |`)].join('\n')) }),
    'results-export-csv': execute(noValue, async () => { const path = await controller.api.files.downloadFile(`${controller.doc.name}.csv`, table().map(row => row.map(cell => /[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell).join(',')).join('\n')); return path ? { path } : fail('The download destination saved no file.') }),
  }
  const options: Record<string, { key: string; schema: Record<string, unknown> }> = {
    'view-layout': { key: 'type', schema: { enum: ['table', 'cards', 'list', 'map'] } }, 'table-row-height': { key: 'rowHeight', schema: { enum: ['', 'medium', 'tall', 'extra'] } },
    'cards-size': { key: 'cardSize', schema: numberValue(50, 800) }, 'cards-image-property': { key: 'image', schema: { enum: ['', ...controller.available.filter(column => column.kind !== 'file' || column.key === 'file.file').map(column => displayPropertyId(column.key))] } }, 'cards-image-fit': { key: 'imageFit', schema: { enum: ['', 'contain'] } }, 'cards-image-aspect-ratio': { key: 'imageAspectRatio', schema: numberValue(0.25, 2.5) },
    'list-markers': { key: 'markers', schema: { enum: ['bullet', 'number', 'none'] } }, 'list-indent-properties': { key: 'indentProperties', schema: { type: 'boolean' } }, 'list-separator': { key: 'separator', schema: stringValue },
    'map-height': { key: 'mapHeight', schema: numberValue(200, 800) }, 'map-center': { key: 'center', schema: stringValue }, 'map-default-zoom': { key: 'defaultZoom', schema: numberValue(1, 18) }, 'map-min-zoom': { key: 'minZoom', schema: numberValue(0, 24) }, 'map-max-zoom': { key: 'maxZoom', schema: numberValue(0, 24) },
    'map-coordinate-property': { key: 'coordinates', schema: stringValue }, 'map-marker-icon-property': { key: 'markerIcon', schema: stringValue }, 'map-marker-color-property': { key: 'markerColor', schema: stringValue },
  }
  for (const [id, option] of Object.entries(options)) {
    if (['coordinates', 'markerIcon', 'markerColor'].includes(option.key)) option.schema = { enum: ['', ...controller.available.filter(column => column.kind !== 'file').map(column => displayPropertyId(column.key))] }
    actions[id] = write(option.schema, value => { const view = at(configureIndex); const patch = { [option.key]: value === '' && option.key !== 'separator' ? undefined : ['coordinates', 'markerIcon', 'markerColor'].includes(option.key) && value ? normalizePropertyId(value) : value }; if (configureIndex === controller.index) controller.patch(patch); else controller.viewsPatch(views.map((item, index) => index === configureIndex ? { ...view, ...patch } : item)) })
  }
  return actions
}

export function baseResultTable(controller: BaseController): string[][] {
  if (controller.rows.length > 10000 || controller.view!.columns.length > 256) fail('Export at most 10,000 rows and 256 columns at a time.')
  return [controller.view!.columns.map(column => column.label), ...controller.rows.map(row => controller.view!.columns.map(column => {
    if (column.kind === 'note') {
      if (!row.hasFrontmatter) return ''
      const shown = rawCellText(row.widgets[column.key] ?? 'text', row.raw[column.key])
      return Array.isArray(shown) ? shown.join(', ') : shown
    }
    return cellText(row.cells[column.key])
  }))]
}
