import { describe, it, expect } from 'vitest'
import { parseActionsBlock, cleanNarration } from './agentTools'

// The chat must never show the machine protocol. Models — especially small
// local ones — wrap tool calls in whatever they were fine-tuned on: the
// documented ###ACTIONS### marker, XML-ish <ACTION> tags, Mistral's
// [TOOL_CALLS], Harmony's <|channel|> tokens, or a bare JSON blob.
const leaks = /<\/?\s*(?:action|actions|tool_call|tool_calls|function_call|invoke|think|thinking|reasoning|scratchpad)\b|<\|[^|]*\|>|###\s*ACTIONS?|\[\/?(?:TOOL_CALLS|INST)\]|"(?:tool|action|tool_name|arguments)"\s*:/i

describe('parseActionsBlock — narration is always clean prose', () => {
  it('strips XML-style action tags and still executes the call', () => {
    const raw = 'Opening YouTube ↗\n<ACTION>{"actions":[{"tool":"open_tab","url":"https://www.youtube.com"}]}</ACTION>'
    const { narration, actions } = parseActionsBlock(raw)
    expect(narration).toBe('Opening YouTube ↗')
    expect(actions).toEqual([{ tool: 'open_tab', url: 'https://www.youtube.com' }])
  })

  it('handles a tag the model never closed', () => {
    const raw = 'On it.\n<action>\n{"tool":"read_page"}'
    const { narration, actions } = parseActionsBlock(raw)
    expect(narration).toBe('On it.')
    expect(actions).toEqual([{ tool: 'read_page' }])
  })

  it('strips lowercase and attributed variants', () => {
    for (const raw of [
      'Done.<tool_call>{"tool":"read_page"}</tool_call>',
      'Done.<function_call name="read_page">{"tool":"read_page"}</function_call>',
      'Done.<actions type="json">{"actions":[{"tool":"read_page"}]}</actions>',
    ]) {
      const { narration } = parseActionsBlock(raw)
      expect(narration, raw).toBe('Done.')
    }
  })

  it('strips reasoning/scratchpad tags and their contents', () => {
    const raw = '<think>The user wants a joke. Pick a short one.</think>\nHere you go: why did the array cross the road?'
    const { narration } = parseActionsBlock(raw)
    expect(narration).toBe('Here you go: why did the array cross the road?')
  })

  it('strips special chat-template tokens', () => {
    const raw = '<|im_start|>assistant\nHello there.<|im_end|>'
    expect(parseActionsBlock(raw).narration).toBe('assistant\nHello there.')
    expect(parseActionsBlock('<|channel|>analysis<|message|>Hi.').narration).toBe('analysis Hi.')
    expect(parseActionsBlock('Hi.<end_of_turn>').narration).toBe('Hi.')
    expect(parseActionsBlock('<s>Hi.</s>').narration).toBe('Hi.')
  })

  it('strips Mistral-style [TOOL_CALLS]', () => {
    const raw = 'Sure.\n[TOOL_CALLS] [{"tool": "read_page"}]'
    const { narration, actions } = parseActionsBlock(raw)
    expect(narration).toBe('Sure.')
    expect(actions).toEqual([{ tool: 'read_page' }])
  })

  it('strips the documented marker and loose variants', () => {
    expect(parseActionsBlock('Working on it.\n###ACTIONS###\n{"actions":[{"tool":"read_page"}]}').narration)
      .toBe('Working on it.')
    expect(parseActionsBlock('Working on it.\n### ACTION ###\n{"actions":[{"tool":"read_page"}]}').narration)
      .toBe('Working on it.')
  })

  it('leaves code the user actually asked for untouched', () => {
    const raw = [
      'Here is the snippet:',
      '',
      '```html',
      '<div class="card"><span>Hi</span></div>',
      '```',
      '',
      'Use `<think>` in your prompt template if you need it.',
    ].join('\n')
    const { narration } = parseActionsBlock(raw)
    expect(narration).toContain('<div class="card"><span>Hi</span></div>')
    expect(narration).toContain('`<think>`')
    expect(narration).toContain('```html')
  })

  it('never leaks protocol text for any of these shapes', () => {
    const raws = [
      'Hi<ACTION>{"actions":[{"tool":"read_page"}]}</ACTION>',
      'Hi\n###ACTIONS###\n{"actions":[{"tool":"read_page"}]}',
      'Hi\n{"actions":[{"tool":"read_page"}]}',
      'Hi\n```json\n{"actions":[{"tool":"read_page"}]}\n```',
      'Hi<|channel|>commentary<|message|>{"tool":"read_page"}',
      'Hi\n[TOOL_CALLS] [{"tool":"read_page"}]',
      'Hi<tool_calls>[{"tool":"read_page"}]</tool_calls>',
    ]
    for (const raw of raws) {
      const { narration } = parseActionsBlock(raw)
      expect(narration, raw).not.toMatch(leaks)
    }
  })

  it('keeps ordinary prose exactly as written', () => {
    const raw = 'The Bible reader lives in AIHub. Say "open the bible" and it opens right here.'
    expect(parseActionsBlock(raw).narration).toBe(raw)
    expect(parseActionsBlock(raw).actions).toBeNull()
  })
})

