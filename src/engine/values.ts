// Typed values and the evaluator for base formulas and filters. Values carry
// their own type (String, Number, Boolean, List, Object, Date, Duration, Link,
// URL, File, Tag, Image, HTML, Icon, RegExp, Null); method lookup walks the type
// chain, arguments are type-checked, and failures surface as error values.

import moment from 'moment'
import { parseExpression as parse, type Node } from './parser'

export class BaseEvalError extends Error {}

// ---- Value classes ----------------------------------------------------------

export abstract class Value {
  static typeName = 'Any'
  get typeName(): string { return (this.constructor as typeof Value).typeName }
  abstract toString(): string
  isTruthy(): boolean { return false }
  equals(_other: Value): boolean { return false }
  looseEquals(_other: Value): boolean { return false }
  access(_name: string): Value | null { return null }
}

export class ErrorValue extends Value {
  static typeName = 'Error'
  constructor(readonly message: string) { super() }
  toString(): string { return `Error: ${this.message}` }
}

export class NullValue extends Value {
  static typeName = 'Null'
  static readonly value = new NullValue()
  toString(): string { return 'null' }
  equals(): boolean { return true }
}
export const NULL = NullValue.value

abstract class ObjectLike extends Value {}

abstract class Primitive<T> extends ObjectLike {
  static typeName = 'Primitive'
  constructor(readonly data: T) { super() }
  toString(): string { return String(this.data) }
  isTruthy(): boolean { return Boolean(this.data) }
  equals(other: Value): boolean { return other instanceof Primitive && this.data === other.data }
  // eslint-disable-next-line eqeqeq
  looseEquals(other: Value): boolean { return other instanceof Primitive && this.data == other.data }
}

export class StringValue extends Primitive<string> {
  static typeName = 'String'
  toString(): string { return this.data }
  access(name: string): Value | null { return name.toLowerCase() === 'length' ? new NumberValue(this.data.length) : null }
}

export class NumberValue extends Primitive<number> {
  static typeName = 'Number'
}

export class BooleanValue extends Primitive<boolean> {
  static typeName = 'Boolean'
}

type Lazy = (key: string | number, raw: unknown) => Value

export class ListValue extends ObjectLike {
  static typeName = 'List'
  lazy: Lazy = (_key, raw) => fromJS(raw)
  constructor(readonly data: unknown[]) { super() }
  length(): number { return this.data.length }
  get(index: number): Value {
    const raw = this.data[index]
    if (raw === null || raw === undefined) return NULL
    if (raw instanceof Value) return raw
    const value = this.lazy(index, raw)
    this.data[index] = value
    return value
  }
  values(): Value[] { return this.data.map((_, index) => this.get(index)) }
  numbers(): number[] {
    const out: number[] = []
    for (const item of this.data) {
      if (typeof item === 'number') out.push(item)
      else if (item instanceof NumberValue) out.push(item.data)
    }
    return out
  }
  dates(): Date[] {
    const out: Date[] = []
    for (const item of this.data) {
      const date = typeof item === 'string' ? DateValue.parse(item) : item instanceof StringValue ? DateValue.parse(item.data) : item instanceof DateValue ? item : null
      if (date) out.push(date.date)
    }
    return out
  }
  toString(): string { return this.join(', ').data }
  isTruthy(): boolean { return this.data.length > 0 }
  includes(value: Value): boolean {
    for (let i = 0; i < this.data.length; i++) if (looseEquals(value, this.get(i))) return true
    return false
  }
  private compare(other: ListValue, test: (a: Value, b: Value) => boolean): boolean {
    if (this.data === other.data) return true
    if (this.data.length !== other.data.length) return false
    for (let i = 0; i < this.data.length; i++) if (this.data[i] !== other.data[i] && !test(this.get(i), other.get(i))) return false
    return true
  }
  equals(other: Value): boolean { return other instanceof ListValue && this.compare(other, strictEquals) }
  looseEquals(other: Value): boolean {
    return other instanceof ListValue ? this.compare(other, looseEquals) : this.data.length === 1 && looseEquals(this.get(0), other)
  }
  access(name: string): Value | null { return name.toLowerCase() === 'length' ? new NumberValue(this.data.length) : null }
  derive(items: unknown[]): ListValue {
    const list = new ListValue(items)
    list.lazy = this.lazy
    return list
  }
  join(separator: string): StringValue {
    const parts: string[] = []
    for (let i = 0; i < this.data.length; i++) {
      const raw = this.data[i]
      parts.push(typeof raw === 'string' || typeof raw === 'boolean' || typeof raw === 'number' ? String(raw) : this.get(i).toString())
    }
    return new StringValue(parts.join(separator))
  }
  sum(): Value {
    const numbers = this.numbers()
    return numbers.length ? new NumberValue(numbers.reduce((a, b) => a + b, 0)) : NULL
  }
  mean(): Value {
    const sum = this.sum()
    return sum instanceof NumberValue ? new NumberValue(sum.data / this.length()) : NULL
  }
  median(): Value {
    const numbers = this.numbers().sort((a, b) => a - b)
    const n = numbers.length
    if (!n) return NULL
    return new NumberValue(n % 2 === 0 ? (numbers[n / 2] + numbers[n / 2 - 1]) / 2 : numbers[(n - 1) / 2])
  }
  stddev(): Value {
    const numbers = this.numbers()
    if (!numbers.length) return NULL
    const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length
    const m = mean(numbers)
    return new NumberValue(Math.sqrt(mean(numbers.map((value) => (value - m) ** 2))))
  }
  flatten(): ListValue {
    const out: unknown[] = []
    const walk = (items: unknown[]): void => {
      for (const item of items) {
        if (item instanceof ListValue) walk(item.data)
        else if (Array.isArray(item)) walk(item)
        else out.push(item)
      }
    }
    walk(this.data)
    return this.derive(out)
  }
  unique(): ListValue {
    const buckets = new Map<string, Value[]>()
    for (let i = 0; i < this.data.length; i++) {
      const value = this.get(i)
      const key = value.toString()
      const bucket = buckets.get(key)
      if (!bucket) buckets.set(key, [value])
      else if (!bucket.some((item) => strictEquals(value, item))) bucket.push(value)
    }
    return new ListValue([...buckets.values()].flat())
  }
  sort(): ListValue {
    const items = this.data.slice()
    const primitive = (value: unknown): unknown => (value instanceof Primitive ? value.data : value instanceof Value ? value.toString() : value)
    items.sort((a, b) => {
      const l = primitive(a)
      const r = primitive(b)
      return typeof l === 'number' && typeof r === 'number' ? l - r : collate(String(l), String(r))
    })
    return this.derive(items)
  }
}

export class TagValue extends StringValue {
  readonly lowerTag: string
  constructor(tag: string) {
    super(tag.startsWith('#') ? tag : `#${tag}`)
    this.lowerTag = this.data.toLowerCase()
  }
  tagMatches(value: Value): boolean {
    if (!(value instanceof StringValue)) return false
    const query = value instanceof TagValue ? value.lowerTag : (value.data.startsWith('#') ? value.data : `#${value.data}`).toLowerCase()
    return this.lowerTag.startsWith(query) && (this.lowerTag.length === query.length || this.lowerTag.charAt(query.length) === '/')
  }
}

