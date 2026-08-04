import { describe, it, expect } from 'vitest'
import { parseActionsBlock } from './agentTools'

// The chat must never show the machine protocol. Models — especially small
// local ones — wrap tool calls in whatever they were fine-tuned on: the
// documented ###ACTIONS### marker, XML-ish <ACTION> tags, Mistral's
// [TOOL_CALLS], Harmony's <|channel|> tokens, or a bare JSON blob.
describe('parseActionsBlock — narration is always clean prose', () => {
  const leaks = /<\/?\s*(?:action|actions|tool_call|tool_calls|function_call|invoke|think|thinking|reasoning|scratchpad)\b|<\|[^|]*\|>|###\s*ACTIONS?|\[\/?(?:TOOL_CALLS|INST)\]|"tool"\s*:/i

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
