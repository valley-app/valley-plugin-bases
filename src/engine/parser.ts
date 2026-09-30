// Tokenizer and Pratt parser for the base formula language. No `eval`; the
// evaluator in values.ts walks the resulting tree.

interface Token {
  t: 'num' | 'str' | 'regex' | 'id' | 'op'
  v: string
}

export type Node =
  | { k: 'lit'; v: unknown }
  | { k: 'id'; name: string }
  | { k: 'member'; obj: Node; name: string }
  | { k: 'index'; obj: Node; key: Node }
  | { k: 'array'; items: Node[] }
  | { k: 'object'; entries: [string, Node][] }
  | { k: 'call'; callee: Node; args: Node[] }
  | { k: 'unary'; op: string; arg: Node }
  | { k: 'bin'; op: string; l: Node; r: Node }

const TWO_CHAR_OPS = new Set(['==', '!=', '>=', '<=', '&&', '||'])
const REGEX_PREFIX = new Set(['(', '[', ',', '==', '!=', '&&', '||', '!', '=', '+', '-', '*', '/', '%', '<', '>', '<=', '>='])

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue }
    if (c === '/' && (!tokens.length || (tokens.at(-1)!.t === 'op' && REGEX_PREFIX.has(tokens.at(-1)!.v)))) {
      const begin = ++i
      let bracket = false
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === '[') bracket = true
        if (src[i] === ']') bracket = false
        if (src[i] === '/' && !bracket) break
        i++
      }
      if (i >= n) throw new Error('Unclosed regular expression')
      const pattern = src.slice(begin, i++)
      const flagsStart = i
      while (i < n && /[a-z]/i.test(src[i])) i++
      tokens.push({ t: 'regex', v: JSON.stringify([pattern, src.slice(flagsStart, i)]) })
      continue
    }
    if (c === '"' || c === "'") {
      let s = ''
      i++
      while (i < n && src[i] !== c) {
        if (src[i] === '\\' && i + 1 < n) {
          s += ({ n: '\n', r: '\r', t: '\t' } as Record<string, string>)[src[i + 1]] ?? src[i + 1]
          i += 2
        } else s += src[i++]
      }
      if (i >= n) throw new Error('Unclosed string')
      i++
      tokens.push({ t: 'str', v: s })
      continue
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? '') && tokens.at(-1)?.t !== 'id' && tokens.at(-1)?.v !== ')' && tokens.at(-1)?.v !== ']')) {
      const num = /^(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))![0]
      i += num.length
      tokens.push({ t: 'num', v: num })
      continue
    }
    if (/[\p{L}_$]/u.test(c)) {
      let id = ''
      while (i < n && /[\p{L}\p{N}_$]/u.test(src[i])) id += src[i++]
      tokens.push({ t: 'id', v: id })
      continue
    }
    const two = src.slice(i, i + 2)
    if (TWO_CHAR_OPS.has(two)) { tokens.push({ t: 'op', v: two }); i += 2; continue }
    tokens.push({ t: 'op', v: c })
    i++
  }
  return tokens
}

const PRECEDENCE: Record<string, number> = {
  '||': 1, '&&': 2,
  '==': 3, '!=': 3, '>': 3, '>=': 3, '<': 3, '<=': 3,
  '+': 4, '-': 4,
  '*': 5, '/': 5, '%': 5,
}

class Parser {
  private pos = 0
  constructor(private readonly tokens: Token[]) {}
  private peek(): Token | undefined { return this.tokens[this.pos] }
  private next(): Token | undefined { return this.tokens[this.pos++] }

  parse(): Node {
    const node = this.parseExpr(0)
    if (this.peek()) throw new Error('Unexpected trailing expression')
    return node
  }

