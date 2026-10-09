type Schema = boolean | Record<string, any>

const annotations = ['title', 'description', 'default', 'examples', '$schema', '$comment']
const keywords = new Set(['type', 'enum', 'const', 'properties', 'required', 'additionalProperties', 'items', 'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems', 'uniqueItems', 'anyOf', 'oneOf', 'allOf', 'not', 'pattern', ...annotations])
const patterns = new Map<string, RegExp>()

function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null || Array.isArray(left) !== Array.isArray(right)) return false
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equal((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]))
}

function typed(type: unknown, value: unknown): boolean {
  switch (type) {
    case 'null': return value === null
    case 'boolean': return typeof value === 'boolean'
    case 'string': return typeof value === 'string'
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    case 'integer': return Number.isInteger(value)
    case 'array': return Array.isArray(value)
    case 'object': return typeof value === 'object' && value !== null && !Array.isArray(value)
    default: throw unsupported(`type ${String(type)}`)
  }
}

const unsupported = (feature: string): Error => Object.assign(new Error(`Base action schemas do not support ${feature}.`), { code: 'SCHEMA_UNSUPPORTED', outcome: 'not-applied' })

/** Strict JSON Schema subset evaluated without compiling code: the plugin sandbox forbids string evaluation. */
export function matchesSchema(schema: Schema, value: unknown): boolean {
  if (typeof schema === 'boolean') return schema
  for (const key of Object.keys(schema)) if (!keywords.has(key)) throw unsupported(`keyword ${key}`)
  if (schema.type !== undefined && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some(type => typed(type, value))) return false
  if (schema.enum !== undefined && !schema.enum.some((item: unknown) => equal(item, value))) return false
  if (Object.hasOwn(schema, 'const') && !equal(schema.const, value)) return false
  if (typeof value === 'string') {
    const length = [...value].length
    if (schema.minLength !== undefined && length < schema.minLength || schema.maxLength !== undefined && length > schema.maxLength) return false
    if (schema.pattern !== undefined) {
      let pattern = patterns.get(schema.pattern)
      if (!pattern) { pattern = new RegExp(schema.pattern, 'u'); patterns.set(schema.pattern, pattern) }
      if (!pattern.test(value)) return false
    }
  }
  if (typeof value === 'number' && (schema.minimum !== undefined && value < schema.minimum || schema.maximum !== undefined && value > schema.maximum || schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum || schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum)) return false
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) return false
    if (schema.uniqueItems === true && value.some((item, index) => value.slice(0, index).some(other => equal(other, item)))) return false
    if (schema.items !== undefined && !value.every(item => matchesSchema(schema.items, item))) return false
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Record<string, unknown>, properties: Record<string, Schema> = schema.properties ?? {}
    if (schema.required !== undefined && !schema.required.every((key: string) => Object.hasOwn(record, key))) return false
    for (const [key, item] of Object.entries(record)) {
      if (Object.hasOwn(properties, key)) { if (!matchesSchema(properties[key], item)) return false }
      else if (schema.additionalProperties !== undefined && !matchesSchema(schema.additionalProperties, item)) return false
    }
  }
  if (schema.allOf !== undefined && !schema.allOf.every((item: Schema) => matchesSchema(item, value))) return false
  if (schema.anyOf !== undefined && !schema.anyOf.some((item: Schema) => matchesSchema(item, value))) return false
  if (schema.oneOf !== undefined && schema.oneOf.filter((item: Schema) => matchesSchema(item, value)).length !== 1) return false
  return schema.not === undefined || !matchesSchema(schema.not, value)
}
