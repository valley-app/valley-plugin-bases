import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import { matchesSchema } from '../src/jsonSchema'

const cases: [Record<string, unknown> | boolean, unknown[]][] = [
  [{}, [null, 0, 'Fern', [], {}]],
  [{ not: {} }, [null, 0, 'Fern']],
  [true, [null, 'Moss']], [false, [null, 'Moss']],
  [{ type: 'null' }, [null, 0, '']],
  [{ type: 'boolean' }, [true, false, 0, 'true']],
  [{ type: 'integer', minimum: 0, maximum: 3 }, [0, 3, 4, -1, 1.5, '1']],
  [{ type: 'number', minimum: 0.5, maximum: 2 }, [0.5, 2, 2.01, 0.49, '1']],
  [{ type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 }, [0, 0.5, 1]],
  [{ type: ['string', 'number', 'boolean', 'null'] }, ['Oak', 1, false, null, [], {}]],
  [{ type: 'string', minLength: 1, maxLength: 3 }, ['', 'O', 'Oak', 'Oaks', '🌲🌲🌲', '🌲🌲🌲🌲']],
  [{ type: 'string', pattern: '^Untitled(?: [1-9][0-9]{0,2})?\\.md$' }, ['Untitled.md', 'Untitled 2.md', 'Untitled 0.md', 'Forest/Untitled.md']],
  [{ enum: ['views', 'results', 'sort'] }, ['views', 'sort', 'filter', null]],
  [{ enum: [{ row: 'Fern.md' }, ['ASC']] }, [{ row: 'Fern.md' }, ['ASC'], { row: 'Oak.md' }, ['DESC']]],
  [{ const: 'acknowledged' }, ['acknowledged', 'queued']],
  [{ type: 'array', maxItems: 2, uniqueItems: true, items: { type: 'string', maxLength: 4 } }, [[], ['Oak'], ['Oak', 'Oak'], ['Oak', 'Fern', 'Moss'], ['Lichen'], [1]]],
  [{ type: 'array', uniqueItems: true }, [[{ a: 1 }, { a: 1 }], [{ a: 1 }, { a: 2 }], [[1], [1]]]],
  [{ type: 'array', minItems: 1 }, [[], [0]]],
  [{ type: 'object', additionalProperties: false, required: ['index', 'name'], properties: { index: { type: 'integer', minimum: 0 }, name: { type: 'string', minLength: 1 } } }, [{ index: 0, name: 'Plots' }, { index: 0 }, { index: 0, name: '' }, { index: 0, name: 'Plots', extra: true }, { index: -1, name: 'Plots' }, ['index'], null]],
  [{ type: 'object', additionalProperties: { type: 'number' } }, [{ oak: 1 }, { oak: '1' }, {}]],
  [{ anyOf: [{ type: 'null' }, { type: 'integer', minimum: 1, maximum: 1000000 }] }, [null, 1, 0, 1000001, 'all']],
  [{ oneOf: [{ type: 'integer' }, { type: 'number', minimum: 0 }] }, [1, 1.5, -1, -1.5]],
  [{ allOf: [{ type: 'string' }, { maxLength: 3 }] }, ['Oak', 'Fern', 3]],
  [{ not: { enum: ['file.name'] } }, ['file.name', 'species']]
]

describe('eval-free Base action schemas', () => {
  it('agrees with a reference JSON Schema validator on every supported keyword', () => {
    const ajv = new Ajv({ strict: false, allowUnionTypes: true })
    for (const [schema, values] of cases) {
      const reference = ajv.compile(schema)
      for (const value of values) expect(matchesSchema(schema, value), `${JSON.stringify(schema)} ${JSON.stringify(value)}`).toBe(reference(value))
    }
  })

  it('refuses unsupported keywords before any action effect', () => {
    for (const schema of [{ format: 'date' }, { $ref: '#/definitions/id' }, { type: 'date' }]) expect(() => matchesSchema(schema, 'Oak')).toThrow(expect.objectContaining({ code: 'SCHEMA_UNSUPPORTED', outcome: 'not-applied' }))
  })
})