// Only `"tool"` is documented, but models routinely name the key whatever
// their fine-tune used — `"action"`, OpenAI's `"name"`/`"arguments"`, a
// nested `"function"`. When the key isn't recognised the call is neither run
// nor stripped, so the user sees raw JSON and nothing happens.
describe('parseActionsBlock — tool-name key aliases', () => {
  it('runs a call keyed "action" instead of "tool"', () => {
    const raw = 'Let me look at the form.\n{"action": "scan_page", "tabId": "tab-3"}'
    const { narration, actions } = parseActionsBlock(raw)
    expect(actions).toEqual([{ tool: 'scan_page', tabId: 'tab-3' }])
    expect(narration).toBe('Let me look at the form.')
  })

  it('runs the OpenAI name/arguments shape', () => {
    const raw = 'Scanning.\n{"name":"scan_page","arguments":{"tabId":"tab-3"}}'
    expect(parseActionsBlock(raw).actions).toEqual([{ tool: 'scan_page', tabId: 'tab-3' }])
    expect(parseActionsBlock(raw).narration).toBe('Scanning.')
  })

  it('runs a nested function call whose arguments are a JSON string', () => {
    const raw = 'Filling it in.\n{"function":{"name":"fill_field","arguments":"{\\"tabId\\":\\"tab-3\\",\\"elementId\\":4,\\"value\\":\\"Erick\\"}"}}'
    expect(parseActionsBlock(raw).actions)
      .toEqual([{ tool: 'fill_field', tabId: 'tab-3', elementId: 4, value: 'Erick' }])
  })

  it('accepts alias list keys around the calls', () => {
    expect(parseActionsBlock('Ok.\n{"tool_calls":[{"action":"read_page"}]}').actions)
      .toEqual([{ tool: 'read_page' }])
    expect(parseActionsBlock('Ok.\n###ACTIONS###\n{"actions":[{"tool_name":"scan_page","tabId":"t1"}]}').actions)
      .toEqual([{ tool: 'scan_page', tabId: 't1' }])
  })

  it('never leaks alias-keyed protocol into the chat', () => {
    for (const raw of [
      'Hi\n{"action":"scan_page","tabId":"t1"}',
      'Hi\n```json\n{"action":"scan_page"}\n```',
      'Hi\n{"name":"read_page","arguments":{}}',
      'Hi<ACTION>{"tool_calls":[{"action":"read_page"}]}</ACTION>',
    ]) {
      expect(parseActionsBlock(raw).narration, raw).not.toMatch(leaks)
    }
  })

  it('does not mistake ordinary JSON for a tool call', () => {
    const raw = 'Here is the record:\n\n```json\n{"name":"Erick","action":"renew"}\n```'
    const { narration, actions } = parseActionsBlock(raw)
    expect(actions).toBeNull()
    expect(narration).toContain('"name":"Erick"')
  })
})