  private parseExpr(minPrec: number): Node {
    let left = this.parseUnary()
    for (;;) {
      const tok = this.peek()
      if (!tok || tok.t !== 'op') break
      const prec = PRECEDENCE[tok.v]
      if (prec === undefined || prec < minPrec) break
      this.next()
      left = { k: 'bin', op: tok.v, l: left, r: this.parseExpr(prec + 1) }
    }
    return left
  }

  private parseUnary(): Node {
    const tok = this.peek()
    if (tok && tok.t === 'op' && (tok.v === '-' || tok.v === '+' || tok.v === '!')) {
      this.next()
      return { k: 'unary', op: tok.v, arg: this.parseUnary() }
    }
    return this.parsePostfix(this.parsePrimary())
  }

  private parsePrimary(): Node {
    const tok = this.next()
    if (!tok) throw new Error('Unexpected end of expression')
    if (tok.t === 'num') return { k: 'lit', v: Number(tok.v) }
    if (tok.t === 'str') return { k: 'lit', v: tok.v }
    if (tok.t === 'regex') {
      const [pattern, flags] = JSON.parse(tok.v) as [string, string]
      return { k: 'lit', v: new RegExp(pattern, flags) }
    }
    if (tok.t === 'id') {
      if (tok.v === 'true') return { k: 'lit', v: true }
      if (tok.v === 'false') return { k: 'lit', v: false }
      if (tok.v === 'null') return { k: 'lit', v: null }
      return { k: 'id', name: tok.v }
    }
    if (tok.v === '{') {
      const entries: [string, Node][] = []
      if (this.peek()?.v !== '}') for (;;) {
        const key = this.next()
        if (!key || !['str', 'id'].includes(key.t) || this.next()?.v !== ':') throw new Error('Expected object property')
        if (['__proto__', 'constructor', 'prototype'].includes(key.v)) throw new Error('Invalid object property')
        entries.push([key.v, this.parseExpr(0)])
        if (this.peek()?.v !== ',') break
        this.next()
      }
      if (this.next()?.v !== '}') throw new Error('Expected }')
      return { k: 'object', entries }
    }
    if (tok.v === '[') {
      const items: Node[] = []
      if (this.peek()?.v !== ']') for (;;) {
        items.push(this.parseExpr(0))
        if (this.peek()?.v !== ',') break
        this.next()
      }
      if (this.next()?.v !== ']') throw new Error('Expected ]')
      return { k: 'array', items }
    }
    if (tok.v === '(') {
      const inner = this.parseExpr(0)
      if (this.next()?.v !== ')') throw new Error('Expected )')
      return inner
    }
    throw new Error(`Unexpected token ${tok.v}`)
  }

  private parsePostfix(node: Node): Node {
    for (;;) {
      const tok = this.peek()
      if (!tok || tok.t !== 'op') break
      if (tok.v === '.') {
        this.next()
        const name = this.next()
        if (!name || name.t !== 'id') throw new Error('Expected member name')
        node = { k: 'member', obj: node, name: name.v }
      } else if (tok.v === '[') {
        this.next()
        const key = this.parseExpr(0)
        if (this.next()?.v !== ']') throw new Error('Expected ]')
        node = { k: 'index', obj: node, key }
      } else if (tok.v === '(') {
        node = { k: 'call', callee: node, args: this.parseArgs() }
      } else break
    }
    return node
  }

  private parseArgs(): Node[] {
    this.next()
    const args: Node[] = []
    if (this.peek()?.v === ')') { this.next(); return args }
    for (;;) {
      args.push(this.parseExpr(0))
      const tok = this.next()
      if (!tok) throw new Error('Expected )')
      if (tok.v === ')') break
      if (tok.v !== ',') throw new Error('Expected , or )')
    }
    return args
  }
}

const cache = new Map<string, Node>()

export function parseExpression(src: string): Node {
  const cached = cache.get(src)
  if (cached) return cached
  const node = new Parser(tokenize(src)).parse()
  if (cache.size >= 2048) cache.delete(cache.keys().next().value!)
  cache.set(src, node)
  return node
}
