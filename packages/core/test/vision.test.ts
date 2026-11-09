// The vision request (protocol v1.1): turning a picture
// into a table or text sends that one picture to a model that can see it,
// only on that request; the picture stays, and the result goes right after it.
import { describe, expect, it } from 'vitest'
import { NO_PICTURE, NO_VISION, runEdit, userPrompt, makeAliases, type Caps, type CompleteRequest, type Frame, type Model, type Part } from '../src/index.js'
import { MIXED, PHYSICS } from './fixtures/index.js'

function scripted(replies: string[], caps: Partial<Caps> = {}): Model & { asked: CompleteRequest[] } {
  const asked: CompleteRequest[] = []
  return {
    name: 'scripted',
    caps: { jsonSchema: true, inlineContent: false, vision: true, opSet: 'full', ...caps },
    asked,
    async complete(request) {
      asked.push(request)
      return { text: replies.shift() ?? '', tokensIn: 10, tokensOut: 5, ms: 1 }
    },
  }
}

const TABLE = '| Force | Arrow |\n| --- | --- |\n| Weight | down |\n| Normal | up |'
const pictures: Record<string, string> = { a91f: 'data:image/png;base64,AAAA', b7c4: 'data:image/jpeg;base64,BBBB' }
const picture = async (asset: string): Promise<string | undefined> => pictures[asset]

