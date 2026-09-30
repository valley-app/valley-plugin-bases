/** A rendered cell value: primitives stay plain, richer values are tagged. */
export type BaseCell =
  | null
  | string
  | number
  | boolean
  | { __baseValue: 'error'; message: string }
  | { __baseValue: 'link'; link: string; display?: string; path: string | null }
  | { __baseValue: 'url'; value: string; display?: string }
  | { __baseValue: 'image'; value: string; path: string | null }
  | { __baseValue: 'html'; value: string }
  | { __baseValue: 'icon'; value: string }
  | { __baseValue: 'tag'; value: string }
  | { __baseValue: 'number'; value: string; text: string }
  | { __baseValue: 'list'; items: BaseCell[]; kind?: 'tags' }
  | { __baseValue: 'date'; value: string; time: boolean }
  | { __baseValue: 'duration'; text: string; ms: number }
  | { __baseValue: 'relative'; text: string }
  | { __baseValue: 'file'; path: string; name: string }
  | { __baseValue: 'regexp'; value: string }
  | { __baseValue: 'object'; text: string }

export type PropertyKind = 'note' | 'file' | 'formula'

export interface BaseColumn {
  key: string
  label: string
  kind: PropertyKind
  /** Lucide icon name shown in headers and property pickers. */
  icon: string
  /** Vault-wide widget of a note property (text, number, checkbox, date, …). */
  widget?: string
}

export interface BaseRow {
  id: string
  cells: Record<string, BaseCell>
  /** Raw frontmatter values of note columns, for editing. */
  raw: Record<string, unknown>
  /** Widget each note cell renders with. */
  widgets: Record<string, string>
  hasFrontmatter: boolean
}

export interface BaseSummary { name: string; value: BaseCell }

export interface BaseGroup {
  key: BaseCell
  property: string
  count: number
  rowIds: string[]
  summaries?: Record<string, BaseSummary>
}

export interface BaseSortRule { property: string; direction: 'ASC' | 'DESC' }

export interface BaseEvaluatedView {
  type: 'table' | 'cards' | 'list' | 'map' | 'unsupported'
  name: string
  columns: BaseColumn[]
  rows: BaseRow[]
  groups?: BaseGroup[]
  summaries?: Record<string, BaseSummary>
  /** View keys the core parser does not interpret (image, cardSize, …). */
  options: Record<string, unknown>
  sort: BaseSortRule[]
  groupBy?: BaseSortRule
  limit?: number
  filters: unknown
  order: string[] | null
  message?: string
  /** Every referenceable property, for pickers. */
  available: BaseColumn[]
}

export interface BaseEvaluation {
  name: string
  views: BaseEvaluatedView[]
  issues: string[]
  /** The YAML could not be parsed; `issues[0]` holds the parser message. */
  parseError?: boolean
}
