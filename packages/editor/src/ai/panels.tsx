// The AI's side panels. The answer to an Ask, shown as the
// blocks it would become, with "Insert answer": an ordinary edit with no
// model call, into the Select box or after what was asked about. And the edit
// log: every request, newest first, with its model, tier, tokens and time,
// and Undo while the edit is still the latest change to its blocks.
import { answerBlocks, logLine, parseInline, parsePipeTable, type LogEntry } from '@shellnote/core'
import { X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { InlineView } from '../blocks.js'
import { inDesktopApp } from '../host.js'
import type { EditorStore } from '../store.js'
import { modelName, type AskAnswer } from './AiLayer.js'
import { CHANGED_SINCE, insertAnswer, undoEdit, type Undo } from './run.js'

/** One request in the edit log, with what undoes it when it changed the note. */
export interface LogItem {
  entry: LogEntry
  undo?: Undo
  /** Undone from the log. */
  undone?: true
}

/** An answer or the log, with its title; a close button when it can close on its own (inside the side panel's Output, the log closes with the panel). */
function Side({ title, onClose, children }: { title: string; onClose?: (() => void) | undefined; children: ReactNode }) {
  return (
    <aside className="nw-side" aria-label={title}>
      <header className="nw-side-head">
        <h2>{title}</h2>
        {onClose ? (
          <button type="button" className="nw-ibtn" aria-label={`Close ${title.toLowerCase()}`} title="Close" onClick={onClose}>
            <X size={16} aria-hidden />
          </button>
        ) : null}
      </header>
      {children}
    </aside>
  )
}

/** An answer as the blocks Insert answer would make: paragraphs, list items, tables and formulas. */
function AnswerView({ answer }: { answer: string }) {
  return (
    <div className="nw-answer">
      {answerBlocks(answer).map((block, i) => {
        if (block.kind === 'table') {
          const table = parsePipeTable(block.content)!
          return (
            <table key={i}>
              <tbody>
                {table.rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => {
                      const Cell = r === 0 && table.head ? 'th' : 'td'
                      return (
                        <Cell key={c}>
                          <InlineView nodes={parseInline(cell)} />
                        </Cell>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
        if (block.kind === 'math') return <pre key={i}>{block.content}</pre>
        return (
          <p key={i} data-role={block.role} style={{ marginLeft: `${block.indent * 1.2}em` }}>
            <InlineView nodes={parseInline(block.content)} />
          </p>
        )
      })}
    </div>
  )
}

export function AskPanel({ answer, store, onClose }: { answer: AskAnswer; store: EditorStore; onClose: () => void }) {
  const [said, setSaid] = useState<string>()
  const insert = (): void => {
    setSaid(
      insertAnswer(store, answer.answer, answer.selection)
        ? 'Put into the note, as one step: Undo (Ctrl+Z) takes it out.'
        : 'There is nowhere to put it now: what was asked about has gone. Choose a place and ask again.',
    )
  }
  return (
    <Side title="Answer" onClose={onClose}>
      <p className="nw-side-question">{answer.question}</p>
      <AnswerView answer={answer.answer} />
      <p className="nw-side-meta">Answered by {answer.model}. The note has not changed.</p>
      <div className="nw-side-actions">
        <button type="button" className="nw-side-button" onClick={insert}>
          Insert answer
        </button>
      </div>
      <p className="nw-side-said" role="status">
        {said ?? ''}
      </p>
    </Side>
  )
}

const RESULT: Record<LogEntry['result'], string> = {
  applied: 'Changed the note',
  unchanged: 'Nothing to change',
  declined: 'Declined',
  failed: 'Failed',
  stopped: 'Stopped',
  answered: 'Answered',
}

const time = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

export function LogPanel({ items, store, onUndone, onClose }: { items: readonly LogItem[]; store: EditorStore; onUndone: (index: number) => void; onClose?: (() => void) | undefined }) {
  const [said, setSaid] = useState<string>()
  const undo = (index: number): void => {
    const item = items[index]!
    if (undoEdit(store, item.undo!)) {
      onUndone(index)
      setSaid('Undone.')
    } else setSaid(CHANGED_SINCE)
  }
  return (
    <Side title="AI log" onClose={onClose}>
      <p className="nw-side-meta">Kept with this note {inDesktopApp() ? 'in the app' : 'in this browser'}, never in its file.</p>
      <p className="nw-side-said" role="status">
        {said ?? ''}
      </p>
      {items.length === 0 ? <p className="nw-side-meta">No AI requests on this note yet.</p> : null}
      <ol className="nw-log" reversed>
        {items
          .map((item, index) => ({ item, index }))
          .reverse()
          .map(({ item: { entry, undo: change, undone }, index }) => (
            <li key={`${entry.at}-${index}`} className="nw-log-entry" data-result={entry.result}>
              <div className="nw-log-top">
                <span>{time(entry.at)}</span>
                {/* An edit from outside the app, through the MCP server: the program that made it, by the name it gave itself. */}
                <span>{entry.source === 'mcp' ? `assistant: ${entry.model}` : entry.tier === 0 ? 'no model' : modelName(entry.model)}</span>
                <span>{RESULT[entry.result]}</span>
              </div>
              <p className="nw-log-request">{entry.instruction || (entry.source === 'mcp' ? logLine(entry) : '')}</p>
              <div className="nw-log-used">
                {entry.source === 'mcp' ? (
                  <span>From outside the app</span>
                ) : (
                  <>
                    <span>Tier {entry.tier}</span>
                    <span>
                      {entry.tokensIn.toLocaleString('en')} in / {entry.tokensOut.toLocaleString('en')} out
                    </span>
                  </>
                )}
                {entry.cost === undefined ? null : <span>${entry.cost.toFixed(4)}</span>}
                <span>{(entry.ms / 1000).toFixed(1)} s</span>
              </div>
              {entry.error ? <p className="nw-log-error">{entry.error}</p> : null}
              {change ? (
                <button type="button" className="nw-side-button" disabled={undone === true} data-command="ai.undo" onClick={() => undo(index)}>
                  {undone ? 'Undone' : 'Undo'}
                </button>
              ) : null}
            </li>
          ))}
      </ol>
    </Side>
  )
}
