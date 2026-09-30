import { describe, expect, it } from 'vitest'
import type { IndexEntry } from '@valley/plugin-sdk/types'
import { evaluateBase } from '../src/engine/document'
import type { BaseCell } from '../src/engine/types'

const note = (relPath: string, frontmatter: Record<string, unknown>, linkPaths: string[] = []): IndexEntry => ({
  relPath, title: relPath.replace(/^.*\//, '').replace(/\.md$/, ''), kind: 'note', aliases: [], frontmatter,
  mtimeMs: 1, ctimeMs: 1, size: 1, links: linkPaths.map((path) => path.toLowerCase()), linkPaths, embedPaths: [], tags: [],
}) as IndexEntry

const ENTRIES = [
  note('Probes/Probe.md', {
    text: 'Green Heron', padded: '  moss  ', num: 7.456, neg: -3, zero: 0, flag: true, off: false, day: '2026-05-14',
    stamp: '2026-05-14T08:30', list: [3, 1, 2], words: ['oak', 'ash', 'elm'], nested: [[1, 2], [3]], obj: { a: 1, b: 'two' },
    link: '[[Probe Target]]', links: ['[[Probe Target]]', '[[Other Target]]'], empty: '', nothing: null, tags: ['probe/one', 'two'],
  }, ['Probe Target', 'Other Target']),
  note('Probes/Probe Target.md', { colour: 'blue', day: '2026-06-01' }),
  note('Probes/Other Target.md', { colour: 'red' }),
]

/** Expression, and the text the reference application displays for it on the probe note. */
const CASES: Array<[string, string, string]> = [
  ["s_len", "text.length", "11"],
  ["s_lower", "text.lower()", "green heron"],
  ["s_title", "\"green heron\".title()", "Green Heron"],
  ["s_trim", "padded.trim()", "moss"],
  ["s_contains", "text.contains(\"Heron\")", "[x]"],
  ["s_contains_case", "text.contains(\"heron\")", "[x]"],
  ["s_starts", "text.startsWith(\"Green\")", "[x]"],
  ["s_ends", "text.endsWith(\"n\")", "[x]"],
  ["s_replace", "text.replace(\"Heron\", \"Egret\")", "Green Egret"],
  ["s_replace_re", "text.replace(/e/g, \"3\")", "Gr33n H3ron"],
  ["s_split", "text.split(\" \")", "Green Heron"],
  ["s_slice", "text.slice(1, 4)", "ree"],
  ["s_repeat", "\"ab\".repeat(3)", "ababab"],
  ["s_reverse", "text.reverse()", "noreH neerG"],
  ["s_plus_num", "text + 1", "Green Heron1"],
  ["s_upper", "text.upper()", "Cannot find function \"upper\" on type String"],
  ["s_index", "text[0]", "G"],
  ["s_any", "text.containsAny(\"Blue\", \"Green\")", "[x]"],
  ["s_is_type", "text.isType(\"string\")", "[x]"],
  ["s_gt", "text > \"Blue\"", "[x]"],
  ["s_eq_num", "\"7\" == 7", "[x]"],
  ["s_empty", "empty.isEmpty()", "[x]"],
  ["s_truthy", "empty.isTruthy()", "[ ]"],
  ["re_matches", "/Her/.matches(text)", "[x]"],
  ["n_add", "num + 1", "8.456"],
  ["n_round", "num.round()", "7"],
  ["n_round2", "num.round(2)", "7.46"],
  ["n_ceil", "num.ceil()", "8"],
  ["n_floor", "num.floor()", "7"],
  ["n_abs", "neg.abs()", "3"],
  ["n_fixed", "num.toFixed(1)", "7.5"],
  ["n_div0", "1 / zero", "∞"],
  ["n_neg_div0", "-1 / zero", "∞"],
  ["n_nan", "zero / zero", "NaN"],
  ["n_mod", "7 % 3", "1"],
  ["n_plus_str", "num + \"x\"", "7.456x"],
  ["n_null_add", "nothing + 1", ""],
  ["n_null_mul", "nothing * 2", ""],
  ["n_parse", "number(\"3.5\")", "3.5"],
  ["n_parse_bool", "number(true)", "1"],
  ["n_parse_date", "number(date(day))", "1778709600000"],
  ["n_parse_bad", "number(\"abc\")", "Unable to parse \"abc\" as a number."],
  ["n_bool_add", "flag + 1", "Invalid operator between Boolean and Number"],
  ["n_min", "min(3, num, 1)", "1"],
  ["n_max", "max(3, num, 1)", "7.456"],
  ["n_big", "1234567.891", "1234567.891"],
  ["n_float", "0.1 + 0.2", "0.30000000000000004"],
  ["n_to_string", "num.toString()", "7.456"],
  ["n_empty", "zero.isEmpty()", "[ ]"],
  ["n_neg_round", "(-2.5).round()", "-2"],
  ["l_len", "list.length", "3"],
  ["l_sort", "list.sort()", "1 2 3"],
  ["l_sort_words", "words.sort()", "ash elm oak"],
  ["l_reverse", "list.reverse()", "2 1 3"],
  ["l_unique", "[1, 1, 2].unique()", "1 2"],
  ["l_flat", "nested.flat()", "1 2 3"],
  ["l_join", "words.join(\"-\")", "oak-ash-elm"],
  ["l_contains", "list.contains(2)", "[x]"],
  ["l_all", "list.containsAll(1, 2)", "[x]"],
  ["l_any", "list.containsAny(5, 3)", "[x]"],
  ["l_slice", "list.slice(1)", "1 2"],
  ["l_map", "list.map(value * 10)", "30 10 20"],
  ["l_filter", "list.filter(value > 1)", "3 2"],
  ["l_reduce", "list.reduce(acc + value, 0)", "6"],
  ["l_sum", "list.sum()", "6"],
  ["l_mean", "list.mean()", "2"],
  ["l_mean_nulls", "[1, null, 3].mean()", "1.3333333333333333"],
  ["l_median", "list.median()", "2"],
  ["l_stddev", "list.stddev()", "0.816496580927726"],
  ["l_min", "list.min()", "1"],
  ["l_max", "list.max()", "3"],
  ["l_index", "list[0]", "3"],
  ["l_index_out", "list[10]", ""],
  ["l_empty", "[].isEmpty()", "[x]"],
  ["l_plus", "list + [4]", "3 1 2 4"],
  ["l_eq", "[1, 2] == [1, 2]", "[x]"],
  ["l_single_eq", "[7] == 7", "[x]"],
  ["l_to_string", "list.toString()", "3, 1, 2"],
  ["l_earliest", "[date(\"2026-01-01\"), date(\"2025-01-01\")].earliest()", "2025-01-01T00:00"],
  ["l_latest", "[date(\"2026-01-01\"), date(\"2025-01-01\")].latest()", "2026-01-01T00:00"],
  ["o_obj", "obj", "{\"a\":\"1\",\"b\":\"two\"}"],
  ["o_keys", "obj.keys()", "a b"],
  ["o_values", "obj.values()", "1 two"],
  ["o_a", "obj.a", "1"],
  ["o_empty", "obj.isEmpty()", "[ ]"],
  ["x_null", "nothing", ""],
  ["x_missing", "missing_prop", ""],
  ["x_missing_method", "missing_prop.lower()", ""],
  ["x_if", "if(flag, \"yes\", \"no\")", "yes"],
  ["x_if_null", "if(nothing, \"yes\", \"no\")", "no"],
  ["x_and", "flag && off", "[ ]"],
  ["x_or", "flag || off", "[x]"],
  ["x_not", "!flag", "[ ]"],
  ["x_html", "html(\"<b>bold</b>\")", "bold"],
  ["x_escape", "escapeHTML(\"<b>\")", "&lt;b&gt;"],
  ["x_icon", "icon(\"leaf\")", ""],
  ["x_image", "image(\"fileTypes/images/sample.png\")", "img:sample.png"],
  ["x_list_fn", "list(text)", "Green Heron"],
  ["x_str_cmp", "\"10\" < \"9\"", "[x]"],
  ["x_bool_eq", "flag == \"true\"", "[ ]"],
  ["x_unknown", "frobnicate(1)", "Cannot find function \"frobnicate\""],
  ["x_syntax", "1 +", ""],
  ["x_empty_str_eq_null", "empty == nothing", "[ ]"],
  ["x_null_eq_null", "nothing == missing_prop", "[x]"],
]

const text = (cell: BaseCell | undefined): string => {
  if (cell === null || cell === undefined) return ''
  if (typeof cell === 'boolean') return cell ? '[x]' : '[ ]'
  if (typeof cell !== 'object') return String(cell)
  switch (cell.__baseValue) {
    case 'error': return cell.message
    case 'link': return cell.display ?? cell.link
    case 'url': return cell.display ?? cell.value
    case 'list': return cell.items.map(text).join(' ')
    case 'number': return cell.text
    case 'duration': case 'relative': case 'object': return cell.text
    case 'file': return cell.name
    case 'image': return 'img:' + cell.value.split('/').pop()
    case 'html': return cell.value.replace(/<[^>]+>/g, '')
    case 'icon': return ''
    case 'tag': return cell.value.replace(/^#/, '')
    case 'date': return cell.time ? cell.value.replace(/:00$/, '') : cell.value
    case 'regexp': return cell.value
  }
  return JSON.stringify(cell)
}

describe('expression values match the reference application', () => {
  const formulas = CASES.map(([key, expression]) => `  ${key}: ${JSON.stringify(expression)}`).join('\n')
  const base = `filters: file.name == "Probe"\nformulas:\n${formulas}\nviews:\n  - type: table\n    name: Probes\n    order: [file.name, ${CASES.map(([key]) => `formula.${key}`).join(', ')}]\n`
  const view = evaluateBase(base, 'Probes/Probes.base', ENTRIES).views[0]
  const row = view.rows[0]

  it('evaluates the probe note', () => expect(view.rows).toHaveLength(1))
  it.each(CASES)('%s = %s', (key, _expression, expected) => {
    expect(text(row.cells[`formula.${key}`])).toBe(expected)
  })
})
