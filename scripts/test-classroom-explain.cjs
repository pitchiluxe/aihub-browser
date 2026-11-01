const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('typescript')
const root = process.argv[2] || process.cwd()
// Exercise the actual lesson click and study callback, preserving the passage object.
const components = path.join(root, 'src/renderer/src/components')
function findNode(file, predicate) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found
  function visit(node) { if (predicate(node)) found = node; ts.forEachChild(node, visit) }
  visit(source)
  assert(found, 'Expected callback in ' + file)
  return found.getText(source)
}
const lessonClick = findNode(path.join(components, 'study/LessonView.tsx'), n => ts.isJsxAttribute(n) && n.name.getText() === 'onClick' && n.initializer?.getText().includes('onAskAI('))
let requested
const clickCode = ts.transpileModule('const click = ' + lessonClick.slice(lessonClick.indexOf('{') + 1, -1), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText + '; click()'
vm.runInNewContext(clickCode, { p: { ...{ bookId: 'JHN', chapter: 3, from: 16, to: 18 }, label: 'John 3:16–18' }, lang: 'en', t: en => en, passageLabel: p => p.label, onAskAI: (question, passage) => { requested = { question, passage } } })
assert.equal(requested.passage.to, 18, 'Explain click must pass its passage')
const studyCallback = findNode(path.join(components, 'pages/BibleStudyPage.tsx'), n => ts.isVariableDeclaration(n) && n.name.getText() === 'askAI')
const studyCode = ts.transpileModule('const ' + studyCallback, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText + '; askAI(question, passage)'
let opened
vm.runInNewContext(studyCode, { useCallback: f => f, question: requested.question, passage: requested.passage, setExplanation: value => { opened = value } })
assert.equal(opened.passage, requested.passage, 'Study page must open the Bible companion with this passage')
const unavailable = process.argv.includes('--unavailable')
const effects = [], states = [], requests = []
const react = {
  createElement: () => null,
  useState: initial => { const i = states.push(initial) - 1; return [initial, v => { states[i] = typeof v === 'function' ? v(states[i]) : v }] },
  useRef: current => ({ current }), useCallback: f => f,
  useEffect: f => effects.push(f),
}
const passage = { bookId: 'JHN', chapter: 3, from: 16, to: 18 }
const hits = [16, 17, 18].map(verse => ({ ref: `JHN.3.${verse}`, book: 'John', bookId: 'JHN', chapter: 3, verse, text: `Selected translation verse ${verse}` }))
const mocks = {
  react, 'lucide-react': {},
  '../../services/bibleSearch': { isReady: () => true, buildIndex: async () => {}, context: () => hits, search: () => [], expandQuery: q => q },
  '../../services/bibleService': { parseRef: () => ({ bookId: 'JHN', chapter: 3, verse: 16 }), formatRef: () => 'John 3:16', getTranslationMeta: () => ({ name: 'Test translation', short: 'TEST', language: 'French' }) },
  './VerseSearch': { parseTypedRef: () => null }, '../../services/agentTools': { cleanNarration: s => s },
  '../ai/Markdown': {}, '../../services/verseLinks': {},
  '../../services/bibleLang': { useBibleLang: () => ({ lang: 'fr', t: (en, fr) => fr }) },
}
const file = path.join(root, 'src/renderer/src/components/bible/BibleAssistant.tsx')
const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText
const moduleObject = { exports: {} }
vm.runInNewContext(code, { exports: moduleObject.exports, require: name => { assert(name in mocks, name); return mocks[name] }, window: { addEventListener() {}, removeEventListener() {}, electronAPI: { ai: { chat: async messages => { requests.push(messages); if (unavailable) throw new Error('Provider unavailable'); return { content: 'Explanation' } } } } }, setTimeout: () => {}, navigator: {} })
moduleObject.exports.default({ open: true, onClose() {}, bookId: 'JHN', bookName: 'John', chapter: 3, selectedRef: 'JHN.3.16', onOpenRef() {}, initialQuestion: 'Explique Jean 3:16–18', passage })
;(async () => {
  for (const effect of effects) effect()
  for (const effect of effects) effect() // React StrictMode replays mount effects.
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.length, 1, 'Opening a classroom explanation must send the question once')
  const prompt = requests[0][1].content
  assert.match(prompt, /Explique Jean 3:16–18/)
  for (const hit of hits) assert(prompt.includes(hit.text), 'Include selected passage text')
  assert.match(requests[0][0].content, /French/)
  assert(states.some(s => Array.isArray(s) && s.some(m => unavailable ? m.content.includes('connecté') : m.content === 'Explanation')), 'Show the answer')
  console.log('PASS: classroom click opens companion and submits once with passage/translation context; ' + (unavailable ? 'connection failure shown' : 'answer shown'))
})().catch(e => { console.error(e); process.exitCode = 1 })