// Small local models generalise the documented ###ACTIONS### marker into
// "###TOOL_NAME### args" and emit that instead of JSON. Left unhandled the
// call neither runs nor gets stripped, so the user reads "###FILL_FIELD###
// telephone 555-0142" where the form should have been filled in.
describe('parseActionsBlock — hash-wrapped tool names', () => {
  it('runs a bare ###SCAN_PAGE### and shows nothing', () => {
    const { narration, actions } = parseActionsBlock('###SCAN_PAGE###')
    expect(actions).toEqual([{ tool: 'scan_page' }])
    expect(narration).toBe('')
  })

  it('reads positional arguments off the same line', () => {
    const raw = [
      '###FILL_FIELD### customer_name Test User',
      '###FILL_FIELD### telephone 555-0142',
      '###FILL_FIELD### delivery_instructions Leave at front desk',
    ].join('\n')
    const { narration, actions } = parseActionsBlock(raw)
    expect(actions).toEqual([
      { tool: 'fill_field', elementId: 'customer_name',         value: 'Test User' },
      { tool: 'fill_field', elementId: 'telephone',             value: '555-0142' },
      { tool: 'fill_field', elementId: 'delivery_instructions', value: 'Leave at front desk' },
    ])
    expect(narration).toBe('')
  })

  it('accepts JSON or key=value arguments after the tag', () => {
    expect(parseActionsBlock('###OPEN_TAB### {"url":"https://example.com"}').actions)
      .toEqual([{ tool: 'open_tab', url: 'https://example.com' }])
    expect(parseActionsBlock('###FILL_FIELD### elementId=4 value="Test User"').actions)
      .toEqual([{ tool: 'fill_field', elementId: '4', value: 'Test User' }])
  })

  it('keeps the prose around the call', () => {
    const raw = 'Filling that in for you.\n###FILL_FIELD### 4 Test User\nAll set.'
    const { narration, actions } = parseActionsBlock(raw)
    expect(actions).toEqual([{ tool: 'fill_field', elementId: '4', value: 'Test User' }])
    expect(narration).toBe('Filling that in for you.\nAll set.')
  })

  it('leaves markdown headings and unknown tags alone', () => {
    for (const raw of [
      '### Overview\nThis is a heading, not a tool call.',
      '### fill_field is the tool that fills a form field.',
      '###DEPLOY_ROCKET### now',
      // Closed-ATX headings that happen to name a single-word tool.
      '## Remember ##\nYour seat is 14C.',
      '## Wait ##\nGive the page a moment.',
    ]) {
      expect(parseActionsBlock(raw).actions, raw).toBeNull()
      expect(parseActionsBlock(raw).narration, raw).toContain(raw.split('\n')[0].slice(4, 12))
    }
  })

  // Chat history is persisted, so anything an older build failed to strip is
  // on disk and replayed on every launch. The restore path re-cleans each
  // assistant turn and drops the ones that were nothing but protocol — which
  // only works if these clean to empty rather than to whitespace.
  it('reduces a protocol-only reply to nothing, so restore can drop it', () => {
    for (const raw of [
      '###SCAN_PAGE###',
      '###FILL_FIELD### customer_name Test User\n###FILL_FIELD### telephone 555-0142\n'
        + '###FILL_FIELD### email test@example.com\n###FILL_FIELD### pizza_size large\n'
        + '###FILL_FIELD### delivery_instructions Leave at front desk',
    ]) {
      expect(cleanNarration(raw), raw).toBe('')
    }
  })

  it('never leaks a hash-wrapped call into the chat', () => {
    for (const raw of [
      '###SCAN_PAGE###',
      'On it.\n###READ_PAGE###',
      '###FILL_FIELD### customer_name Test User\n###FILL_FIELD### email test@example.com',
      '###WEB_SEARCH### best laptops under $1000',
    ]) {
      expect(parseActionsBlock(raw).narration, raw).not.toMatch(/###\s*[A-Z_]+\s*###/i)
    }
  })
})
