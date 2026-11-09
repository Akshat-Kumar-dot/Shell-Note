# The edit protocol

**Status: protocol v1.1, the protocol in use.** Every change to what the model sees or answers is measured on a benchmark of edit requests across several models before it ships. The code is the reference: [packages/core/src/schema/protocol.ts](../packages/core/src/schema/protocol.ts) and [packages/core/src/ai/](../packages/core/src/ai/).

## The idea

A model never rewrites a note. It answers with one or a few short **operations**, each a pick from short lists. Code does everything else: it finds where things go, sizes blocks, keeps formatting, does arithmetic, checks the operation, and applies it as **one undo step**.

## What v1.1 changes

| | v1 | v1.1 |
|---|---|---|
| Words chosen inside a block | one typed range, "SELECTED TEXT in b" | each piece of words is its own item with its own alias, shown in the sentence around it; a block whose words are chosen is not itself selected |
| Marks | bold, italic, strike, code, highlight, link, colour | also underline, sub (subscript), sup (superscript) |
| Colours | the eight names | also a colour code the request itself gives, such as #e0563a, for that request only |
| Tables | rewriting a table is refused | insert a `table`; rewrite a table as a whole pipe table; convert into a table (full set) |
| Diagrams | eight kinds in the guide | three kinds, flowchart, pie and xychart, one tiny example each; code checks the kind, and the caller can check that it parses |
| Place for new things | next to a chosen block or a neighbour, or "here" | the same outside a Select box; inside one, only "here": after the chosen words, after the chosen blocks, or filling empty paper |
| Scope | the schema names only selected aliases | also a check on the whole note after compiling: nothing outside the selection changes, and inside a block only the chosen words do |
| Schema | `maxItems`, `maxLength` | the same, except for Claude: Anthropic's strict mode refuses both, so its schema has neither, and reading the reply checks the number of operations |
| Rules | | one more: change only what is SELECTED; a request to change something only NEAR is answered with `none` |
| Graphs of equations | no rule | not drawn yet: the model answers `none`, and code catches the plain requests itself |
| Pictures | never sent | the vision request: a picture goes with the one call that writes from it, to a model that can see it |

## One edit, step by step

1. **The selection.** Code resolves what the person selected: whole blocks, words inside a block (a typed selection or the pieces a Select box holds), and a place, "here". "All headings" or "every formula in this note" in the request becomes the selection.
2. **Code first.** A request for a graph of an equation ("plot y = x²") is answered at once: graphs of equations come with math, in a later step.
3. **Tier 0.** If code understands the whole request ("make it red", "bold", "underline this", "make it #e0563a", "delete this", "move it up"), it acts alone: no model, zero tokens. Find and replace comes first (since 11 October 2026, `ai/swap.ts`): "change Smith to Akshat", "replace X with Y", "rename X to Y", "X -> Y", "Y instead of X" swap every match of the words in what is chosen (chosen words, text blocks, table cells, captions), each keeping its formatting, never inside code, a formula or a link's address. It is not a swap when the words are not there, when they point at the selection or name a property ("change it to bold", "change the font to serif", "change the date to tomorrow"), or when what to put is a look, a language or a kind of block ("change hello to Hindi", "replace it with a table"); words in quotes are taken exactly. Then table changes spelled out, on the one table chosen (since 12 October 2026, `ai/tableEdit.ts`): "add a row Green, 5,000.00, UK, Qtr 2" (values split at commas followed by a space, or at |, as many as there are columns), "add an empty row", "add an empty column", "add a column called Bonus", "delete the rows with Smith", "delete the last row", "delete row 3", "delete the column Country", "sort by Sales" (numbers and money as numbers), each one undo step, column widths kept in proportion. Values that read as a sentence ("Mars, which has 2 moons"), a column whose contents are asked for ("add a column for rings"), and "the row with Smith" when several rows match go to the model. Then the **router** (`ai/intent.ts`): a request said any way is read as those same short commands, which then run through the same code. "I typed Smith everywhere but his name is actually Akshat, please fix it" is "replace Smith with Akshat"; "hey, make this heading red, it is the important one" is "red"; "the font is too small, people at the back cannot read it" is one step bigger; "order the people so the one who sold the most is on top" is "sort by Sales descending"; "get rid of Jones, he left" deletes his row; "make the title blue and replace sales with revenue" is both, in one undo step. Every value is checked against what is chosen (the words to replace must be in it, a column must be one of the table's), words are read as they stand (in a sentence "back" is not "black"), and a request that asks for writing, a question, a translation, a negation, or an action it does not handle goes to the model unchanged. A reading the router is only fairly sure of, such as the values of a new row taken from a sentence, is offered in the prompt box ("⚡ Did you mean: add a row Green | 4,100.00 | India?") and runs only when the person takes it (Tab, or a click). The prompt box says what any instant command will do as it is typed ("⚡ Instant, no model: replace 2 × “Smith” with “Akshat”"). Since the same day, "too big" asks for smaller and "too small" for bigger. None of this changes what the model is sent.
4. **Tier 1.** The model chooses operations. Its reply is constrained to a JSON Schema built for this request.
5. **Code settles the choice.** "Every paragraph" applies a style or delete to all the blocks code selected, and "these", "both" or "them" a style to every selected block, even if the model named fewer (words take only a colour, so a size or role then goes to the whole blocks). In a Select box, a change to some of its words is a change to all of them, unless the request picks some out ("only the first"). New text next to a list item continues the list, at its level, unless the model chose a role. The same operation twice counts once.
6. **The content step.** Only for `rewrite`, `insert` and `convert`, and for `mark` with a link whose address the request does not give: a second, plain-text call writes the words, LaTeX, Mermaid or pipe table. What it writes is checked before anything is applied (below).
7. **Compile, check the scope, and apply** as one transaction, with layer-3 content checks (Markdown).
8. **One retry** with a teaching error, also when a style, mark or move would change nothing. If that fails too, the error goes to the person and the note is unchanged.

