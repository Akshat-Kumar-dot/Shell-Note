// Recipes and the shape rules (note control, step 5;): each recipe's blocks are the ones its rule says, through apply;
// the shape rules choose the right shape on written cases, each labelled by hand.
import { describe, expect, it } from 'vitest'
import { apply } from '../../src/apply.js'
import { idTaken } from '../../src/ids.js'
import { compileNote, type NoteInput } from '../../src/note/compile.js'
import { featuresOf, shapeOf, type Shape } from '../../src/note/recipes.js'
import type { Block, Doc } from '../../src/schema/doc.js'
import { MIXED } from '../fixtures/index.js'

const context = (doc: Doc) => ({ page: 1, taken: (id: string) => idTaken(doc, id) })
const run = (command: string, input: NoteInput) => {
  const compiled = compileNote(MIXED, command, input, context(MIXED))
  const doc = apply(MIXED, compiled.ops).doc
  return { ...compiled, doc, blocks: compiled.made.map((id) => doc.block[id] as Extract<Block, { type: 'text' }>) }
}
const shapes = (blocks: { role: string; md: string }[]): string[] => blocks.map((block) => `${block.role} ${block.md}`)

describe('the recipes', () => {
  it('qa: each question a heading 3, its answer a paragraph, from Q:/A: lines or questions ending in ?', () => {
    const qa = run('recipe.qa', { after: 'p2', words: 'Q: What does a wave carry?\nA: Energy, not matter.\nQ2. What links period and frequency?\nA2: f = 1/T.' })
    expect(shapes(qa.blocks)).toEqual(['h3 What does a wave carry?', 'p Energy, not matter.', 'h3 What links period and frequency?', 'p f = 1/T.'])
    expect(qa.said).toMatch(/^made 2 questions and answers \(/u)
    expect(qa.choice).toMatchObject({ shape: 'qa', by: 'recipe' })
    const plain = run('recipe.qa', { words: 'Why do waves interfere?\nThey add up where they meet.\nIt can cancel too.\nWhat is a node?\nA point that does not move.' })
    expect(shapes(plain.blocks)).toEqual(['h3 Why do waves interfere?', 'p They add up where they meet. It can cancel too.', 'h3 What is a node?', 'p A point that does not move.'])
    expect(() => compileNote(MIXED, 'recipe.qa', { words: 'No questions here.' }, context(MIXED))).toThrow('No question')
  })

  it('section and summary: a heading 2, then the points as a list', () => {
    expect(shapes(run('recipe.section', { words: '## Kinds of waves:\n- Transverse\n- Longitudinal' }).blocks)).toEqual(['h2 Kinds of waves', 'li Transverse', 'li Longitudinal'])
    expect(shapes(run('recipe.summary', { words: 'Waves carry energy\nf = 1/T' }).blocks)).toEqual(['h2 Summary', 'li Waves carry energy', 'li f = 1/T'])
  })

  it('steps: a numbered list, their numbers taken off (st1); definition: a quote, the term in bold (df1)', () => {
    expect(shapes(run('recipe.steps', { words: '1. Measure the period\n2) Compute the frequency\nStep 3: Check the units' }).blocks)).toEqual(['oli Measure the period', 'oli Compute the frequency', 'oli Check the units'])
    expect(shapes(run('recipe.definition', { words: 'Wavelength\nThe distance between two crests.' }).blocks)).toEqual(['quote **Wavelength**: The distance between two crests.'])
    expect(shapes(run('recipe.definition', { words: 'Amplitude: the height of a wave from its middle' }).blocks)).toEqual(['quote **Amplitude**: the height of a wave from its middle'])
  })

  it('compare: a table, its first line the header row, banded, from Thing: a; b lines or a Markdown table', () => {
    const made = run('recipe.compare', { after: 'p1', words: 'Wave: Speed; Medium\nSound: 343 m/s; air\nLight: 3e8 m/s; none' })
    expect(made.doc.block[made.made[0]!]).toMatchObject({ type: 'table', rows: [['Wave', 'Speed', 'Medium'], ['Sound', '343 m/s', 'air'], ['Light', '3e8 m/s', 'none']], head: true, look: 'banded' })
  })

  it('write: add writes the content in the shape the rules choose, and says which and why (sh1)', () => {
    const steps = run('write.add', { after: 'p2', words: 'First, measure the period\nThen compute the frequency\nFinally check the units' })
    expect(steps.said).toMatch(/^wrote it as numbered steps \(steps in order\): made 3 steps/u)
    expect(steps.choice).toMatchObject({ shape: 'steps', by: 'rules' })
    const table = run('write.add', { words: '| a | b |\n|---|---|\n| 1 | 2 |' })
    expect(table.doc.block[table.made[0]!]).toMatchObject({ type: 'table' })
    // The log keeps features only (cl1): no word of the content.
    expect(JSON.stringify(steps.choice)).not.toMatch(/period|frequency/u)
  })
})

// Written cases, each labelled by hand with the shape a person would want, before the rules were run on them.
const CASES: [string, Shape][] = [
  ['Measure the period\nCompute the frequency\nCheck the units', 'list'],
  ['1. Boil the water\n2. Add the tea\n3. Wait three minutes', 'steps'],
  ['First, open the box.\nThen take out the kit.\nFinally, plug it in.', 'steps'],
  ['Step 1: wet the paper\nStep 2: add the drop\nStep 3: watch it spread', 'steps'],
  ['- Transverse waves\n- Longitudinal waves\n- Surface waves', 'list'],
  ['Red\nGreen\nBlue', 'list'],
  ['apples, pears and plums', 'paragraphs'],
  ['| Wave | Speed |\n|---|---|\n| Sound | 343 m/s |', 'table'],
  ['Wave | Speed\nSound | 343 m/s\nLight | 3e8 m/s', 'table'],
  ['Wavelength: the distance between two crests', 'definition'],
  ['Amplitude is the height of a wave from its middle.', 'definition'],
  ['Frequency means how many waves pass each second', 'definition'],
  ['E = mc^2', 'formula'],
  ['\\frac{1}{2} m v^2', 'formula'],
  ['v = f \\lambda', 'formula'],
  ['F = ma', 'formula'],
  ['flowchart LR\n  A --> B', 'diagram'],
  ['pie title Pets\n  "Dogs" : 3\n  "Cats" : 2', 'diagram'],
  ['A wave carries energy from one place to another without carrying matter with it. This is why a boat bobs up and down as a wave passes under it.', 'paragraphs'],
  ['Waves are everywhere. Sound is a wave, and so is light.\n\nThey carry energy, not matter.', 'paragraphs'],
  ['The lab kit costs $5.', 'paragraphs'],
  ['Remember to bring the kit tomorrow, and the notes from last week, because we will need both.', 'paragraphs'],
  ['Pros: cheap; light\nCons: slow; noisy', 'list'],
  ['Mercury\nVenus\nEarth\nMars', 'list'],
  ['Next, add the salt\nThen stir well\nAfter that, taste it', 'steps'],
  ['Q-learning\nSARSA\nDeep Q networks', 'list'],
  ['Newton: the unit of force', 'definition'],
  ['Photosynthesis is how plants make food from light.', 'definition'],
  ['a^2 + b^2 = c^2', 'formula'],
  ['\\int_0^1 x^2 \\, dx', 'formula'],
  ['xychart-beta\n  x-axis [a, b]\n  bar [1, 2]', 'diagram'],
  ['Buy batteries\nTest the speaker', 'list'],
  ['1) Read the question\n2) Underline the key words\n3) Plan the answer\n4) Write it', 'steps'],
  ['Name | Age\nAnn | 31', 'table'],
  ['It was a cold morning. The lab was empty, and the tank was still.', 'paragraphs'],
  ['* light\n* sound\n* water waves', 'list'],
  ['Inertia: an object keeps its motion unless a force acts', 'definition'],
  ['Heat the metal\nMeasure its length\nWork out the expansion', 'list'],
  ['The ripple tank shows how waves spread.\nIt shows how they bend round a gap.\nAnd how they meet.', 'paragraphs'],
  ['sin^2 x + cos^2 x = 1', 'formula'],
]

// Written after the rules were changed for the first set's five misses (35 of 40 at first), before they were run on
// these: 15 of 15.
const FRESH: [string, Shape][] = [
  ['Lungs\nHeart\nKidneys', 'list'],
  ['Preheat the oven\n2. Mix the flour\n3. Bake for 20 minutes', 'steps'],
  ['Osmosis: water moving across a membrane', 'definition'],
  ['p = mv', 'formula'],
  ['| Planet | Moons |\n| Earth | 1 |\n| Mars | 2 |', 'table'],
  ['The experiment failed because the tank leaked. We will repeat it on Monday with a new seal.', 'paragraphs'],
  ['graph TD\n  A --> B', 'diagram'],
  ['Then rinse the beaker\nThen dry it\nThen label it', 'steps'],
  ['Velocity is speed in a given direction.', 'definition'],
  ['x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}', 'formula'],
  ['- check the wiring\n- replace the fuse', 'list'],
  ['Cats: independent; quiet\nDogs: loyal; loud', 'list'],
  ['I think the second method is better, since it needs fewer steps and less kit.', 'paragraphs'],
  ['Energy\nThe ability to do work.', 'definition'],
  ['Hydrogen\nHelium\nLithium\nBeryllium\nBoron', 'list'],
]

describe('the shape rules on written cases', () => {
  it('choose the shape each case is labelled with', () => {
    const wrong = CASES.filter(([words, shape]) => shapeOf(words).shape !== shape).map(([words, shape]) => `${JSON.stringify(words)}: ${shapeOf(words).shape}, labelled ${shape}`)
    expect(wrong).toEqual([])
    expect(CASES).toHaveLength(40)
    expect(FRESH.filter(([words, shape]) => shapeOf(words).shape !== shape)).toEqual([])
  })

  it('keep the features of a content and none of its words (cl1)', () => {
    expect(Object.values(featuresOf('Wavelength: the distance between two crests')).every((value) => typeof value === 'number' || typeof value === 'boolean')).toBe(true)
  })
})