export class TagsValue extends ListValue {
  constructor(tags: string[]) { super(tags.map((tag) => new TagValue(tag))) }
  includes(value: Value): boolean { return this.values().some((tag) => tag instanceof TagValue && tag.tagMatches(value)) }
}

export class ObjectValue extends ObjectLike {
  static typeName = 'Object'
  lazy: Lazy = (_key, raw) => fromJS(raw)
  constructor(readonly data: Record<string, unknown>) { super() }
  get(key: string): Value {
    if (!Object.hasOwn(this.data, key)) return NULL
    const raw = this.data[key]
    if (raw instanceof Value) return raw
    const value = this.lazy(key, raw)
    this.data[key] = value
    return value
  }
  getInsensitive(key: string): Value { return this.get(insensitiveKey(this.data, key)) }
  keys(): string[] { return Object.keys(this.data) }
  isEmpty(): boolean { return Object.keys(this.data).length === 0 }
  toString(): string {
    const out: Record<string, string> = {}
    for (const key of Object.keys(this.data)) out[key] = this.get(key).toString()
    return JSON.stringify(out)
  }
  isTruthy(): boolean { return !this.isEmpty() }
  equals(other: Value): boolean {
    if (!(other instanceof ObjectValue)) return false
    const keys = Object.keys(this.data)
    if (keys.length !== Object.keys(other.data).length) return false
    return keys.every((key) => Object.hasOwn(other.data, key) && strictEquals(this.get(key), other.get(key)))
  }
  access(name: string): Value | null { return this.getInsensitive(name) }
}

export class RegExpValue extends ObjectLike {
  static typeName = 'RegExp'
  constructor(readonly regexp: RegExp) { super() }
  toString(): string { return this.regexp.toString() }
  isTruthy(): boolean { return true }
}

