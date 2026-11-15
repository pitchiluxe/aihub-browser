export type QuizQuestion = { question: string; options: string[]; answer: number; explanation: string }

function normalize(record: Record<string, unknown>): QuizQuestion | undefined {
  const question = String(record.question ?? record.q ?? '').trim()
  const options = Array.isArray(record.options ?? record.choices) ? (record.options ?? record.choices) as unknown[] : []
  const labels = options.map(option => String(option ?? '').replace(/^[A-D][.)]\s*/, '').trim())
  let answer = record.answer ?? record.correct ?? record.answerIndex
  if (typeof answer === 'string') {
    const text = answer.trim()
    answer = /^[A-Da-d]$/.test(text) ? text.toUpperCase().charCodeAt(0) - 65 : /^[0-3]$/.test(text) ? Number(text) : labels.indexOf(text)
  }
  if (!question || labels.length !== 4 || labels.some(label => !label)) return undefined
  if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer > 3) return undefined
  return { question, options: labels, answer, explanation: String(record.explanation ?? record.why ?? '').trim() }
}

const STRING = String.raw`"((?:[^"\\]|\\.)*)"`
const decode = (literal: string) => { try { return JSON.parse(`"${literal}"`) as string } catch { return literal } }

/**
 * Small local models often emit almost-JSON: a stray "]]", a trailing "}]}",
 * a missing comma. When strict parsing fails, each question object is read
 * field by field so one bad bracket doesn't throw away five good questions.
 */
function salvage(text: string): Record<string, unknown>[] {
  const chunks = text.split(/(?="(?:question|q)"\s*:)/).slice(1)
  return chunks.map(chunk => {
    const field = (keys: string) => chunk.match(new RegExp(`"(?:${keys})"\\s*:\\s*${STRING}`))?.[1]
    const optionsBlock = chunk.match(/"(?:options|choices)"\s*:\s*\[([\s\S]*?)\]/)?.[1] ?? ''
    const options = [...optionsBlock.matchAll(new RegExp(STRING, 'g'))].map(match => decode(match[1]))
    const answerRaw = chunk.match(/"(?:answer|correct|answerIndex)"\s*:\s*(-?\d+|"(?:[^"\\]|\\.)*")/)?.[1]
    const answer = answerRaw === undefined ? undefined : answerRaw.startsWith('"') ? decode(answerRaw.slice(1, -1)) : Number(answerRaw)
    const question = field('question|q')
    const explanation = field('explanation|why')
    return {
      question: question === undefined ? '' : decode(question),
      options,
      answer,
      explanation: explanation === undefined ? '' : decode(explanation),
    }
  })
}

/** Pulls quiz questions out of model output, tolerating prose, fences, aliases and broken brackets. */
export function parseQuiz(text: string, max = 10): QuizQuestion[] {
  let records: unknown[] = []
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start >= 0 && end > start) {
    try {
      const raw: unknown = JSON.parse(text.slice(start, end + 1))
      if (Array.isArray(raw)) records = raw
    } catch { /* fall through to salvage */ }
  }
  let out = records.flatMap(item => item && typeof item === 'object' ? [normalize(item as Record<string, unknown>)] : []).filter((q): q is QuizQuestion => !!q)
  if (!out.length) out = salvage(text).map(normalize).filter((q): q is QuizQuestion => !!q)
  return out.slice(0, max)
}

/** Strips the labels, markdown and wrapping quotes models put around a single interview question. */
export function cleanQuestion(text: string): string {
  return text.trim()
    .replace(/^#+\s*/, '')
    .replace(/^\**\s*(?:interview\s+)?question\s*\d*\s*:?\s*\**\s*:?\s*/i, '')
    .replace(/^\*\*|\*\*$/g, '')
    .trim()
    .replace(/^["“'](.*)["”']$/s, '$1')
    .trim()
}

/** Pulls "Score: 7/10" style ratings out of free-form feedback. */
export function readScore(text: string): number | undefined {
  const match = text.match(/score[^0-9]{0,12}(\d{1,2})(?:\s*\/\s*10|\s+out of\s+10)/i)
  const score = match ? Number(match[1]) : NaN
  return score >= 0 && score <= 10 ? score : undefined
}