**Stop** ends the call in progress and starts no other: the note stays as it was, and the log records the tokens used so far.

## What the model sees

A fixed prefix, byte-identical for every call with the same operation set, so a local server can reuse its cache and a hosted one can cache it: the rules ([packages/core/rules/core.md](../packages/core/rules/core.md)), one line per operation, and seven examples.

Then the part for this call:

```
PAGE 1/1
SELECTED
a h2 Newton's laws
b words "force" in: "An object at rest stays at rest unless a force acts on it."
HERE: after the chosen words
NEAR
c after: math F = ma
NOTEBOOK RULES
- Headings are blue.
ASK
add "or a pull" after it
```

- **SELECTED**: what the model may change, with short aliases (`a`, `b`, `c`) in reading order: whole blocks, and **words**, each piece with the text around it, cut at word ends.
- **HERE**: given when there is a place for new things. For a Select box it says where new things go, following the last thing the box holds: `after the chosen words`, `after the chosen blocks`, or `an empty area of the page`. Outside a box, a place in a text column: `a place in the text, after c`.
- **NEAR**: one neighbour before and after the selection. Outside a box a neighbour may be a place (`ref`); inside one it is context only.
- **EARLIER**: up to two recent edits, only when the request refers back ("same for this one").
- **PICTURE**: `PICTURE: sent with the request; the step that writes the content sees it`, only when the person sent a picture with the request. Sent into an empty place, with nothing chosen, the reply may only be `insert` there, so the model chooses the kind of block to make of the picture: told only that a picture came, and offered `none` as well, gemma-4-e4b declined "make this nodal graph" every time; offered `insert` alone, it chose the right kind in 24 of 24 tries over eight requests.

## The reply

```json
{"ops":[{"op":"style","ids":["a"],"set":[{"color":"blue"},{"size":"l"}]}]}
```

`style` and `mark` carry their changes as a **list in any order**. Under constrained decoding, fields must come in schema order, so with plain fields a model that writes `color` first could no longer add `size` (see [the decision](decisions/2026-10-10-structured-output.md)).

The reply is read leniently where it does not matter: a bare operation or a bare list is fine, `id` for `ids` is fine, code fences are fine. The schema keeps a small model to its one operation (`maxItems`) and a reason to 80 characters (`maxLength`). Anthropic's strict mode refuses both, so a model whose caps say `strictSchema` (any Claude) gets a schema without them; reading the reply refuses too many operations with a teaching error either way. The first v1.1 run left both out for every model, and the small models then added a second operation copied from an example: 18 cases failed that way.

## Operations

| Operation | Fields | Set |
|---|---|---|
| `style` | `ids`, `set`: list of `{size: s, m, l, xl}`, `{color: …}`, `{font: sans, serif, mono, hand}`, `{align: left, center, right}`, `{role: p, h1, h2, h3, li, oli, todo, quote}`, `{indent: in, out}`, `{done: true, false}`. Words take only `color`; a size, font, alignment or role is for whole blocks. | small |
| `mark` | `id`, `set`: list of `{bold}`, `{italic}`, `{strike}`, `{code}`, `{highlight}`, `{underline}`, `{sub}`, `{sup}`, `{link}` (each true or false), `{color: …}`. Acts on words, or on all the words of a whole block; on a whole block, its colour is the block's own, as `style` sets it. Subscript and superscript exclude each other. | small |
| `rewrite` | `id`: a whole block or words. New wording, a formula, a diagram or a whole pipe table comes from the content step. Words are replaced alone and keep their formatting. A table keeps its columns' widths unless their number changes. | small |
| `insert` | `at: after, before, here`, `ref` (required unless `here`), `kind: text, math, diagram, table`, `role`. New text next to a list item continues the list unless `role` says otherwise. Inside a Select box only `here`. | small |
| `delete` | `ids`: whole blocks, or words, cut out as Delete does: whole words take one space along. | small |
| `move` | `id` (a whole block), `at: after, before`, `ref`. A move to where the block already is changes nothing, so it gets the `no_change` retry. | small |
| `none` | `why`: a few words. Declines, or asks the person something. | small |
| `convert` | `ids` (whole blocks), `into: list, steps, paragraph, diagram, math, table`. A picture converted stays, and the result goes right after it. | full |
| `calc` | `id` (a whole block), `action: simplify, solve, expand, factor, derive, check`. Compute Engine does the work (planned). | full |