const pad = (value: number, size = 2): string => String(value).padStart(size, '0')
export const printDate = (date: Date): string => `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
export const printTime = (date: Date): string => `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`

export class DateValue extends ObjectLike {
  static typeName = 'Date'
  constructor(readonly date: Date, readonly time = true) { super() }
  static parse(text: string): DateValue | null {
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(?:\.\d{1,9})?)?(Z|[+-]\d{2}(:?\d{2})?)?$/.test(text)) return new DateValue(new Date(text), true)
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new DateValue(new Date(`${text}T00:00:00`), false)
    return null
  }
  toString(): string { return this.time ? `${printDate(this.date)}T${printTime(this.date)}` : printDate(this.date) }
  dateOnly(): DateValue { return this.time ? new DateValue(new Date(`${printDate(this.date)}T00:00:00`), false) : this }
  isTruthy(): boolean { return true }
  equals(other: Value): boolean { return other instanceof DateValue && this.time === other.time && this.date.getTime() === other.date.getTime() }
  looseEquals(other: Value): boolean {
    let value = other
    if (value instanceof StringValue) value = DateValue.parse(value.data) ?? value
    if (!(value instanceof DateValue)) return false
    return this.time && value.time ? this.date.getTime() === value.date.getTime() : this.dateOnly().date.getTime() === value.dateOnly().date.getTime()
  }
  access(name: string): Value | null {
    const d = this.date
    switch (name.toLowerCase()) {
      case 'year': return new NumberValue(d.getFullYear())
      case 'month': return new NumberValue(d.getMonth() + 1)
      case 'day': return new NumberValue(d.getDate())
      case 'hour': return new NumberValue(d.getHours())
      case 'minute': return new NumberValue(d.getMinutes())
      case 'second': return new NumberValue(d.getSeconds())
      case 'millisecond': return new NumberValue(d.getMilliseconds())
      case 'timestamp': return new NumberValue(d.getTime())
    }
    return null
  }
}

export class RelativeDateValue extends ObjectLike {
  static typeName = 'Relative'
  constructor(readonly date: Date, readonly time: boolean) { super() }
  toString(): string { return moment(this.date).locale('en').fromNow() }
  isTruthy(): boolean { return true }
}

export class DurationValue extends ObjectLike {
  static typeName = 'Duration'
  constructor(
    readonly years: number, readonly months: number, readonly days: number, readonly hours: number,
    readonly minutes: number, readonly seconds: number, readonly milliseconds: number,
  ) { super() }
  static fromMilliseconds(ms: number): DurationValue { return new DurationValue(0, 0, 0, 0, 0, 0, ms) }
  static parse(text: string): DurationValue | null {
    const iso = /P(?:([.,\d]+)Y)?(?:([.,\d]+)M)?(?:([.,\d]+)W)?(?:([.,\d]+)D)?T(?:([.,\d]+)H)?(?:([.,\d]+)M)?(?:([.,\d]+)S)?/.exec(text)
    if (iso) {
      const int = (part: string | undefined): number => (part === undefined ? 0 : parseInt(part))
      return new DurationValue(int(iso[1]), int(iso[2]), 7 * int(iso[3]) + int(iso[4]), int(iso[5]), int(iso[6]), int(iso[7]), 0)
    }
    const simple = /^(-?\d+) ?([dhmswMy]|ms|(?:second|minute|hour|day|week|month|year)[s]?)$/.exec(text)
    if (!simple) return null
    const n = parseFloat(simple[1])
    const unit = simple[2]
    if (['y', 'year', 'years'].includes(unit)) return new DurationValue(n, 0, 0, 0, 0, 0, 0)
    if (['M', 'month', 'months'].includes(unit)) return new DurationValue(0, n, 0, 0, 0, 0, 0)
    if (['w', 'week', 'weeks'].includes(unit)) return new DurationValue(0, 0, 7 * n, 0, 0, 0, 0)
    if (['d', 'day', 'days'].includes(unit)) return new DurationValue(0, 0, n, 0, 0, 0, 0)
    if (['h', 'hour', 'hours'].includes(unit)) return new DurationValue(0, 0, 0, n, 0, 0, 0)
    if (['m', 'minute', 'minutes'].includes(unit)) return new DurationValue(0, 0, 0, 0, n, 0, 0)
    if (['s', 'second', 'seconds'].includes(unit)) return new DurationValue(0, 0, 0, 0, 0, n, 0)
    if (unit === 'ms') return new DurationValue(0, 0, 0, 0, 0, 0, n)
    return null
  }
  toString(): string {
    return moment.duration({ years: this.years, months: this.months, days: this.days, hours: this.hours, minutes: this.minutes, seconds: this.seconds, milliseconds: this.milliseconds }).locale('en').humanize()
  }
  isTruthy(): boolean { return [this.years, this.months, this.days, this.hours, this.minutes, this.seconds, this.milliseconds].some((part) => part !== 0) }
  equals(other: Value): boolean {
    return other instanceof DurationValue && this.years === other.years && this.months === other.months && this.days === other.days &&
      this.hours === other.hours && this.minutes === other.minutes && this.seconds === other.seconds && this.milliseconds === other.milliseconds
  }
  looseEquals(other: Value): boolean {
    let value = other
    if (value instanceof StringValue) value = DurationValue.parse(value.data) ?? value
    return value instanceof DurationValue && this.getMilliseconds() === value.getMilliseconds()
  }
  addToDate(value: DateValue, subtract = false): DateValue {
    const sign = subtract ? -1 : 1
    const out = new Date(value.date)
    let time = value.time
    if (this.years) out.setFullYear(out.getFullYear() + sign * this.years)
    if (this.months) out.setMonth(out.getMonth() + sign * this.months)
    if (this.days) out.setDate(out.getDate() + sign * this.days)
    if (this.hours) { out.setHours(out.getHours() + sign * this.hours); time = true }
    if (this.minutes) { out.setMinutes(out.getMinutes() + sign * this.minutes); time = true }
    if (this.seconds) { out.setSeconds(out.getSeconds() + sign * this.seconds); time = true }
    if (this.milliseconds) { out.setMilliseconds(out.getMilliseconds() + sign * this.milliseconds); time = true }
    return new DateValue(out, time)
  }
  getMilliseconds(now = new Date()): number {
    const base = new DateValue(now)
    return this.addToDate(base).date.getTime() - base.date.getTime()
  }
  access(name: string): Value | null {
    const unit = name.toLowerCase()
    if (!['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds', 'milliseconds'].includes(unit)) return null
    const base = new DateValue(new Date())
    return new NumberValue(moment(this.addToDate(base).date).diff(base.date, unit as moment.unitOfTime.Diff, true))
  }
  scale(factor: number): DurationValue {
    return new DurationValue(this.years * factor, this.months * factor, this.days * factor, this.hours * factor, this.minutes * factor, this.seconds * factor, this.milliseconds * factor)
  }
}

export class UrlValue extends StringValue {
  static typeName = 'URL'
  constructor(data: string, readonly display: Value | null = null) { super(data) }
  equals(other: Value): boolean { return other instanceof UrlValue && this.data === other.data && strictEquals(this.display ?? NULL, other.display ?? NULL) }
}

export class ImageValue extends StringValue {
  static typeName = 'Image'
  toString(): string { return isVaultPath(this.data) ? `![[${this.data}]]` : `![](${this.data})` }
}

export class HtmlValue extends StringValue {
  static typeName = 'HTML'
}

export class IconValue extends StringValue {}

// ---- Files and links ----------------------------------------------------------

/** A vault file as the evaluator sees it. Built by the Base document from the
 *  link index; `links`/`embeds` hold raw link text in document order. */
export interface BaseFileSource {
  path: string
  ctime: number
  mtime: number
  size: number
  frontmatter: Record<string, unknown>
  links: Array<{ link: string; display?: string }>
  embeds: Array<{ link: string; display?: string }>
  inlineTags: string[]
}

export interface BaseVault {
  resolve(linktext: string, sourcePath: string): BaseFileSource | null
  backlinks(file: BaseFileSource): BaseFileSource[]
}

const basenameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
const extOf = (path: string): string => {
  const name = basenameOf(path)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1) : ''
}
export const shortName = (path: string): string => {
  const name = basenameOf(path)
  return extOf(path).toLowerCase() === 'md' ? name.slice(0, -3) : name
}
const folderOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '/')

export class FileValue extends ObjectLike {
  static typeName = 'File'
  private cache: Record<string, Value> = {}
  constructor(readonly file: BaseFileSource, readonly vault: BaseVault) { super() }
  toString(): string { return this.file.path }
  isTruthy(): boolean { return true }
  equals(other: Value): boolean { return other instanceof FileValue && other.file === this.file }
  looseEquals(other: Value): boolean { return other instanceof StringValue && this.file.path === other.data }
  links(): ListValue {
    return (this.cache.links ??= new ListValue([...this.file.links, ...this.file.embeds].map((ref) => new LinkValue(ref.link, this.file.path, ref.display ? new StringValue(ref.display) : null, this.vault)))) as ListValue
  }
  embeds(): ListValue {
    return (this.cache.embeds ??= new ListValue(this.file.embeds.map((ref) => new LinkValue(ref.link, this.file.path, ref.display ? new StringValue(ref.display) : null, this.vault)))) as ListValue
  }
  backlinks(): ListValue {
    return (this.cache.backlinks ??= new ListValue(this.vault.backlinks(this.file).map((source) => new LinkValue(source.path, '', new StringValue(shortName(source.path)), this.vault)))) as ListValue
  }
  tags(): TagsValue {
    return (this.cache.tags ??= new TagsValue([...new Set([...this.file.inlineTags, ...frontmatterTags(this.file.frontmatter)])])) as TagsValue
  }
  properties(): ObjectValue {
    return (this.cache.properties ??= frontmatterObject(this.file.frontmatter, this.file.path, this.vault)) as ObjectValue
  }
  access(name: string): Value | null {
    const f = this.file
    switch (name.toLowerCase()) {
      case 'file': return this
      case 'name': return new StringValue(shortName(f.path))
      case 'basename': {
        const name = basenameOf(f.path)
        const dot = name.lastIndexOf('.')
        return new StringValue(dot > 0 ? name.slice(0, dot) : name)
      }
      case 'fullname': return new StringValue(basenameOf(f.path))
      case 'path': return new StringValue(f.path)
      case 'folder': return new StringValue(folderOf(f.path))
      case 'ext': return new StringValue(extOf(f.path))
      case 'ctime': return new DateValue(new Date(f.ctime))
      case 'mtime': return new DateValue(new Date(f.mtime))
      case 'size': return new NumberValue(f.size)
      case 'links': return this.links()
      case 'embeds': return this.embeds()
      case 'backlinks': return this.backlinks()
      case 'tags': return this.tags()
      case 'properties': return this.properties()
    }
    return null
  }
}

export class LinkValue extends StringValue {
  static typeName = 'Link'
  constructor(data: string, readonly sourcePath: string, readonly display: Value | null, readonly vault: BaseVault) { super(data) }
  static parse(text: string, sourcePath: string, vault: BaseVault): LinkValue | null {
    if (!text.startsWith('[[') || !text.endsWith(']]')) return null
    let inner = text.slice(2, -2)
    let display: Value | null = null
    const pipe = inner.lastIndexOf('|')
    if (pipe !== -1) { display = new StringValue(inner.slice(pipe + 1)); inner = inner.slice(0, pipe) }
    return new LinkValue(inner, sourcePath, display, vault)
  }
  resolve(): BaseFileSource | null { return this.vault.resolve(stripSubpath(this.data), this.sourcePath) }
  toString(): string { return `[[${this.data}${this.display ? `|${this.display.toString()}` : ''}]]` }
  isTruthy(): boolean { return true }
  equals(other: Value): boolean { return other instanceof LinkValue && this.data === other.data && this.sourcePath === other.sourcePath && strictEquals(this.display ?? NULL, other.display ?? NULL) }
  looseEquals(other: Value): boolean {
    if (other instanceof LinkValue) {
      const a = this.resolve()
      const b = other.resolve()
      return a && b ? a === b : this.data === other.data
    }
    if (other instanceof StringValue) {
      const parsed = LinkValue.parse(other.data, '', this.vault)
      if (parsed) return this.looseEquals(parsed)
    }
    return other instanceof FileValue && this.resolve() === other.file
  }
}

const stripSubpath = (link: string): string => (link.includes('#') ? link.slice(0, link.indexOf('#')) : link)
const isVaultPath = (value: string): boolean => !/^[a-z][a-z0-9+.-]*:/i.test(value)
const isUrl = (value: string): boolean => {
  if (!value || value.includes(' ')) return false
  try { new URL(value); return true } catch { return false }
}
const isUrlLike = (value: string): boolean => {
  if (!value) return false
  try { new URL(value); return true } catch { return false }
}

export function frontmatterTags(frontmatter: Record<string, unknown>): string[] {
  const key = Object.keys(frontmatter).find((name) => /^tags$/i.test(name))
  if (!key) return []
  const raw = frontmatter[key]
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(/[,\s]+/) : []
  return list.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag) && !tag.includes(' ')).map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
}

/** Lazily-typed frontmatter object: `tags` become tags, wikilink
 *  strings become links, URLs become URLs and ISO strings become dates, at any
 *  nesting depth. */
export function frontmatterObject(frontmatter: Record<string, unknown>, sourcePath: string, vault: BaseVault): ObjectValue {
  const object = new ObjectValue({ ...frontmatter })
  const lazy: Lazy = (key, raw) => {
    if (typeof key === 'string' && key.toLowerCase() === 'tags') {
      if (Array.isArray(raw)) return new TagsValue(raw.filter((tag): tag is string => typeof tag === 'string'))
      if (typeof raw === 'string') return new TagsValue([raw])
    }
    if (typeof raw === 'string') {
      const link = LinkValue.parse(raw, sourcePath, vault)
      if (link) return link
      if (isUrl(raw)) return new UrlValue(raw)
      const date = DateValue.parse(raw)
      if (date) return date
    }
    const value = fromJS(raw)
    if (value instanceof ListValue || value instanceof ObjectValue) value.lazy = lazy
    return value
  }
  object.lazy = lazy
  return object
}

// ---- Conversions and comparison ----------------------------------------------

export function fromJS(raw: unknown): Value {
  if (raw === null || raw === undefined || typeof raw === 'function') return NULL
  if (raw instanceof Value) return raw
  if (typeof raw === 'string') return new StringValue(raw)
  if (typeof raw === 'number') return new NumberValue(raw)
  if (typeof raw === 'boolean') return new BooleanValue(raw)
  if (Array.isArray(raw)) return new ListValue(raw.slice())
  if (raw instanceof Date) return new DateValue(new Date(raw))
  if (raw instanceof RegExp) return new RegExpValue(raw)
  if (typeof raw === 'object') return new ObjectValue({ ...(raw as Record<string, unknown>) })
  return NULL
}

export function strictEquals(a: Value | null, b: Value | null): boolean {
  return a === b || (Boolean(a) && Boolean(b) && a!.constructor === b!.constructor && a!.equals(b!))
}

export function looseEquals(a: Value | null, b: Value | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.constructor === b.constructor && a.equals(b)) return true
  return a.looseEquals(b) || b.looseEquals(a)
}

export const collate = new Intl.Collator(undefined, { usage: 'sort', sensitivity: 'base', numeric: true }).compare

export function insensitiveKey(record: Record<string, unknown>, key: string): string {
  if (Object.hasOwn(record, key)) return key
  const lower = key.toLowerCase()
  return Object.keys(record).find((name) => name.toLowerCase() === lower) ?? key
}

/** View sort comparator for one property (nulls always last). */
export function compareForSort(a: Value, b: Value): number | 'nullA' | 'nullB' {
  if (a instanceof NullValue && b instanceof NullValue) return 0
  if (a instanceof BooleanValue || b instanceof BooleanValue) return (a.isTruthy() ? 1 : -1) - (b.isTruthy() ? 1 : -1)
  if (a instanceof NullValue) return 'nullA'
  if (b instanceof NullValue) return 'nullB'
  if (a instanceof NumberValue && b instanceof NumberValue) return a.data - b.data
  if (a instanceof DateValue && b instanceof DateValue) return a.date.getTime() - b.date.getTime()
  if (a instanceof DurationValue && b instanceof DurationValue) return a.getMilliseconds() - b.getMilliseconds()
  const text = (value: Value): string => ((value instanceof LinkValue || value instanceof UrlValue) && value.display ? value.display.toString() : value.toString())
  return collate(text(a), text(b))
}

/** Group-heading order: numbers numerically, everything else by
 *  collated display text; the empty group is always last. */
export function compareGroupKeys(a: Value, b: Value, direction: number): number {
  const hasA = !strictEquals(a, NULL)
  const hasB = !strictEquals(b, NULL)
  if (hasA && hasB) {
    if (strictEquals(a, b)) return 0
    if (a instanceof NumberValue && b instanceof NumberValue) return (a.data - b.data) * direction
    return collate(a.toString(), b.toString()) * direction
  }
  return hasA ? 1 : hasB ? -1 : 0
}

// ---- Function registry --------------------------------------------------------

type TypeRef = abstract new (...args: never[]) => Value
interface Param { name: string; types: TypeRef[]; optional?: boolean; variadic?: boolean }
interface Fn { params: Param[]; apply: (ctx: Scope, ...args: Array<Value | null>) => Value }

const p = (name: string, ...types: TypeRef[]): Param => ({ name, types })
const opt = (name: string, ...types: TypeRef[]): Param => ({ name, types, optional: true })
const many = (name: string, ...types: TypeRef[]): Param => ({ name, types, variadic: true })
const bool = (value: boolean): BooleanValue => new BooleanValue(value)
const num = (value: number): NumberValue => new NumberValue(value)
const str = (value: string): StringValue => new StringValue(value)

const Any = Value as unknown as TypeRef
const ValueT = ObjectLike as unknown as TypeRef
const S = StringValue as unknown as TypeRef
const N = NumberValue as unknown as TypeRef
const L = ListValue as unknown as TypeRef
const O = ObjectValue as unknown as TypeRef
const D = DateValue as unknown as TypeRef
const F = FileValue as unknown as TypeRef
const K = LinkValue as unknown as TypeRef
const U = UrlValue as unknown as TypeRef
const R = RegExpValue as unknown as TypeRef
const T = TagValue as unknown as TypeRef
const Nul = NullValue as unknown as TypeRef
const B = BooleanValue as unknown as TypeRef

const methods = new Map<TypeRef, Record<string, Fn>>()
const define = (type: TypeRef, name: string, params: Param[], apply: Fn['apply']): void => {
  const table = methods.get(type) ?? {}
  table[name.toLowerCase()] = { params, apply }
  methods.set(type, table)
}
const globals: Record<string, Fn> = {}
const defineGlobal = (name: string, params: Param[], apply: Fn['apply']): void => { globals[name.toLowerCase()] = { params, apply } }

define(Any, 'toString', [p('self', Any)], (_c, v) => str(v!.toString()))
define(Any, 'isTruthy', [p('self', Any)], (_c, v) => bool(v!.isTruthy()))
define(Any, 'isType', [p('self', Any), p('type', S)], (_c, v, t) => {
  const wanted = (t as StringValue).data.toLowerCase()
  for (let type: unknown = v!.constructor; type; type = Object.getPrototypeOf(type)) {
    const name = (type as typeof Value).typeName
    if (name && name.toLowerCase() === wanted) return bool(true)
    if (type === Value) break
  }
  return bool(false)
})
define(Nul, 'isEmpty', [p('self', Nul)], () => bool(true))

define(S, 'startsWith', [p('self', S), p('query', S)], (_c, s, q) => bool((s as StringValue).data.startsWith((q as StringValue).data)))
define(S, 'endsWith', [p('self', S), p('query', S)], (_c, s, q) => bool((s as StringValue).data.endsWith((q as StringValue).data)))
define(S, 'trim', [p('self', S)], (_c, s) => {
  const value = s as StringValue
  const trimmed = value.data.trim()
  return trimmed === value.data ? value : str(trimmed)
})
define(S, 'title', [p('self', S)], (_c, s) => str((s as StringValue).data.split(' ').map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ')))
define(S, 'isEmpty', [p('self', S)], (_c, s) => bool((s as StringValue).data.length === 0))
define(S, 'replace', [p('value', S), p('pattern', S, R), p('replacement', S)], (_c, s, pattern, replacement) => {
  const value = s as StringValue
  const to = (replacement as StringValue).data
  if (pattern instanceof RegExpValue) { pattern.regexp.lastIndex = 0; return str(value.data.replace(pattern.regexp, to)) }
  const from = (pattern as StringValue).data
  return from === '' ? value : str(value.data.split(from).join(to))
})
define(S, 'reverse', [p('self', S)], (_c, s) => str((s as StringValue).data.split('').reverse().join('')))
define(S, 'lower', [p('self', S)], (_c, s) => str((s as StringValue).data.toLowerCase()))
define(S, 'split', [p('self', S), p('separator', S, R), opt('n', N)], (_c, s, sep, n) => {
  const value = (s as StringValue).data
  const separator = sep instanceof RegExpValue ? sep.regexp : (sep as StringValue).data
  return new ListValue(n ? value.split(separator, (n as NumberValue).data) : value.split(separator))
})
define(S, 'contains', [p('self', S), p('value', S)], (_c, s, q) => bool((q as StringValue).data !== '' && (s as StringValue).data.toLowerCase().includes((q as StringValue).data.toLowerCase())))
define(S, 'containsAny', [p('self', S), many('values', S)], (_c, s, ...values) => {
  const text = (s as StringValue).data.toLowerCase()
  return bool(values.some((value) => text.includes((value as StringValue).data.toLowerCase())))
})
define(S, 'containsAll', [p('self', S), many('values', S)], (_c, s, ...values) => {
  const text = (s as StringValue).data.toLowerCase()
  return bool(values.every((value) => text.includes((value as StringValue).data.toLowerCase())))
})
define(S, 'slice', [p('self', S), p('start', N), opt('end', N)], (_c, s, start, end) => str((s as StringValue).data.slice((start as NumberValue).data, end ? (end as NumberValue).data : undefined)))
define(S, 'repeat', [p('self', S), p('count', N)], (_c, s, count) => str((s as StringValue).data.repeat(Math.max(0, Math.min(10_000, (count as NumberValue).data)))))

define(N, 'round', [p('self', N), opt('digits', N)], (_c, n, digits) => {
  const value = (n as NumberValue).data
  if (digits && (digits as NumberValue).data > 0) { const f = 10 ** (digits as NumberValue).data; return num(Math.round(value * f) / f) }
  return num(Math.round(value))
})
define(N, 'ceil', [p('self', N)], (_c, n) => num(Math.ceil((n as NumberValue).data)))
define(N, 'floor', [p('self', N)], (_c, n) => num(Math.floor((n as NumberValue).data)))
define(N, 'abs', [p('self', N)], (_c, n) => num(Math.abs((n as NumberValue).data)))
define(N, 'toFixed', [p('self', N), p('precision', N)], (_c, n, precision) => str((n as NumberValue).data.toFixed(Math.max(0, Math.min(100, (precision as NumberValue).data)))))
define(N, 'isEmpty', [p('self', N)], () => bool(false))

define(L, 'isEmpty', [p('self', L)], (_c, l) => bool((l as ListValue).length() === 0))
define(L, 'earliest', [p('self', L)], (_c, l) => {
  const dates = (l as ListValue).dates()
  return dates.length ? new DateValue(dates.reduce((a, b) => (b < a ? b : a))) : NULL
})
define(L, 'latest', [p('self', L)], (_c, l) => {
  const dates = (l as ListValue).dates()
  return dates.length ? new DateValue(dates.reduce((a, b) => (b > a ? b : a))) : NULL
})
define(L, 'median', [p('self', L)], (_c, l) => (l as ListValue).median())
define(L, 'mean', [p('self', L)], (_c, l) => (l as ListValue).mean())
define(L, 'max', [p('self', L)], (_c, l) => {
  const numbers = (l as ListValue).numbers()
  return numbers.length ? num(Math.max(...numbers)) : NULL
})
define(L, 'min', [p('self', L)], (_c, l) => {
  const numbers = (l as ListValue).numbers()
  return numbers.length ? num(Math.min(...numbers)) : NULL
})
define(L, 'sum', [p('self', L)], (_c, l) => (l as ListValue).sum())
define(L, 'stddev', [p('self', L)], (_c, l) => (l as ListValue).stddev())
define(L, 'join', [p('self', L), p('separator', S)], (_c, l, sep) => (l as ListValue).join((sep as StringValue).data))
define(L, 'reverse', [p('self', L)], (_c, l) => (l as ListValue).derive((l as ListValue).data.slice().reverse()))
define(L, 'flat', [p('self', L)], (_c, l) => (l as ListValue).flatten())
define(L, 'unique', [p('self', L)], (_c, l) => (l as ListValue).unique())
const listArgs = (values: Array<Value | null>): Value[] => (values.length === 1 && values[0] instanceof ListValue ? values[0].values() : (values as Value[]))
define(L, 'contains', [p('self', L), p('value', Any)], (_c, l, value) => bool((l as ListValue).includes(value!)))
define(L, 'containsAny', [p('self', L), many('values', Any)], (_c, l, ...values) => bool(listArgs(values).some((value) => (l as ListValue).includes(value))))
define(L, 'containsAll', [p('self', L), many('values', Any)], (_c, l, ...values) => bool(listArgs(values).every((value) => (l as ListValue).includes(value))))
define(L, 'slice', [p('self', L), p('start', N), opt('end', N)], (_c, l, start, end) => (l as ListValue).derive((l as ListValue).data.slice((start as NumberValue).data, end ? (end as NumberValue).data : undefined)))
define(L, 'sort', [p('self', L)], (_c, l) => (l as ListValue).sort())
define(L, 'map', [p('self', L), p('value', Any)], (_c, l) => l!)
define(L, 'filter', [p('self', L), p('value', B)], (_c, l) => l!)
define(L, 'reduce', [p('self', L), p('value', Any), p('acc', Any)], (_c, l) => l!)

define(O, 'isEmpty', [p('self', O)], (_c, o) => bool((o as ObjectValue).isEmpty()))
define(O, 'keys', [p('self', O)], (_c, o) => new ListValue((o as ObjectValue).keys()))
define(O, 'values', [p('self', O)], (_c, o) => {
  const object = o as ObjectValue
  const list = new ListValue(Object.values(object.data))
  list.lazy = object.lazy
  return list
})
define(O, 'map', [p('self', O), p('value', Any)], (_c, o) => o!)
define(O, 'filter', [p('self', O), p('value', B)], (_c, o) => o!)

define(R, 'matches', [p('self', R), p('value', S)], (_c, r, value) => {
  const regexp = (r as RegExpValue).regexp
  regexp.lastIndex = 0
  return bool(regexp.test((value as StringValue).data))
})
define(T, 'matches', [p('self', T), p('tag', S)], (_c, tag, value) => bool((tag as TagValue).tagMatches(value!)))

define(D, 'format', [p('self', D), p('format', S)], (_c, d, format) => str(moment((d as DateValue).date).locale('en').format((format as StringValue).data)))
define(D, 'date', [p('self', D)], (_c, d) => (d as DateValue).dateOnly())
define(D, 'time', [p('self', D)], (_c, d) => str(printTime((d as DateValue).date)))
define(D, 'relative', [p('self', D)], (_c, d) => new RelativeDateValue((d as DateValue).date, (d as DateValue).time))
define(D, 'isEmpty', [p('self', D)], () => bool(false))

define(F, 'asLink', [p('self', F), opt('display', Any)], (_c, f, display) => new LinkValue((f as FileValue).file.path, '', display ?? null, (f as FileValue).vault))
define(F, 'hasLink', [p('self', F), p('dest', F, K, S)], (_c, f, dest) => {
  const file = f as FileValue
  let target: BaseFileSource | null
  let path: string
  if (dest instanceof FileValue) { target = dest.file; path = dest.file.path }
  else if (dest instanceof LinkValue) { target = dest.resolve(); path = target ? target.path : dest.data }
  else { target = file.vault.resolve(stripSubpath((dest as StringValue).data), ''); path = (dest as StringValue).data }
  return bool(file.links().values().some((link) => link instanceof LinkValue && (target ? link.resolve() === target : link.data === path)))
})
define(F, 'inFolder', [p('self', F), p('folder', S)], (_c, f, folder) => {
  let target = (folder as StringValue).data.replace(/([\\/])+/g, '/').replace(/(^\/+|\/+$)/g, '')
  if (target === '') target = '/'
  target = target.normalize('NFC')
  return bool(target === '/' || (f as FileValue).file.path.startsWith(`${target}/`))
})
define(F, 'hasTag', [p('self', F), many('values', S)], (_c, f, ...values) => {
  const queries = values.map((value) => new TagValue((value as StringValue).data))
  return bool((f as FileValue).tags().values().some((tag) => queries.some((query) => (tag as TagValue).tagMatches(query))))
})
define(F, 'hasProperty', [p('self', F), p('property', S)], (_c, f, property) => bool((f as FileValue).properties().keys().includes((property as StringValue).data)))

define(K, 'linksTo', [p('self', K), p('file', F)], (_c, l, f) => bool((l as LinkValue).vault.resolve(stripSubpath((l as LinkValue).data), '') === (f as FileValue).file))
define(K, 'asFile', [p('self', K)], (_c, l) => {
  const link = l as LinkValue
  const file = link.resolve()
  return file ? new FileValue(file, link.vault) : NULL
})

defineGlobal('now', [], () => new DateValue(new Date(), true))
defineGlobal('today', [], (c) => new DateValue(new Date(c.today), true).dateOnly())
defineGlobal('date', [p('input', S, D)], (_c, input) => {
  if (input instanceof DateValue) return input
  const text = (input as StringValue).data
  const parsed = DateValue.parse(text)
  if (parsed) return parsed
  if (/^\d{12}$/.test(text)) return new DateValue(new Date(+text.slice(0, 4), +text.slice(4, 6) - 1, +text.slice(6, 8), +text.slice(8, 10), +text.slice(10, 12)), true)
  if (/^\d{8}$/.test(text)) return new DateValue(new Date(+text.slice(0, 4), +text.slice(4, 6) - 1, +text.slice(6, 8)), false)
  return NULL
})
defineGlobal('random', [], () => num(Math.random()))
defineGlobal('min', [many('inputs', N)], (_c, ...inputs) => {
  const numbers = inputs.filter(Boolean).map((value) => (value as NumberValue).data)
  return numbers.length ? num(Math.min(...numbers)) : NULL
})
defineGlobal('max', [many('inputs', N)], (_c, ...inputs) => {
  const numbers = inputs.filter(Boolean).map((value) => (value as NumberValue).data)
  return numbers.length ? num(Math.max(...numbers)) : NULL
})
defineGlobal('list', [p('self', ValueT)], (_c, value) => (value instanceof ListValue ? value : new ListValue([value])))
defineGlobal('link', [p('self', S, F), opt('display', Any)], (c, value, display) => {
  if (value instanceof UrlValue || (value instanceof StringValue && isUrlLike(value.data))) return new UrlValue((value as StringValue).data, display ?? null)
  if (value instanceof FileValue) return new LinkValue(value.file.path, '', display ?? null, c.vault)
  return LinkValue.parse((value as StringValue).data, '', c.vault) ?? new LinkValue((value as StringValue).data, '', display ?? null, c.vault)
})
defineGlobal('number', [p('input', ValueT)], (_c, input) => {
  if (input instanceof NumberValue) return input
  if (input instanceof StringValue) {
    const n = parseFloat(input.data)
    if (Number.isNaN(n)) throw new BaseEvalError(`Unable to parse "${input.data}" as a number.`)
    return num(n)
  }
  if (input instanceof BooleanValue) return num(input.data ? 1 : 0)
  if (input instanceof DateValue) return num(input.date.getTime())
  throw new BaseEvalError(`Unable to convert "${input!.typeName}" to a number.`)
})
defineGlobal('duration', [p('input', S)], (_c, input) => DurationValue.parse((input as StringValue).data) ?? NULL)
defineGlobal('image', [p('input', S, F, K, U)], (_c, input) => {
  if (input instanceof LinkValue) { const file = input.resolve(); return file ? new ImageValue(file.path) : NULL }
  if (input instanceof StringValue) return new ImageValue(input.data)
  if (input instanceof FileValue) return new ImageValue(input.file.path)
  return NULL
})
defineGlobal('icon', [p('input', S)], (_c, input) => new IconValue((input as StringValue).data))
defineGlobal('file', [p('input', S, K, F)], (c, input) => {
  if (input instanceof FileValue) return input
  const file = input instanceof LinkValue ? input.resolve() : c.vault.resolve(stripSubpath((input as StringValue).data), '')
  return file ? new FileValue(file, c.vault) : NULL
})
defineGlobal('html', [p('input', S)], (_c, input) => new HtmlValue((input as StringValue).data))
defineGlobal('escapeHTML', [p('input', S)], (_c, input) => {
  const text = (input as StringValue).data
  return str(/[&<>"']/.test(text) ? text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!) : text)
})

function findMethod(value: Value, name: string): Fn | null {
  const key = name.toLowerCase()
  for (let type: unknown = value.constructor; type; type = Object.getPrototypeOf(type)) {
    const table = methods.get(type as TypeRef)
    if (table && Object.hasOwn(table, key)) return table[key]
    if (type === Value) break
  }
  return null
}

// ---- Evaluation ---------------------------------------------------------------

/** Identifier scope: a row, `this`, the summary `values`, or a map/filter item. */
export interface Scope {
  vault: BaseVault
  today: Date
  identifier(name: string): Value
}

export function rowScope(file: BaseFileSource, vault: BaseVault, today: Date, formulas: (name: string) => Value, thisScope: Scope | null): Scope {
  let fileValue: FileValue | null = null
  let note: ObjectValue | null = null
  const scope: Scope = {
    vault,
    today,
    identifier(name) {
      switch (name.toLowerCase()) {
        case 'this': return thisScope ? new ThisValue(thisScope) : NULL
        case 'note': return (note ??= frontmatterObject(file.frontmatter, file.path, vault))
        case 'file': return (fileValue ??= new FileValue(file, vault))
        case 'formula': return new FormulaValue(formulas)
      }
      return (note ??= frontmatterObject(file.frontmatter, file.path, vault)).getInsensitive(name)
    },
  }
  return scope
}

class ThisValue extends ObjectLike {
  static typeName = 'Object'
  constructor(readonly scope: Scope) { super() }
  toString(): string { return this.scope.identifier('file').toString() }
  isTruthy(): boolean { return true }
  access(name: string): Value | null { return this.scope.identifier(name) }
}

class FormulaValue extends ObjectLike {
  static typeName = 'Object'
  constructor(readonly formulas: (name: string) => Value) { super() }
  toString(): string { return '{}' }
  access(name: string): Value | null { return this.formulas(name) }
}

const childScope = (parent: Scope, bindings: Record<string, Value>): Scope => ({
  vault: parent.vault,
  today: parent.today,
  identifier: (name) => (Object.hasOwn(bindings, name) ? bindings[name] : parent.identifier(name)),
})

function evalNode(node: Node, scope: Scope): Value {
  switch (node.k) {
    case 'lit': return fromJS(node.v)
    case 'id': {
      if (node.name === 'true') return bool(true)
      if (node.name === 'false') return bool(false)
      return scope.identifier(node.name)
    }
    case 'member': {
      const target = evalNode(node.obj, scope)
      if (target instanceof NullValue) return NULL
      const value = target.access(node.name)
      if (value === null) throw new BaseEvalError(`Cannot find "${node.name}" on type ${target.typeName}`)
      return value
    }
    case 'index': {
      const target = evalNode(node.obj, scope)
      if (target instanceof NullValue) return NULL
      const key = evalNode(node.key, scope)
      if (key instanceof NullValue) return NULL
      if (target instanceof ListValue) {
        if (!(key instanceof NumberValue)) throw new BaseEvalError(`Array index must be an integer. Got ${key.typeName}`)
        const index = key.data < 0 ? key.data + target.length() : key.data
        return target.get(index)
      }
      if (target instanceof ObjectValue) {
        if (!(key instanceof StringValue)) throw new BaseEvalError(`Object access must be an string. Got ${key.typeName}`)
        return target.access(key.data) ?? NULL
      }
      if (target instanceof StringValue && !(target instanceof LinkValue)) {
        if (!(key instanceof NumberValue)) throw new BaseEvalError(`String index must be an integer. Got ${key.typeName}`)
        return str(target.data.charAt(key.data))
      }
      if (key instanceof StringValue) {
        const value = target.access(key.toString())
        if (value === null) throw new BaseEvalError(`Cannot find "${key.data}" on type ${target.typeName}`)
        return value
      }
      throw new BaseEvalError(`Cannot access index "${key.toString()}" of non-array value`)
    }
    case 'array': return new ListValue(node.items.map((item) => evalNode(item, scope)))
    case 'object': return new ObjectValue(Object.fromEntries(node.entries.map(([key, value]) => [key, evalNode(value, scope)])))
    case 'unary': {
      const value = evalNode(node.arg, scope)
      if (node.op === '!') return value === NULL ? value : bool(!value.isTruthy())
      if (value === NULL) return value
      if (!(value instanceof NumberValue)) throw new BaseEvalError(`Unable to negate ${value.toString()}`)
      return node.op === '-' ? num(-value.data) : value
    }
    case 'bin': return evalBinary(node.op, node.l, node.r, scope)
    case 'call': return evalCall(node, scope)
  }
  return NULL
}

function evalBinary(op: string, leftNode: Node, rightNode: Node, scope: Scope): Value {
  if (op === '&&') return bool(evalNode(leftNode, scope).isTruthy() && evalNode(rightNode, scope).isTruthy())
  if (op === '||') return bool(evalNode(leftNode, scope).isTruthy() || evalNode(rightNode, scope).isTruthy())
  if (op === 'where') throw new BaseEvalError('Unexpected where')
  let l = evalNode(leftNode, scope)
  let r = evalNode(rightNode, scope)
  if (op === '==') return bool(looseEquals(l, r))
  if (op === '!=') return bool(!looseEquals(l, r))
  if (['<', '>', '<=', '>='].includes(op)) {
    if (l instanceof NullValue || r instanceof NullValue) return NULL
    let a: number | string
    let b: number | string
    if (l instanceof DateValue) {
      a = l.date.getTime()
      if (r instanceof StringValue) r = DateValue.parse(r.data) ?? r
    } else if (l instanceof DurationValue) {
      a = l.getMilliseconds()
      if (r instanceof StringValue) r = DurationValue.parse(r.data) ?? r
    } else a = l instanceof NumberValue ? l.data : l.toString()
    b = r instanceof DateValue ? r.date.getTime() : r instanceof DurationValue ? r.getMilliseconds() : r instanceof NumberValue ? r.data : r.toString()
    return bool(op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b)
  }
  if (l instanceof NumberValue && r instanceof NumberValue) {
    switch (op) {
      case '+': return num(l.data + r.data)
      case '-': return num(l.data - r.data)
      case '*': return num(l.data * r.data)
      case '/': return num(l.data / r.data)
      case '%': return num(l.data % r.data)
    }
    throw new BaseEvalError('Invalid operator')
  }
  if (l instanceof DateValue && r instanceof StringValue) r = DurationValue.parse(r.data) ?? r
  if (l instanceof DateValue && r instanceof DurationValue) {
    if (op !== '+' && op !== '-') throw new BaseEvalError('Invalid date operator')
    return r.addToDate(l, op === '-')
  }
  if (l instanceof DurationValue && r instanceof NumberValue && (op === '*' || op === '/')) return l.scale(op === '*' ? r.data : 1 / r.data)
  if (l instanceof DurationValue && r instanceof DurationValue && (op === '+' || op === '-')) {
    const s = op === '+' ? 1 : -1
    return new DurationValue(l.years + r.years * s, l.months + r.months * s, l.days + r.days * s, l.hours + r.hours * s, l.minutes + r.minutes * s, l.seconds + r.seconds * s, l.milliseconds + r.milliseconds * s)
  }
  if (l instanceof ListValue && r instanceof ListValue && op === '+') return l.derive(l.data.concat(r.data))
  if (op === '+' && (l instanceof StringValue || r instanceof StringValue)) return str((l === NULL ? '' : l.toString()) + (r === NULL ? '' : r.toString()))
  if (op === '-' && l instanceof DateValue && r instanceof DateValue) return DurationValue.fromMilliseconds(l.date.getTime() - r.date.getTime())
  if (l === NULL || r === NULL) return NULL
  throw new BaseEvalError(`Invalid operator between ${l.typeName} and ${r.typeName}`)
}

function evalCall(node: Extract<Node, { k: 'call' }>, scope: Scope): Value {
  let name: string
  let subjectNode: Node | null = null
  if (node.callee.k === 'id') name = node.callee.name
  else if (node.callee.k === 'member') { name = node.callee.name; subjectNode = node.callee.obj }
  else throw new BaseEvalError('Invalid function name')
  let args = node.args
  if (name === 'if' && !subjectNode) {
    const count = args.length
    if (count < 2) throw new BaseEvalError(`Cannot call function "${name}", not enough arguments.`)
    if (count > 3) throw new BaseEvalError(`Cannot call function "${name}", too many arguments.`)
    return evalNode(args[0], scope).isTruthy() ? evalNode(args[1], scope) : args.length === 3 ? evalNode(args[2], scope) : NULL
  }
  let subject: Value | null = null
  let fn: Fn | null
  if (subjectNode) {
    subject = evalNode(subjectNode, scope)
    fn = findMethod(subject, name)
    if (!fn && subject === NULL) return NULL
  } else fn = Object.hasOwn(globals, name.toLowerCase()) ? globals[name.toLowerCase()] : null
  if (subject instanceof ListValue && ['reduce', 'filter', 'map'].includes(name.toLowerCase()) && fn) {
    const lower = name.toLowerCase()
    if (lower === 'reduce') {
      if (args.length < 2) throw new BaseEvalError(`Cannot call function "${name}", not enough arguments.`)
      if (args.length > 2) throw new BaseEvalError(`Cannot call function "${name}", too many arguments.`)
      let acc = evalNode(args[1], scope)
      for (let i = 0; i < subject.length(); i++) acc = evalNode(args[0], childScope(scope, { index: num(i), value: subject.get(i), acc }))
      return acc
    }
    if (args.length < 1) throw new BaseEvalError(`Cannot call function "${name}", not enough arguments.`)
    if (args.length > 1) throw new BaseEvalError(`Cannot call function "${name}", too many arguments.`)
    const out: Value[] = []
    for (let i = 0; i < subject.length(); i++) {
      const item = subject.get(i)
      const inner = childScope(scope, { index: num(i), value: item })
      if (lower === 'filter') { if (testValue(args[0], inner)) out.push(item) } else out.push(evalNode(args[0], inner))
    }
    return new ListValue(out)
  }
  if (subject instanceof ObjectValue && ['filter', 'map'].includes(name.toLowerCase()) && fn) {
    if (args.length < 1) throw new BaseEvalError(`Cannot call function "${name}", not enough arguments.`)
    if (args.length > 1) throw new BaseEvalError(`Cannot call function "${name}", too many arguments.`)
    if (name.toLowerCase() === 'filter') {
      const out: Record<string, Value> = {}
      for (const key of subject.keys()) { const item = subject.get(key); if (testValue(args[0], childScope(scope, { key: str(key), value: item }))) out[key] = item }
      return new ObjectValue(out)
    }
    return new ListValue(subject.keys().map((key) => evalNode(args[0], childScope(scope, { key: str(key), value: subject!.get(key) }))))
  }
  if (!fn) throw new BaseEvalError(subject ? `Cannot find function "${name}" on type ${subject.typeName}` : `Cannot find function "${name}"`)
  const params = fn.params
  const values: Array<Value | null> = []
  let index = 0
  const accept = (value: Value): boolean => {
    if (index === params.length) {
      if (!params[params.length - 1]?.variadic) throw new BaseEvalError(`Cannot call function "${name}", too many arguments.`)
      index--
    }
    const param = params[index]
    if (param.optional && value === NULL) values.push(null)
    else {
      if (!param.types.some((type) => value instanceof (type as unknown as abstract new (...a: never[]) => unknown))) {
        if (value === NULL) return false
        const expected = (param.types[0] as unknown as typeof Value).typeName
        throw new BaseEvalError(`Type error in "${name}", parameter "${param.name}". Expected ${expected}, given ${value.typeName}.`)
      }
      values.push(value)
    }
    index++
    return true
  }
  if (subject && !accept(subject)) return NULL
  args = node.args
  for (const arg of args) if (!accept(evalNode(arg, scope))) return NULL
  for (let i = index; i < params.length; i++) if (!params[i].optional && !params[i].variadic) throw new BaseEvalError(`Cannot call function "${name}", not enough arguments.`)
  return fn.apply(scope, ...values)
}

function testValue(node: Node, scope: Scope): boolean {
  try { return evalNode(node, scope).isTruthy() } catch { return false }
}

/** Parse once; a syntax error is reported as `null` so callers can decide how to show it. */
export function parseExpression(source: string): Node | null {
  try { return parse(source) } catch { return null }
}

/** Evaluate to a typed value. Runtime failures become an `ErrorValue`;
 *  unparseable sources evaluate to null. */
export function evaluateValue(source: string, scope: Scope): Value {
  const node = parseExpression(source)
  if (!node) return NULL
  try { return evalNode(node, scope) } catch (error) {
    return new ErrorValue(error instanceof Error ? error.message : String(error))
  }
}

/** Evaluate a filter: true only for a truthy, error-free result. */
export function testExpression(source: string, scope: Scope): boolean {
  const node = parseExpression(source)
  if (!node) return false
  return testValue(node, scope)
}

export function summaryScope(values: Value[], vault: BaseVault, today: Date): Scope {
  return { vault, today, identifier: (name) => (name.toLowerCase() === 'values' ? new ListValue(values.slice()) : NULL) }
}

/** Built-in summaries, keyed by the first non-null value's type. */
export const DEFAULT_SUMMARIES: Array<[TypeRef, Record<string, string>]> = [
  [N, { Average: 'values.mean().round(2)', Min: 'values.min()', Max: 'values.max()', Sum: 'values.sum().round(2)', Range: 'values.max() - values.min()', Median: 'values.median()', Stddev: 'values.stddev().round(2)' }],
  [D, { Earliest: 'values.earliest()', Latest: 'values.latest()', Range: '(values.latest() - values.earliest())' }],
  [B, { Checked: 'values.filter(value == true).length', Unchecked: 'values.filter(value == false).length' }],
  [Any, { Empty: 'values.filter(value.isType("null")).length', Filled: 'values.filter(!value.isType("null")).length', Unique: 'values.unique().length' }],
]

export function summaryFormulasFor(sample: Value | undefined): Record<string, string> {
  let out: Record<string, string> = {}
  for (let type: unknown = sample ? sample.constructor : Value; type; type = Object.getPrototypeOf(type)) {
    const entry = DEFAULT_SUMMARIES.find(([candidate]) => candidate === type)
    if (entry) out = { ...entry[1], ...out }
    if (type === Value) break
  }
  return out
}
