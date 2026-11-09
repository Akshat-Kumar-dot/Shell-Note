// Whether a program's view has changed (other programs inside ShellNote, stage 4, step 7;: a line keeps a small picture
// only when the view changed since the last one kept): frames compared on a small grey copy, only whether they differ,
// never where or what. Measured on real frames.

/** The small copy's size: a frame's shape does not matter, each cell being a part of it. */
const ACROSS = 32
const DOWN = 20

/** A small grey copy of a frame: red, green, blue and alpha, row by row, each cell the average of every other pixel. */
export function greyOf(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  const grey = new Uint8Array(ACROSS * DOWN)
  for (let row = 0; row < DOWN; row++) {
    const [y0, y1] = [Math.floor((row * height) / DOWN), Math.floor(((row + 1) * height) / DOWN)]
    for (let column = 0; column < ACROSS; column++) {
      const [x0, x1] = [Math.floor((column * width) / ACROSS), Math.floor(((column + 1) * width) / ACROSS)]
      let [sum, count] = [0, 0]
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const at = (y * width + x) * 4
          sum += rgba[at]! * 0.3 + rgba[at + 1]! * 0.59 + rgba[at + 2]! * 0.11
          count++
        }
      }
      grey[row * ACROSS + column] = count > 0 ? Math.round(sum / count) : 0
    }
  }
  return grey
}

/**
 * A cell counts as changed past this much, of 255, and the view with this many of the 640 cells: measured, a button lit, a
 * word typed or a clock's seconds change 4 at most, a page scrolled 60 px 141. Averaging hides a change of words alone (a
 * next slide much like the last changes 2 or 3), which the place tells instead.
 */
export const CELL_CHANGES = 2
export const CELLS_CHANGE = 12

/** How many cells of two small copies differ. */
export function cellsChanged(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let changed = 0
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > CELL_CHANGES) changed++
  return changed
}

export const viewChanged = (a: ArrayLike<number>, b: ArrayLike<number>): boolean => cellsChanged(a, b) >= CELLS_CHANGE

/** The most across a kept picture is, in pixels: small, as a thumbnail. */
const KEPT_WIDE = 640

/** A frame as a small picture to keep. */
export async function smallPicture(rgba: Uint8ClampedArray<ArrayBuffer>, width: number, height: number): Promise<Blob> {
  const whole = new OffscreenCanvas(width, height)
  whole.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0)
  const scale = Math.min(1, KEPT_WIDE / width)
  const small = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)))
  small.getContext('2d')!.drawImage(whole, 0, 0, small.width, small.height)
  return small.convertToBlob({ type: 'image/webp', quality: 0.7 })
}
