// Ask mode: the selection and a question go to the model
// as plain text, and the answer comes back as words for a side panel. No
// operation is produced and the note never changes, so there is no undo step.
// Every model may do it: it is not an operation. The call is logged with its
// tokens like any other.
import type { Doc } from '../schema/doc.js'
import type { LogEntry } from '../schema/log.js'
import type { Selection } from '../select/selection.js'
import { makeAliases } from './alias.js'
import { blockLine, wordsLine } from './context.js'
import type { CompleteResult, Model, Progress, StepProgress, StopSignal } from './model.js'
import { RULEBOOK } from './rulebook.generated.js'

export interface AskRequest {
  doc: Doc
  selection: Selection
  question: string
  /** The model that answers: the larger "writer" model when one is set. */
  model: Model
  /** The person's Stop. */
  signal?: StopSignal
  /** Told as the answer is written, for a person waiting on it: the answer itself is the same. */
  progress?: (progress: StepProgress) => void
  /**
   * A picture to read with the question, as a data URL: one attached in the
   * prompt box, or the picture chosen in the note. Sent only to a model that
   * can see pictures.
   */
  picture?: string
  source?: LogEntry['source']
  now?: () => number
}

export interface AskOutcome {
  /** The answer, as Markdown: paragraphs, a list, a pipe table, $math$. Empty when stopped. */
  answer: string
  /** The person pressed Stop. */
  stopped?: true
  tokensIn: number
  tokensOut: number
  thinking: number
  cost?: number
  ms: number
  log: LogEntry
}

/** The question as the model sees it: what is selected, in full, its neighbours, the notebook rules and the question. */
export function askPrompt(doc: Doc, selection: Selection, question: string): string {
  const aliases = makeAliases(doc, selection)
  const lines: string[] = []
  // Asking reads, so the model sees more of each block than an edit shows.
  if (aliases.selected.length > 0) {
    lines.push('SELECTED')
    for (const { alias, id, words } of aliases.selected) lines.push(`${alias} ${words ? wordsLine(doc, words, 150) : blockLine(doc.block[id]!, 2000)}`)
  }
  if (aliases.near.length > 0) {
    lines.push('NEAR')
    for (const near of aliases.near) lines.push(`${near.alias} ${near.side}: ${blockLine(doc.block[near.id]!, 200)}`)
  }
  if (doc.rules.length > 0) lines.push('NOTEBOOK RULES', ...doc.rules.map((rule) => `- ${rule}`))
  lines.push('QUESTION', question.trim())
  return lines.join('\n')
}

export async function runAsk(request: AskRequest): Promise<AskOutcome> {
  const clock = request.now ?? Date.now
  const started = clock()
  const { doc, selection, model } = request
  const targets = [...new Set(makeAliases(doc, selection).selected.map((s) => s.id))]
  const outcome = (answer: string, result: CompleteResult | undefined): AskOutcome => {
    const stopped = result === undefined
    const ms = Math.max(0, Math.round(clock() - started))
    const used = {
      tokensIn: result?.tokensIn ?? 0,
      tokensOut: result?.tokensOut ?? 0,
    }
    const thinking = result?.thinkingTokens ?? 0
    return {
      answer,
      ...(stopped ? { stopped: true as const } : {}),
      ...used,
      thinking,
      ...(result?.cost === undefined ? {} : { cost: result.cost }),
      ms,
      log: {
        at: started,
        source: request.source ?? 'app',
        model: model.name,
        rulebook: RULEBOOK.version,
        instruction: request.question,
        targets,
        ops: [],
        result: stopped ? 'stopped' : 'answered',
        tier: 1,
        calls: stopped ? 0 : 1,
        retries: 0,
        ...used,
        ...(thinking > 0 ? { thinking } : {}),
        ...(result?.cost === undefined ? {} : { cost: result.cost }),
        ms,
      },
    }
  }
  if (request.signal?.aborted) return outcome('', undefined)
  // The picture goes with the question, to a model that can see it.
  const url = model.caps.vision ? request.picture : undefined
  const prompt = askPrompt(doc, selection, request.question)
  let result: CompleteResult
  try {
    result = await model.complete({
      messages: [
        { role: 'system', content: url === undefined ? RULEBOOK.topics.ask : `${RULEBOOK.topics.ask}\n- The picture is attached: answer from what it shows too.` },
        { role: 'user', content: url === undefined ? prompt : [{ type: 'text', text: `${prompt}\nPICTURE (attached)` }, { type: 'image_url', image_url: { url } }] },
      ],
      maxTokens: 1200,
      ...(request.signal ? { signal: request.signal } : {}),
      ...(request.progress ? { onProgress: (progress: Progress) => request.progress!({ step: 'answer', ...progress }) } : {}),
    })
  } catch (error) {
    if (request.signal?.aborted) return outcome('', undefined)
    throw error
  }
  if (request.signal?.aborted) return outcome('', undefined)
  return outcome(result.text.trim(), result)
}