describe('a picture turned into a table or text', () => {
  it('sends the picture with the writing call only, and keeps it, with the table just below it', async () => {
    const model = scripted(['{"ops":[{"op":"convert","ids":["a"],"into":"table"}]}', TABLE])
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['g1'] }, instruction: 'turn this picture into a table of its forces', model, picture })
    // The choice sees no pixels; the writing call gets the picture.
    expect(JSON.stringify(model.asked[0]!.messages)).not.toContain('image_url')
    const write = model.asked[1]!.messages
    expect(write[0]!.content).toContain('The picture is attached: write what it shows.')
    expect((write[1]!.content as Part[])[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } })
    // The picture stays; the table goes in a new frame just below it, in its column.
    expect(out.doc.block.g1).toEqual(PHYSICS.block.g1)
    const frame = Object.values(out.doc.block).find((b): b is Frame => b.type === 'frame' && b.id !== 'f1')!
    expect(frame).toMatchObject({ page: 'p1', x: 11000, w: 8000 })
    expect(frame.y).toBeGreaterThanOrEqual(12000 + 6000)
    expect(out.doc.block[frame.kids[0]!]).toMatchObject({ type: 'table', rows: [['Force', 'Arrow'], ['Weight', 'down'], ['Normal', 'up']] })
  })

  it('puts the result right after a picture in a text column', async () => {
    const model = scripted(['{"ops":[{"op":"insert","at":"after","ref":"a","kind":"text"}]}', 'A sine wave, its period marked.'], { opSet: 'small' })
    const out = await runEdit({ doc: MIXED, selection: { blocks: ['ic'] }, instruction: 'write what this picture shows', model, picture })
    expect(((model.asked[1]!.messages[1]!.content as Part[])[1] as Extract<Part, { type: 'image_url' }>).image_url.url).toBe('data:image/png;base64,AAAA')
    const kids = (out.doc.block.fa as Frame).kids
    expect(out.doc.block[kids[kids.indexOf('ic') + 1]!]).toMatchObject({ type: 'text', md: 'A sine wave, its period marked.' })
  })

  it('in a Select box that holds the picture, goes just below it', async () => {
    const here = { page: 'w2', x: 1500, y: 5500, w: 10000, h: 7000 }
    expect(userPrompt({ doc: MIXED, selection: { blocks: ['gi'], here }, aliases: makeAliases(MIXED, { blocks: ['gi'], here }), instruction: 'x' })).toContain('HERE: after the chosen blocks')
    const model = scripted(['{"ops":[{"op":"insert","at":"here","kind":"table"}]}', TABLE])
    const out = await runEdit({ doc: MIXED, selection: { blocks: ['gi'], here }, instruction: 'make a table from this photo', model, picture })
    expect(((model.asked[1]!.messages[1]!.content as Part[])[1] as Extract<Part, { type: 'image_url' }>).image_url.url).toBe('data:image/jpeg;base64,BBBB')
    expect(out.error).toBeUndefined()
    const frame = Object.values(out.doc.block).find((b): b is Frame => b.type === 'frame' && b.page === 'w2' && b.id !== 'fc')!
    expect(frame).toMatchObject({ x: 2000, w: 9000 })
    expect(frame.y).toBeGreaterThanOrEqual(6000 + 6000)
  })

  it('says so, with no writing call, when the model cannot see pictures', async () => {
    const model = scripted(['{"ops":[{"op":"convert","ids":["a"],"into":"table"}]}'], { vision: false })
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['g1'] }, instruction: 'turn this picture into a table', model, picture })
    expect(model.asked).toHaveLength(1)
    expect(out).toMatchObject({ declined: NO_VISION, doc: PHYSICS, log: { result: 'declined' } })
  })

  it('says so when the picture\'s file is missing', async () => {
    const model = scripted(['{"ops":[{"op":"convert","ids":["a"],"into":"table"}]}'])
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: ['g1'] }, instruction: 'turn this picture into a table', model, picture: async () => undefined })
    expect(out).toMatchObject({ declined: NO_PICTURE, doc: PHYSICS })
  })

  it('reads a picture sent with the request, without putting it in the note', async () => {
    const model = scripted(['{"ops":[{"op":"insert","at":"here","kind":"table"}]}', TABLE])
    const box = { page: 'p1', x: 2000, y: 22000, w: 12000, h: 5000 }
    const sent = 'data:image/jpeg;base64,CCCC'
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: [], here: box }, instruction: 'copy the table in this photo here', model, attachment: sent })
    // The choice sees no pixels, but is told a picture came; the writing call gets the picture sent.
    expect(JSON.stringify(model.asked[0]!.messages)).not.toContain('image_url')
    expect(model.asked[0]!.messages[1]!.content).toContain('PICTURE: sent with the request')
    expect((model.asked[1]!.messages[1]!.content as Part[])[1]).toEqual({ type: 'image_url', image_url: { url: sent } })
    // The table fills the box; no picture is added.
    const added = Object.values(out.doc.block).filter((b) => !PHYSICS.block[b.id])
    expect(added.map((b) => b.type).sort()).toEqual(['frame', 'table'])
    const frame = added.find((b): b is Frame => b.type === 'frame')!
    expect(frame).toMatchObject({ page: 'p1', x: 2000, y: 22000 })
  })

  it('into an empty place, offers only insert, so the model chooses what kind of block to make of the picture', async () => {
    // Offered none as well, gemma-4-e4b declined "make this nodal graph" every time (found in testing).
    type Op = { properties: { op: { const: string } } }
    const offered = (request: CompleteRequest): string[] => {
      const items = (request.schema as { properties: { ops: { items: Op & { anyOf?: Op[] } } } }).properties.ops.items
      return (items.anyOf ?? [items]).map((op) => op.properties.op.const)
    }
    const box = { page: 'p1', x: 2000, y: 22000, w: 12000, h: 5000 }
    const sent = 'data:image/png;base64,DDDD'
    const into = scripted(['{"ops":[{"op":"insert","at":"here","kind":"diagram"}]}', 'flowchart LR\n  1 --> 2'])
    const out = await runEdit({ doc: PHYSICS, selection: { blocks: [], here: box }, instruction: 'hey make this nodal graph', model: into, attachment: sent, tier0: false })
    expect(offered(into.asked[0]!)).toEqual(['insert'])
    expect(Object.values(out.doc.block).find((b) => !PHYSICS.block[b.id] && b.type === 'diagram')).toMatchObject({ src: 'flowchart LR\n  1 --> 2' })
    // With a block chosen, the picture may change it: every operation is offered, none too.
    const onto = scripted(['{"ops":[{"op":"none","why":"No."}]}'])
    await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'add what this picture says', model: onto, attachment: sent, tier0: false })
    expect(offered(onto.asked[0]!)).toContain('none')
    expect(offered(onto.asked[0]!)).toContain('rewrite')
    // Without a picture, nothing changes in what is asked.
    const plain = scripted(['{"ops":[{"op":"none","why":"No."}]}'])
    await runEdit({ doc: PHYSICS, selection: { blocks: [], here: box }, instruction: 'make a graph of nodes here', model: plain, tier0: false })
    expect(offered(plain.asked[0]!)).toContain('none')
    expect(plain.asked[0]!.messages[1]!.content).not.toContain('PICTURE')
  })

  it('sends no picture for a request that is not about one', async () => {
    const model = scripted(['{"ops":[{"op":"insert","at":"after","ref":"a","kind":"text"}]}', 'Weight pulls down.'])
    await runEdit({ doc: PHYSICS, selection: { blocks: ['t2'] }, instruction: 'add a sentence about weight after this', model, picture })
    expect(JSON.stringify(model.asked)).not.toContain('image_url')
  })
})
