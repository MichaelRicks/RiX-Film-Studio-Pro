/**
 * Layout for "Assemble my images into a sheet": places the user's pictures as tiles on a fixed
 * canvas (1920x1080) so they fill as much of it as possible. Tries rows, columns, and "first image as
 * a full-height column with the rest beside it", keeps the arrangement that covers the most area,
 * then stretches the cells to the canvas edges. A picture whose cell ends up a different shape is
 * cropped a little ("cover"), never squashed, and never by more than MAX_CROP of its size.
 */
export interface LayoutItem {
  aspect: number // width / height
  // People are cropped from the bottom so heads stay in frame; everything else from the centre.
  keepTop?: boolean
  // How much this tile's size matters when choosing the arrangement (the character: 2).
  weight?: number
}

export interface PlacedTile {
  index: number
  // Where to draw on the canvas.
  dx: number; dy: number; dw: number; dh: number
  // Which part of the source picture to draw, as fractions of its width and height.
  sx: number; sy: number; sw: number; sh: number
}

interface Cell { index: number; x: number; y: number; w: number; h: number }
interface Arrangement { cells: Cell[]; w: number; h: number }

const MAX_CROP = 0.12

/** All ways to split [0..n) into `parts` contiguous, non-empty groups. */
function splits(n: number, parts: number): number[][][] {
  if (parts === 1) return [[Array.from({ length: n }, (_, i) => i)]]
  const out: number[][][] = []
  for (let first = 1; first <= n - parts + 1; first++) {
    for (const rest of splits(n - first, parts - 1)) {
      out.push([Array.from({ length: first }, (_, i) => i), ...rest.map(g => g.map(i => i + first))])
    }
  }
  return out
}

/** Justified rows across width W: each row's height makes its pictures exactly fill W. */
function rows(items: LayoutItem[], ids: number[], groups: number[][], W: number): Arrangement {
  const cells: Cell[] = []
  let y = 0
  for (const g of groups) {
    const h = W / g.reduce((a, i) => a + items[ids[i]].aspect, 0)
    let x = 0
    for (const i of g) {
      const w = h * items[ids[i]].aspect
      cells.push({ index: ids[i], x, y, w, h })
      x += w
    }
    y += h
  }
  return { cells, w: W, h: y }
}

/** Justified columns down height H. */
function cols(items: LayoutItem[], ids: number[], groups: number[][], H: number): Arrangement {
  const cells: Cell[] = []
  let x = 0
  for (const g of groups) {
    const w = H / g.reduce((a, i) => a + 1 / items[ids[i]].aspect, 0)
    let y = 0
    for (const i of g) {
      const h = w / items[ids[i]].aspect
      cells.push({ index: ids[i], x, y, w, h })
      y += h
    }
    x += w
  }
  return { cells, w: x, h: H }
}

function fitScale(a: Arrangement, W: number, H: number): number {
  return Math.min(W / a.w, H / a.h)
}

/** Every candidate arrangement of `ids` within a W x H box. */
function candidates(items: LayoutItem[], ids: number[], W: number, H: number): Arrangement[] {
  const n = ids.length
  const out: Arrangement[] = []
  for (let parts = 1; parts <= Math.min(3, n); parts++) {
    for (const g of splits(n, parts)) {
      out.push(rows(items, ids, g, W))
      out.push(cols(items, ids, g, H))
    }
  }
  return out
}

/** Area of the tiles, counting important tiles (the character) more. */
function weightedArea(items: LayoutItem[], a: Arrangement): number {
  return a.cells.reduce((s, c) => s + c.w * c.h * (items[c.index].weight ?? 1), 0)
}

function best(items: LayoutItem[], ids: number[], W: number, H: number): Arrangement {
  let top: Arrangement | null = null
  let topScore = -1
  for (const a of candidates(items, ids, W, H)) {
    const k = fitScale(a, W, H)
    const score = weightedArea(items, a) * k * k
    if (score > topScore) { top = a; topScore = score }
  }
  const k = fitScale(top!, W, H)
  return { cells: top!.cells.map(c => ({ ...c, x: c.x * k, y: c.y * k, w: c.w * k, h: c.h * k })), w: top!.w * k, h: top!.h * k }
}

export function layoutSheet(items: LayoutItem[], canvasW = 1920, canvasH = 1080, gap = 12, margin = 0): PlacedTile[] {
  if (items.length === 0) return []
  // Lay out inside the margin; the gap is taken out of each cell below.
  const W = canvasW - 2 * margin, H = canvasH - 2 * margin
  const ids = items.map((_, i) => i)
  const options: Arrangement[] = [best(items, ids, W, H)]
  // The first picture (the character) as a full-height column, the rest arranged beside it. Only
  // when it really is full height: a wide first picture would leave a hole under it.
  if (items.length >= 2 && H * items[0].aspect <= W * 0.6) {
    const colW = H * items[0].aspect
    const lead: Cell = { index: 0, x: 0, y: 0, w: colW, h: colW / items[0].aspect }
    const rest = best(items, ids.slice(1), W - colW, H)
    options.push({ cells: [lead, ...rest.cells.map(c => ({ ...c, x: c.x + colW }))], w: colW + rest.w, h: Math.max(lead.h, rest.h) })
  }
  const chosen = options.reduce((a, b) => (weightedArea(items, b) > weightedArea(items, a) ? b : a))

  // Stretch the cells to the canvas edges, but only as far as the crop limit allows.
  const maxStretch = 1 / (1 - MAX_CROP)
  let sx = W / chosen.w, sy = H / chosen.h
  if (sx / sy > maxStretch) sx = sy * maxStretch
  if (sy / sx > maxStretch) sy = sx * maxStretch
  const offX = margin + (W - chosen.w * sx) / 2, offY = margin + (H - chosen.h * sy) / 2

  return chosen.cells.map(c => {
    const dx = offX + c.x * sx + gap / 2, dy = offY + c.y * sy + gap / 2
    const dw = c.w * sx - gap, dh = c.h * sy - gap
    // Cover: crop the picture to the cell's shape.
    const cellAspect = dw / dh, a = items[c.index].aspect
    let sw = 1, sh = 1, ox = 0, oy = 0
    if (a > cellAspect) { sw = cellAspect / a; ox = (1 - sw) / 2 }
    else if (a < cellAspect) { sh = a / cellAspect; oy = items[c.index].keepTop ? 0 : (1 - sh) / 2 }
    return { index: c.index, dx, dy, dw, dh, sx: ox, sy: oy, sw, sh }
  })
}
