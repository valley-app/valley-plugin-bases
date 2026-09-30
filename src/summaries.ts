import type { BaseCell } from './engine/types'

/** Built-in summary names → locale keys. */
export const SUMMARY_NAMES: Record<string, string> = {
  Average: 'summaryAverage', Min: 'summaryMin', Max: 'summaryMax', Sum: 'summarySum', Range: 'summaryRange',
  Median: 'summaryMedian', Stddev: 'summaryStddev', Earliest: 'summaryEarliest', Latest: 'summaryLatest',
  Checked: 'summaryChecked', Unchecked: 'summaryUnchecked', Empty: 'summaryEmpty', Filled: 'summaryFilled', Unique: 'summaryUnique',
}

const ANY = ['Empty', 'Filled', 'Unique']

/** Summaries offered for a column, chosen by its first non-empty value's type. */
export function summaryNamesFor(values: unknown[]): string[] {
  const sample = values.find((value) => value !== null && value !== undefined) as BaseCell | undefined
  if (typeof sample === 'number' || (sample && typeof sample === 'object' && sample.__baseValue === 'number')) return ['Average', 'Min', 'Max', 'Sum', 'Range', 'Median', 'Stddev', ...ANY]
  if (sample && typeof sample === 'object' && sample.__baseValue === 'date') return ['Earliest', 'Latest', 'Range', ...ANY]
  if (typeof sample === 'boolean') return ['Checked', 'Unchecked', ...ANY]
  return ANY
}