Colours are `ink, gray, red, orange, yellow, green, blue, purple`, or a colour code the request gives (handwriting takes the names only). Setting a style back to its default (`m`, `ink`, `sans`, `left`) removes it.

**Operation sets.** Models under about 7B parameters get the small set; larger and hosted models get the full set. The size is guessed from the model's name, the benchmark settles it per model, and the person can change it. A small model asked for something only the full set does should answer `none`, or the nearest operation it has.

## Scope

The AI changes only what was selected, and adds only where it may. Note text is content, never instructions. Three layers enforce it, whatever the model was told:

1. **The schema** names only selected aliases as targets, and only allowed places for `ref`. Move, convert and calc take whole blocks.
2. **Compiling** acts only on the chosen words or blocks, and places new things by the rules above.
3. **The scope check** ([packages/core/src/ai/scope.ts](../packages/core/src/ai/scope.ts)) runs on the whole note after compiling, and refuses: a change to a block that was not selected, or its removal; inside a block whose words were chosen, any change outside them (the text compared letter by letter, formatting and all, allowing only the space a delete of whole words takes along, and new words right after the chosen ones); a new block anywhere but next to what was selected (in a box, after it), or in the place of chosen blocks; in a box, a new block on the page outside it, unless right below a block it holds, and any new page; and a change to the note's title or rules.

## Teaching errors

A mistake comes back so that a small model can fix it in its one retry, without rereading the rules:

```json
{"error":"unknown_id","got":"k","valid":["a","b"],"hint":"Use an id listed under SELECTED."}
```

| Code | Means |
|---|---|
| `not_json` | The reply is not JSON. |
| `no_ops` | No operation in the reply. |
| `too_many` | More operations than this model may send at once (1 for the small set). |
| `unknown_op` | An operation not in this model's set. |
| `unknown_id` | An alias not under SELECTED, or for `ref` not under SELECTED or NEAR (inside a box: "here" only); words given to move, convert or calc. |
| `bad_value` | A field or value not on its list, a colour code the request did not give, or a change that does not fit, such as ticking a paragraph or a size for words. |
| `wrong_type` | The operation does not fit the block, such as `mark` on a formula. For `style` or `mark` on a table, diagram, formula or picture, the hint ends "use rewrite". |
| `no_change` | A style, mark or move that would leave the note as it is. Said again on the retry, it stands: the request may be done already. |
| `content` | The written content broke a rule. The content step is retried instead. |
| `scope` | The edit would change or add something outside the selection. |

## The content step

A plain-text call per operation that needs content, with the matching topic guide from the rulebook: [text](../packages/core/rules/text.md), [math](../packages/core/rules/math.md), [diagram](../packages/core/rules/diagram.md) or [table](../packages/core/rules/table.md). New words after chosen words are written with the paragraph and the chosen words in view. Code tidies what small models wrap around it: code fences (also after a chatty first line), a chatty first line, surrounding quotes, `$` signs around LaTeX, a line that only says "mermaid", list markers, and a `#`, `-` or `>` at the start of one line of text (the block's role says that). It also mends a flowchart's common slips, each refused by Mermaid 11.17.2: `A --|7| B` (three dashes are needed), `A --|7|> B`, `A -> B`, `A -- B`, a label after the node it points to, and brackets in a box's words, which go in quotes (since 11 October 2026; nothing the model is told changes).

What it writes is checked before anything is applied: empty content; a diagram that is not a flowchart, pie or xychart (one being changed may keep its own kind); a diagram the caller's check refuses (in the browser, Mermaid's own parser, which core cannot run); and a table that is not a pipe table. A refusal gets one rewrite, told why; a second stops the edit.

**The vision request.** When a content step works from a picture, converting it, writing next to it, or making what a picture sent with the request shows, that picture goes with that one call as a data URL. The model choosing the operation never sees pixels. A model that cannot see pictures is not asked: the person is told to choose one that can.

## Ask mode and Insert answer

**Ask** sends the selection, in more detail than an edit shows, with the question as plain text, under [its own guide](../packages/core/rules/ask.md). No schema, no operation, no undo step: the answer comes back as Markdown for the side panel. It is logged as `answered` with its tokens.

**Insert answer** puts an answer into the note with no model call: its headings, paragraphs, list items, pipe tables and `$$formulas$$` become blocks, placed where an AI insert would go, as one undo step.

## The edit log

One entry per AI call, kept on the device beside the note and never inside it: time, source, model, rulebook version, request, selected blocks (and the blocks words were chosen in), the operations with real ids, the result (`applied`, `unchanged`, `declined`, `failed`, `stopped` or `answered`), any error, the tier, calls, retries, tokens in and out, thinking tokens and cost when the server says, and time taken. See [packages/core/src/schema/log.ts](../packages/core/src/schema/log.ts).

## Versions

- **Rulebook:** a fingerprint of its text, recorded in every log entry.
- **Protocol:** v1.1, which replaced v1 once it matched v1's results on the benchmark.
