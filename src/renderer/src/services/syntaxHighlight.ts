// A small tokenizer for the code blocks in AI answers. Not a parser: it finds
// comments, strings, numbers, keywords, function calls and type names well
// enough to colour a snippet, across the languages a model actually writes.
// A full highlighter (highlight.js, shiki) would be 100 KB+ for a cosmetic
// gain over this; the output is plain tokens, rendered as React text, so no
// generated HTML is ever injected.

export type TokenType =
  | 'plain' | 'comment' | 'string' | 'number' | 'keyword'
  | 'literal' | 'function' | 'type' | 'property' | 'tag' | 'attr'

export interface Token { type: TokenType; text: string }

const KW = {
  js: 'as async await break case catch class const continue debugger default delete do else enum export extends finally for from function get if implements import in instanceof interface let new of private protected public readonly return set static super switch this throw try type typeof var void while with yield',
  py: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield self',
  go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
  rust: 'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while',
  c: 'abstract break case catch char class const continue default do double else enum extends final finally float for if implements import int long namespace new override package private protected public return short static struct switch this throw try using virtual void volatile while',
  sql: 'select from where and or not insert into values update set delete create table drop alter add join left right inner outer on group by order having limit offset as distinct union all case when then else end index primary key foreign references',
  sh: 'if then else elif fi for while do done case esac in function return export local echo exit source alias cd',
  ps: 'function param if else elseif foreach for while do return try catch finally throw switch begin process end',
}

const LITERALS = new Set(['true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'nil', 'NaN', 'Infinity'])

type Family = keyof typeof KW | 'json' | 'markup' | 'css' | 'yaml' | 'none'

function familyOf(lang: string): Family {
  const l = lang.toLowerCase()
  if (/^(js|jsx|ts|tsx|javascript|typescript|mjs|cjs|node)$/.test(l)) return 'js'
  if (/^(py|python|python3)$/.test(l)) return 'py'
  if (l === 'go' || l === 'golang') return 'go'
  if (l === 'rust' || l === 'rs') return 'rust'
  if (/^(c|cpp|c\+\+|h|hpp|cs|csharp|java|kotlin|kt|swift|php|dart|scala)$/.test(l)) return 'c'
  if (/^(sql|mysql|postgres|postgresql|sqlite)$/.test(l)) return 'sql'
  if (/^(sh|bash|shell|zsh|console)$/.test(l)) return 'sh'
  if (/^(ps1|powershell|pwsh)$/.test(l)) return 'ps'
  if (l === 'json' || l === 'jsonc') return 'json'
  if (/^(html|xml|svg|vue|xhtml)$/.test(l)) return 'markup'
  if (/^(css|scss|less)$/.test(l)) return 'css'
  if (l === 'yaml' || l === 'yml' || l === 'toml') return 'yaml'
  if (/^(rb|ruby)$/.test(l)) return 'py'
  return 'none'
}

interface Rule { re: RegExp; type: TokenType | ((m: string) => TokenType) }

const STRINGS: Rule[] = [
  { re: /"(?:\\.|[^"\\\n])*"?/y, type: 'string' },
  { re: /'(?:\\.|[^'\\\n])*'?/y, type: 'string' },
]
const NUMBER: Rule = { re: /\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/y, type: 'number' }

function rulesFor(family: Family): Rule[] {
  if (family === 'none') return []
  if (family === 'markup') {
    return [
      { re: /<!--[\s\S]*?(?:-->|$)/y, type: 'comment' },
      { re: /<\/?[A-Za-z][\w:-]*|\/?>/y, type: 'tag' },
      { re: /\b[\w:-]+(?==)/y, type: 'attr' },
      ...STRINGS,
    ]
  }
  if (family === 'json') {
    return [
      { re: /"(?:\\.|[^"\\\n])*"(?=\s*:)/y, type: 'property' },
      ...STRINGS, NUMBER,
      { re: /\b(?:true|false|null)\b/y, type: 'literal' },
    ]
  }
  if (family === 'css') {
    return [
      { re: /\/\*[\s\S]*?(?:\*\/|$)/y, type: 'comment' },
      ...STRINGS,
      { re: /[\w-]+(?=\s*:)/y, type: 'property' },
      { re: /#[\da-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg)?\b/y, type: 'number' },
      { re: /[.#][\w-]+|@[\w-]+/y, type: 'keyword' },
    ]
  }
  if (family === 'yaml') {
    return [
      { re: /#.*/y, type: 'comment' },
      { re: /[\w.-]+(?=\s*[:=])/y, type: 'property' },
      ...STRINGS, NUMBER,
      { re: /\b(?:true|false|null|yes|no)\b/y, type: 'literal' },
    ]
  }

  const hashComments = family === 'py' || family === 'sh' || family === 'ps'
  const keywords = new Set(KW[family].split(' '))
  const caseInsensitive = family === 'sql' || family === 'ps'
  const rules: Rule[] = []
  if (family === 'py') rules.push({ re: /("""|''')[\s\S]*?(?:\1|$)/y, type: 'string' })
  if (family === 'sql') rules.push({ re: /--.*/y, type: 'comment' })
  if (hashComments) rules.push({ re: /#.*/y, type: 'comment' })
  else rules.push({ re: /\/\/.*|\/\*[\s\S]*?(?:\*\/|$)/y, type: 'comment' })
  rules.push(...STRINGS)
  if (family === 'js' || family === 'go') rules.push({ re: /`(?:\\.|[^`\\])*`?/y, type: 'string' })
  if (family === 'sh' || family === 'ps') rules.push({ re: /\$[\w{}:]+/y, type: 'property' })
  rules.push(NUMBER)
  rules.push({
    re: /[A-Za-z_$][\w$]*(?=\s*\()/y,
    type: m => keywords.has(caseInsensitive ? m.toLowerCase() : m) ? 'keyword' : 'function',
  })
  rules.push({
    re: /[A-Za-z_$][\w$]*/y,
    type: m => keywords.has(caseInsensitive ? m.toLowerCase() : m) ? 'keyword'
      : LITERALS.has(m) ? 'literal'
      : /^[A-Z][a-z0-9]\w*$/.test(m) ? 'type'
      : 'plain',
  })
  return rules
}

/** Above this a snippet is shown plain: colouring is not worth a slow frame. */
const MAX_LEN = 20_000

export function highlight(code: string, lang: string): Token[] {
  const rules = code.length > MAX_LEN ? [] : rulesFor(familyOf(lang))
  if (!rules.length) return [{ type: 'plain', text: code }]

  const tokens: Token[] = []
  const push = (type: TokenType, text: string) => {
    const last = tokens[tokens.length - 1]
    if (last && last.type === type) last.text += text
    else tokens.push({ type, text })
  }

  let i = 0
  outer: while (i < code.length) {
    for (const rule of rules) {
      rule.re.lastIndex = i
      const m = rule.re.exec(code)
      if (m && m[0].length) {
        push(typeof rule.type === 'function' ? rule.type(m[0]) : rule.type, m[0])
        i += m[0].length
        continue outer
      }
    }
    push('plain', code[i])
    i++
  }
  return tokens
}
