import {
  buildDissolveTimeRemap, DEFAULT_LAYER_FADE, findDissolveBoundaries,
  type ColorCorrection, type FlatSegment, type OverlayLayer,
} from './timeline'
import { ffmpegFilmLookChain, type ClipFilmLook } from '../../shared/film-looks'
import { keyframeExpr } from './keyframe-expr'

export interface ExportSubtitle {
  text: string; startTime: number; endTime: number;
  style: { fontSize: number; fontFamily: string; fontWeight: string; color: string; backgroundColor: string; position: string; italic: boolean };
}

export interface ExportTextOverlay {
  text: string; startTime: number; endTime: number;
  fadeIn?: number; fadeOut?: number;
  opacityKeyframes?: { t: number; value: number }[];
  style: {
    fontSize: number; color: string; backgroundColor: string;
    positionX: number; positionY: number;
    strokeColor: string; strokeWidth: number;
    shadowColor: string; shadowOffsetX: number; shadowOffsetY: number;
    opacity: number; padding: number;
    textAlign?: string;
    fontFamily?: string; fontWeight?: string;
    scaleX?: number; scaleY?: number;
  };
}

/** Build a drawtext `fontfile=` argument for a system font path. The path is
 *  single-quoted and its drive-letter colon escaped — the only form that parses
 *  inside a filter_complex_script on Windows (bare or backslash-only both fail
 *  with "No option name near ...", verified against the bundled ffmpeg). */
function fontFileArg(p: string): string {
  return `fontfile='${p.replace(/\\/g, '/').replace(/:/g, '\\:')}'`
}

/** Escape a string for use inside an ffmpeg drawtext text='...' value. */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\\\\\')
    .replace(/'/g, "'\\\\\\''")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%')
  // Newlines stay RAW: inside the quoted value a literal newline survives the
  // filtergraph parser and drawtext breaks the line there. An escaped `\n` is
  // un-escaped to a plain "n" ("TRICK ORnTREAT").
}

/** drawtext text_align letter for a CSS text-align (multi-line blocks). */
function drawtextAlign(align: string | undefined): 'L' | 'C' | 'R' {
  return align === 'left' ? 'L' : align === 'right' ? 'R' : 'C'
}

/** Convert a CSS color (hex / rgb(a) / named / transparent) to an ffmpeg color
 *  token like `0xRRGGBB@0.500`. `extraAlpha` multiplies the resolved alpha (used
 *  for the overlay's global opacity). Returns null for transparent/none. */
function cssColorToFfmpeg(css: string, extraAlpha = 1): string | null {
  const c = (css || '').trim().toLowerCase()
  if (!c || c === 'transparent' || c === 'none') return null
  let r = 0, g = 0, b = 0, a = 1
  let m: RegExpMatchArray | null
  if ((m = c.match(/^#([0-9a-f]{3})$/))) {
    r = parseInt(m[1][0] + m[1][0], 16); g = parseInt(m[1][1] + m[1][1], 16); b = parseInt(m[1][2] + m[1][2], 16)
  } else if ((m = c.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/))) {
    r = parseInt(m[1].slice(0, 2), 16); g = parseInt(m[1].slice(2, 4), 16); b = parseInt(m[1].slice(4, 6), 16)
    if (m[2]) a = parseInt(m[2], 16) / 255
  } else if ((m = c.match(/^rgba?\(([^)]+)\)$/))) {
    const p = m[1].split(',').map(s => s.trim())
    r = parseInt(p[0], 10) || 0; g = parseInt(p[1], 10) || 0; b = parseInt(p[2], 10) || 0
    if (p[3] !== undefined) a = parseFloat(p[3])
  } else {
    // A named color (white, black, red, ...) — ffmpeg understands these directly.
    const alpha = Math.max(0, Math.min(1, extraAlpha))
    return alpha >= 0.999 ? c : `${c}@${alpha.toFixed(3)}`
  }
  const hex = (((r & 255) << 16) | ((g & 255) << 8) | (b & 255)).toString(16).padStart(6, '0')
  const alpha = Math.max(0, Math.min(1, (isFinite(a) ? a : 1) * extraAlpha))
  return `0x${hex}@${alpha.toFixed(3)}`
}

/**
 * Color correction + fade-to-black/white + wipe filters for one segment, as
 * an ffmpeg filter-chain suffix (leading comma, or '' if nothing applies).
 *
 * The eight color sliders don't map 1:1 onto ffmpeg's eq filter (which only
 * exposes one brightness/contrast/saturation knob each), so brightness,
 * exposure, and highlights combine into eq's additive brightness, and
 * contrast and shadows combine into its multiplicative contrast - matching
 * how the editor's own CSS preview groups them conceptually. This is a
 * close creative match to the live preview, not colorimetric precision -
 * consistent with the preview's own hue-rotate/sepia approximations.
 */
/** The look + color-correction filters alone, comma-joined, or '' — shared by
 *  segments and by the overlay layers, which have no transitions to fade.
 *
 *  The film look runs FIRST, so the manual sliders trim a graded image rather
 *  than being swallowed by it. The preview applies them in the same order (the
 *  SVG look filter ahead of the CSS adjustments in getClipEffectStyles). */
function buildColorGradeFilters(cc: ColorCorrection | undefined, filmLook?: ClipFilmLook): string {
  const parts: string[] = []
  const look = ffmpegFilmLookChain(filmLook)
  if (look) parts.push(look)
  if (cc) {
    const brightness = cc.brightness / 100 + cc.exposure / 200 + cc.highlights / 300
    const contrast = 1 + cc.contrast / 100 + cc.shadows / 300
    const saturation = Math.max(0, Math.min(3, 1 + cc.saturation / 100))
    if (brightness !== 0 || contrast !== 1 || saturation !== 1) {
      parts.push(`eq=brightness=${brightness.toFixed(4)}:contrast=${contrast.toFixed(4)}:saturation=${saturation.toFixed(4)}`)
    }
    if (cc.tint !== 0) {
      parts.push(`hue=h=${(cc.tint * 1.2).toFixed(2)}`)
    }
    if (cc.temperature !== 0) {
      const kelvin = Math.max(1000, Math.min(40000, Math.round(6500 - cc.temperature * 35)))
      parts.push(`colortemperature=temperature=${kelvin}`)
    }
  }
  return parts.join(',')
}

function buildGradingFilters(seg: FlatSegment, localDuration: number): string {
  const parts: string[] = []
  const grade = buildColorGradeFilters(seg.colorCorrection, seg.filmLook)
  if (grade) parts.push(grade)

  // Fades are defined relative to the ORIGINAL clip's start/end, so only
  // apply them to the fragment that actually touches that edge - a clip
  // split by a higher-track overlay would otherwise fade every fragment.
  const tIn = seg.transitionIn
  if (tIn && (tIn.type === 'fade-to-black' || tIn.type === 'fade-to-white') && tIn.duration > 0 && seg.offsetInClip < 0.01) {
    const d = Math.min(tIn.duration, localDuration)
    parts.push(`fade=t=in:st=0:d=${d.toFixed(4)}:color=${tIn.type === 'fade-to-black' ? 'black' : 'white'}`)
  }
  const tOut = seg.transitionOut
  if (tOut && (tOut.type === 'fade-to-black' || tOut.type === 'fade-to-white') && tOut.duration > 0) {
    const reachesClipEnd = Math.abs((seg.offsetInClip + localDuration) - seg.clipDuration) < 0.01
    if (reachesClipEnd) {
      const d = Math.min(tOut.duration, localDuration)
      const st = Math.max(0, localDuration - d)
      parts.push(`fade=t=out:st=${st.toFixed(4)}:d=${d.toFixed(4)}:color=${tOut.type === 'fade-to-black' ? 'black' : 'white'}`)
    }
  }

  return parts.length > 0 ? ',' + parts.join(',') : ''
}

/**
 * getWipeClipPath's direction names describe which way the wipe motion
 * travels, matching ffmpeg's own xfade transition naming directly - this
 * mapping is intentionally the identity (minus the hyphen), verified
 * empirically by rendering each ffmpeg transition and comparing
 * pixel-for-pixel against getWipeClipPath's output. Same mapping for both
 * transitionIn and transitionOut. Kept as an explicit table rather than
 * derived from the string (e.g. stripping the hyphen) so it stays correct
 * and obvious if either naming scheme ever changes independently.
 *
 * Known limitation: ffmpeg's xfade completes its transition roughly one
 * frame earlier than the nominal duration (verified with frame-by-frame
 * contact sheets at 4fps and 24fps) - a fixed ~1-frame offset regardless of
 * duration, not a scaling error. At typical transition lengths this is a
 * fraction of a frame's worth of time (<50ms at 24fps) and isn't
 * perceptible; not worth working around given it's inherent to xfade itself
 * rather than this code's own math.
 */
const WIPE_TYPE_TO_XFADE: Record<string, string> = {
  'wipe-left': 'wipeleft',
  'wipe-right': 'wiperight',
  'wipe-up': 'wipeup',
  'wipe-down': 'wipedown',
}

/**
 * Wipes are true two-layer composites (revealing/hiding against black), not
 * a single-input filter like fade - ffmpeg has no per-pixel time-animated
 * crop/drawbox (their w/h/x/y expressions are evaluated once at filter
 * init, not per-frame), so this reuses ffmpeg's own tested xfade transition
 * types against a synthetic black source instead of hand-rolling pixel math.
 *
 * Returns the new input args/filter lines to append and the label the wipe
 * result ends up on, or null if no wipe applies to this segment.
 */
function applyWipeTransitions(
  contentLabel: string,
  seg: FlatSegment,
  localDuration: number,
  opts: { width: number; height: number; fps: number },
  nextIdx: number,
): { inputs: string[]; filterLines: string[]; label: string; nextIdx: number } | null {
  const { width, height, fps } = opts
  const inputs: string[] = []
  const filterLines: string[] = []
  let label = contentLabel
  let idx = nextIdx
  let applied = false

  const addBlackInput = (): number => {
    inputs.push('-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${localDuration.toFixed(6)}`)
    return idx++
  }

  const tIn = seg.transitionIn
  if (tIn && tIn.type.startsWith('wipe-') && tIn.duration > 0 && seg.offsetInClip < 0.01) {
    const xfadeType = WIPE_TYPE_TO_XFADE[tIn.type]
    if (xfadeType) {
      const d = Math.min(tIn.duration, localDuration)
      const blackIdx = addBlackInput()
      const nextLabel = `${contentLabel}wi`
      // fps-align both sides: the content chain intentionally skips
      // per-segment fps conversion (applied once after concat), but xfade
      // blends frame-for-frame and needs matched timing to do that correctly.
      filterLines.push(
        `[${blackIdx}:v]fps=${fps},setsar=1[${nextLabel}blk];` +
        `[${label}]fps=${fps}[${nextLabel}clip];` +
        `[${nextLabel}blk][${nextLabel}clip]xfade=transition=${xfadeType}:duration=${d.toFixed(4)}:offset=0[${nextLabel}]`,
      )
      label = nextLabel
      applied = true
    }
  }

  const tOut = seg.transitionOut
  if (tOut && tOut.type.startsWith('wipe-') && tOut.duration > 0) {
    const reachesClipEnd = Math.abs((seg.offsetInClip + localDuration) - seg.clipDuration) < 0.01
    if (reachesClipEnd) {
      const xfadeType = WIPE_TYPE_TO_XFADE[tOut.type]
      if (xfadeType) {
        const d = Math.min(tOut.duration, localDuration)
        const st = Math.max(0, localDuration - d)
        const blackIdx = addBlackInput()
        const nextLabel = `${contentLabel}wo`
        filterLines.push(
          `[${label}]fps=${fps}[${nextLabel}clip];` +
          `[${blackIdx}:v]fps=${fps},setsar=1[${nextLabel}blk];` +
          `[${nextLabel}clip][${nextLabel}blk]xfade=transition=${xfadeType}:duration=${d.toFixed(4)}:offset=${st.toFixed(4)}[${nextLabel}]`,
        )
        label = nextLabel
        applied = true
      }
    }
  }

  return applied ? { inputs, filterLines, label, nextIdx: idx } : null
}

/** Piecewise-linear value of {t, value} keys at time t (holds the end values). */
function linearKeyValue(keys: { t: number; value: number }[], t: number): number {
  const sorted = [...keys].sort((a, b) => a.t - b.t)
  if (t <= sorted[0].t) return sorted[0].value
  const last = sorted[sorted.length - 1]
  if (t >= last.t) return last.value
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (t < b.t) return a.value + (b.value - a.value) * ((t - a.t) / Math.max(1e-6, b.t - a.t))
  }
  return last.value
}

/**
 * Piecewise-linear ffmpeg expression over program time `t` for keys timed from
 * `offset` seconds (holds the end values). Commas escaped for a drawtext value.
 */
function linearKeyExpr(keys: { t: number; value: number }[], offset: number): string {
  const n = (x: number) => x.toFixed(4)
  const sorted = [...keys].sort((a, b) => a.t - b.t)
  const T = `(t-${n(offset)})`
  let expr = n(sorted[sorted.length - 1].value)
  for (let i = sorted.length - 2; i >= 0; i--) {
    const a = sorted[i]
    const b = sorted[i + 1]
    if (b.t - a.t <= 0) continue
    expr = `if(lt(${T}\\,${n(b.t)})\\,${n(a.value)}+(${n(b.value - a.value)})*(${T}-${n(a.t)})/${n(b.t - a.t)}\\,${expr})`
  }
  return `if(lt(${T}\\,${n(sorted[0].t)})\\,${n(sorted[0].value)}\\,${expr})`
}

/**
 * Vertical (9:16) export: crop the segment to its reframe window BEFORE scaling.
 * The window is the largest 9:16 box that fits the source; `pos` slides it along
 * whichever axis has slack (the other axis's slack is 0, so one pos drives both).
 * Keys are timed in source seconds (video) / clip seconds (image); `timeOffset`
 * maps the chain's local `t` onto that clock. Reversed clips use the static pos.
 */
function buildReframeCrop(seg: FlatSegment, timeOffset: number): string {
  const rf = seg.reframe
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
  let posExpr: string
  if (rf?.keys && rf.keys.length > 1 && !seg.reversed) {
    posExpr = keyframeExpr(rf.keys.map(k => ({ t: k.t, v: clamp01(k.pos) })), `(t+${timeOffset.toFixed(6)})`)
  } else {
    const p = rf?.keys?.length ? rf.keys[0].pos : rf?.pos ?? 0.5
    posExpr = clamp01(p).toFixed(4)
  }
  return `crop=w='min(iw,ih*9/16)':h='min(ih,iw*16/9)':x='(iw-ow)*(${posExpr})':y='(ih-oh)*(${posExpr})'`
}

/**
 * Where a shot's 9:16 window sits in the 16:9 preview frame, as fractions of the
 * frame (mirrors VerticalReframeOverlay: media object-contained in the frame,
 * window = the largest 9:16 box in the media, slid by `pos`). `posExpr` is an
 * ffmpeg expression over PROGRAM time `t`.
 */
function verticalWindow(seg: FlatSegment): {
  winW: number; winH: number; winXExpr: string; winYExpr: string
} {
  const FR = 16 / 9
  const R = seg.srcWidth && seg.srcHeight ? seg.srcWidth / seg.srcHeight : FR
  const mw = R > FR ? 1 : R / FR
  const mh = R > FR ? FR / R : 1
  const offX = (1 - mw) / 2
  const offY = (1 - mh) / 2
  const horizontal = R >= 9 / 16
  const winW = horizontal ? mh * (9 / 16) / FR : mw
  const winH = horizontal ? mh : mw * FR * FR
  const slack = Math.max(0, horizontal ? mw - winW : mh - winH)
  // Same position curve as buildReframeCrop, re-timed from segment to program time.
  const rf = seg.reframe
  const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
  let posExpr: string
  if (seg.type !== 'gap' && rf?.keys && rf.keys.length > 1 && !seg.reversed) {
    const local = `(t-${seg.startTime.toFixed(6)})`
    const clock = seg.type === 'video'
      ? `(${local}*${(seg.speed || 1).toFixed(6)}+${seg.trimStart.toFixed(6)})`
      : `(${local}+${seg.offsetInClip.toFixed(6)})`
    posExpr = keyframeExpr(rf.keys.map(k => ({ t: k.t, v: clamp01(k.pos) })), clock)
  } else {
    posExpr = clamp01(rf?.keys?.length ? rf.keys[0].pos : rf?.pos ?? 0.5).toFixed(4)
  }
  const n = (v: number) => v.toFixed(6)
  return {
    winW,
    winH,
    winXExpr: horizontal ? `(${n(offX)}+(${posExpr})*${n(slack)})` : n(offX),
    winYExpr: horizontal ? n(offY) : `(${n(offY)}+(${posExpr})*${n(slack)})`,
  }
}

/**
 * 9:16 title placement: the title keeps its spot on the 16:9 frame (what the
 * preview shows under the 9:16 guide), so in the output its center is where that
 * spot lands inside each shot's window — a program-time expression that switches
 * window per shot and follows keyframed pans. Size scales with the window.
 */
function verticalTextMap(
  segments: FlatSegment[],
  start: number,
  end: number,
  outW: number,
  outH: number,
  toProgramTime: (t: number) => number,
) {
  const overlapping = segments.filter(s => s.startTime < end - 1e-4 && s.startTime + s.duration > start + 1e-4)
  const wins = (overlapping.length ? overlapping : segments.slice(0, 1)).map(s => ({ s, w: verticalWindow(s) }))
  // Title size is fixed per drawtext: take the window it opens in.
  const scale = outH / (1080 * wins[0].w.winH)
  const piecewise = (pick: (w: ReturnType<typeof verticalWindow>) => string) => {
    let expr = pick(wins[wins.length - 1].w)
    for (let i = wins.length - 2; i >= 0; i--) {
      // Which window applies is decided on the program clock, but segment start
      // times are nominal — convert, or the switch happens at the wrong moment.
      const boundary = toProgramTime(wins[i + 1].s.startTime)
      expr = `if(lt(t,${boundary.toFixed(6)}),${pick(wins[i].w)},${expr})`
    }
    return expr
  }
  return {
    scale,
    /** The virtual 16:9 frame the 9:16 window crops from, in output pixels — what a
     *  layer is sized against so the window mapping lands it correctly. Fixed to the
     *  opening window, like `scale`. */
    frameW: outW / wins[0].w.winW,
    frameH: outH / wins[0].w.winH,
    /** Output-pixel center X/Y for a title at frame fraction (px, py). Unescaped commas. */
    centerX: (px: number) => piecewise(w => `(${outW}*((${px.toFixed(6)}-${w.winXExpr})/${w.winW.toFixed(6)}))`),
    centerY: (py: number) => piecewise(w => `(${outH}*((${py.toFixed(6)}-${w.winYExpr})/${w.winH.toFixed(6)}))`),
    /** Same, for a frame fraction that is itself an expression (a keyframed layer). */
    centerXExpr: (px: string) => piecewise(w => `(${outW}*(((${px})-${w.winXExpr})/${w.winW.toFixed(6)}))`),
    centerYExpr: (py: string) => piecewise(w => `(${outH}*(((${py})-${w.winYExpr})/${w.winH.toFixed(6)}))`),
  }
}

/** Commas inside a filter option value have to be escaped even when quoted. */
const escCommas = (expr: string): string => expr.replace(/,/g, '\\,')

/**
 * Composite the layer clips (logos, graphics, PiP) over the flattened program.
 *
 * Each becomes its own input, sized to what it fills the frame at — the same
 * letterboxed fit the preview's object-contain element paints — then scaled, faded
 * and positioned. All three animations are ffmpeg expressions over program time:
 * `scale` with eval=frame for the size, overlay's own per-frame x/y for the
 * position, and one alpha value per frame pushed into colorchannelmixer by sendcmd
 * for the fade — the same technique the stretched-title path below uses.
 *
 * The transform eases with smoothstep (keyframeExpr) to match clipLayerAt() in the
 * renderer; opacity is linear, matching the preview there too.
 */
function buildOverlayLayers(
  layers: OverlayLayer[],
  baseLabel: string,
  startIdx: number,
  o: {
    width: number; height: number; fps: number;
    segments: FlatSegment[]; vertical?: boolean;
    toProgramTime: (t: number) => number;
  },
): { inputs: string[]; filterLines: string[]; label: string; nextIdx: number } {
  const inputs: string[] = []
  const filterLines: string[] = []
  let label = baseLabel
  let idx = startIdx

  for (let li = 0; li < layers.length; li++) {
    const ly = layers[li]
    const dur = ly.duration
    if (dur <= 0.001) continue
    const speed = ly.speed || 1
    const keys = ly.layer.keys && ly.layer.keys.length > 0
      ? [...ly.layer.keys].sort((a, b) => a.t - b.t)
      : null
    // Where this lands on the program clock (see toProgramTime in the caller).
    const startAt = o.toProgramTime(ly.startTime)
    // Clip-local clock, so the keys read the same as they do in the editor.
    const local = `(t-${startAt.toFixed(6)})`
    type LayerField = 'x' | 'y' | 'scaleX' | 'scaleY'
    const expr = (field: LayerField): string => keys && keys.length > 1
      ? keyframeExpr(keys.map(k => ({ t: k.t, v: k[field] })), local)
      : (keys ? keys[0][field] : ly.layer[field]).toFixed(6)

    // The frame the layer sits on. A vertical export only shows the 9:16 window of
    // that frame, so fit into the larger virtual frame the window crops from — the
    // window mapping below then lands it at the right place and size, exactly as a
    // title is handled.
    const vmap = o.vertical
      // Selected against nominal times, because that is the clock the segments'
      // own start times are on.
      ? verticalTextMap(o.segments, ly.startTime, ly.startTime + dur, o.width, o.height, o.toProgramTime)
      : null
    const fitW = vmap ? Math.max(2, Math.round(vmap.frameW)) : o.width
    const fitH = vmap ? Math.max(2, Math.round(vmap.frameH)) : o.height

    const source = `l${li}s`
    const faded = `l${li}f`
    const mixer = `lyo${li}`

    if (ly.type === 'image') {
      inputs.push('-loop', '1', '-framerate', String(o.fps), '-t', dur.toFixed(6), '-i', ly.filePath)
    } else {
      inputs.push('-i', ly.filePath)
    }

    let chain = `[${idx}:v]`
    if (ly.type !== 'image') {
      const trimEnd = ly.trimStart + dur * speed
      chain += `trim=start=${ly.trimStart.toFixed(6)}:end=${trimEnd.toFixed(6)},setpts=PTS-STARTPTS,`
      if (speed !== 1) chain += `setpts=PTS/${speed.toFixed(6)},`
    }
    chain += `fps=${o.fps},`
    // Onto the program clock, so every expression below reads plain `t`.
    chain += `setpts=PTS+${startAt.toFixed(6)}/TB,`
    chain += `scale=${fitW}:${fitH}:force_original_aspect_ratio=decrease,setsar=1,`
    if (ly.flipH) chain += 'hflip,'
    if (ly.flipV) chain += 'vflip,'
    const grade = buildColorGradeFilters(ly.colorCorrection, ly.filmLook)
    if (grade) chain += `${grade},`
    // rgba so a logo's own transparency survives, and so the alpha gain below has
    // something to multiply.
    chain += 'format=rgba,'
    // Animated size. eval=frame re-reads the expressions every frame; sizes are
    // forced even and at least 2px, because odd or zero dimensions trip scalers.
    chain += `scale=w='trunc(max(2\\,iw*(${escCommas(expr('scaleX'))}))/2)*2'`
    chain += `:h='trunc(max(2\\,ih*(${escCommas(expr('scaleY'))}))/2)*2':eval=frame`
    filterLines.push(`${chain}[${source}]`)
    idx++

    // Alpha: the fade ramp at each end times whatever opacity is otherwise in
    // force, keyframed or flat — exactly how getClipEffectStyles composes them for
    // the preview. Fades are capped at half the clip so a short graphic still
    // reaches full opacity.
    const okeys = ly.opacityKeyframes && ly.opacityKeyframes.length > 0 ? ly.opacityKeyframes : null
    const half = dur / 2
    const fadeIn = Math.min(ly.fadeIn ?? DEFAULT_LAYER_FADE, half)
    const fadeOut = Math.min(ly.fadeOut ?? DEFAULT_LAYER_FADE, half)
    const opacityAt = (programT: number): number => {
      const l = programT - startAt
      let g = 1
      if (fadeIn > 0 && l < fadeIn) g = Math.max(0, Math.min(1, l / fadeIn))
      if (fadeOut > 0 && l > dur - fadeOut) g = Math.min(g, Math.max(0, Math.min(1, (dur - l) / fadeOut)))
      const base = okeys ? linearKeyValue(okeys, l) : ly.opacity
      return Math.max(0, Math.min(1, g * base / 100))
    }
    const first = opacityAt(startAt)
    // A fade or a keyframe means the value moves, so it needs one command per
    // frame it changes on; anything else is flat and is one filter or none.
    if (okeys || fadeIn > 0 || fadeOut > 0) {
      const cmds: string[] = []
      let last = -1
      const frames = Math.ceil(dur * o.fps) + 1
      for (let f = 0; f < frames; f++) {
        const t = startAt + f / o.fps
        const v = opacityAt(t)
        if (Math.abs(v - last) > 0.002) {
          cmds.push(`${t.toFixed(4)} colorchannelmixer@${mixer} aa ${v.toFixed(4)}`)
          last = v
        }
      }
      filterLines.push(cmds.length > 1
        ? `[${source}]sendcmd=c='${cmds.join(';')}',colorchannelmixer@${mixer}=aa=${first.toFixed(4)}[${faded}]`
        : `[${source}]colorchannelmixer=aa=${first.toFixed(4)}[${faded}]`)
    } else if (first < 0.999) {
      filterLines.push(`[${source}]colorchannelmixer=aa=${first.toFixed(4)}[${faded}]`)
    } else {
      filterLines.push(`[${source}]null[${faded}]`)
    }

    // Position: the layer's CENTER goes to (x, y) as a fraction of the frame, so
    // the overlay's top-left is that minus half its own (animated) size.
    const xExpr = vmap
      ? `${vmap.centerXExpr(expr('x'))}-w/2`
      : `W*(${expr('x')})-w/2`
    const yExpr = vmap
      ? `${vmap.centerYExpr(expr('y'))}-h/2`
      : `H*(${expr('y')})-h/2`
    const nextLabel = `lyout${li}`
    filterLines.push(
      `[${label}][${faded}]overlay=x='${escCommas(xExpr)}':y='${escCommas(yExpr)}'` +
      `:eof_action=pass:format=auto[${nextLabel}]`,
    )
    label = nextLabel
  }

  return { inputs, filterLines, label, nextIdx: idx }
}
/**
 * Build the ffmpeg filter_complex script and input arguments for the video-only pass.
 * Pure string building — zero I/O.
 */
export function buildVideoFilterGraph(
  segments: FlatSegment[],
  opts: {
    width: number; height: number; fps: number;
    letterbox?: { ratio: number; color: string; opacity: number };
    subtitles?: ExportSubtitle[];
    textOverlays?: ExportTextOverlay[];
    fontFile?: string;
    /** Per-overlay font file for a family + boldness; falls back to `fontFile`. */
    resolveFontFile?: (fontFamily: string | undefined, bold: boolean) => string | undefined;
    vertical?: boolean;
    /** Graphics composited over the program — see buildOverlayLayers. */
    layers?: OverlayLayer[];
    /**
     * A single ffmpeg pass can't take a very long timeline (one input per segment overflows
     * the command line), so a big export renders in two kinds of pass over the same program:
     *  - 'segments': only the per-segment content, concatenated — no letterbox/layers/text;
     *  - 'overlay': one pre-rendered `baseInput` (the program so far) plus the letterbox,
     *    layers, titles and subtitles. `segments` is still the whole program here: titles
     *    and layers are placed by program time against it.
     * Default 'all' is the whole graph in one pass.
     */
    stage?: 'all' | 'segments' | 'overlay';
    baseInput?: string;
    /**
     * 'segments' stage only: render exactly this many frames. The `fps` filter drops the last
     * frame of whatever it renders, harmless once but it adds up across many pieces, so a
     * piece is padded and trimmed to a count the caller works out from the whole program.
     */
    frameCount?: number;
  },
): { inputs: string[]; filterScript: string } {
  const { width, height, fps, letterbox, subtitles, textOverlays, fontFile, resolveFontFile, vertical, layers } = opts
  const stage = opts.stage ?? 'all'
  // Text sizes are authored against a 1080-line 16:9 frame. A 16:9 export scales
  // by its height. A 9:16 export instead maps each title through the shot's 9:16
  // window (see verticalTextMap) — the picture is blown up to fill it, so the
  // title must scale with it or it renders ~1.8× too small.
  const textScale = height / 1080
  // Nominal timeline time -> real program time. A dissolve overlaps the tail of one
  // clip with the head of the next, so everything after it sits earlier in the
  // encoded program than its timeline position says. Segments carry nominal times
  // while every `t` in the graph below is program time, so anything placed BY time
  // has to be converted: titles, subtitles and layers all did drift otherwise. Start
  // times shift and durations are kept, which is how the audio pass handles it too.
  const toProgramTime = buildDissolveTimeRemap(segments)
  const inputs: string[] = []
  const filterParts: string[] = []
  let idx = 0
  let lastLabel = 'fpsout'

  if (stage === 'overlay') {
    inputs.push('-i', opts.baseInput!)
    filterParts.push(`[0:v]null[${lastLabel}]`)
    idx = 1
  } else {
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]

      const contentLabel = `v${i}c`

      if (seg.type === 'gap') {
        // Gap: generate black frames at target fps (synthetic input)
        inputs.push('-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=${fps}:d=${seg.duration.toFixed(6)}`)
        filterParts.push(`[${idx}:v]setsar=1[${contentLabel}]`)
        idx++
      } else if (seg.type === 'image') {
        // Image: loop for exact duration, use target fps for frame generation
        inputs.push('-loop', '1', '-framerate', String(fps), '-t', seg.duration.toFixed(6), '-i', seg.filePath)
        let chain = `[${idx}:v]${vertical ? `${buildReframeCrop(seg, seg.offsetInClip)},` : ''}scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:-1:-1:color=black,setsar=1`
        if (seg.flipH) chain += ',hflip'
        if (seg.flipV) chain += ',vflip'
        chain += buildGradingFilters(seg, seg.duration)
        chain += `[${contentLabel}]`
        filterParts.push(chain)
        idx++
      } else {
        // Video: trim -> speed -> scale, NO per-segment fps conversion
        // (fps is applied ONCE after concat to avoid per-segment duration quantization)
        const trimEnd = seg.trimStart + seg.duration * seg.speed
        inputs.push('-i', seg.filePath)
        let chain = `[${idx}:v]trim=start=${seg.trimStart.toFixed(6)}:end=${trimEnd.toFixed(6)},setpts=PTS-STARTPTS`
        // Crop before the speed change so `t` is still source time minus trimStart.
        if (vertical) chain += `,${buildReframeCrop(seg, seg.trimStart)}`
        if (seg.speed !== 1) chain += `,setpts=PTS/${seg.speed.toFixed(6)}`
        if (seg.reversed) chain += ',reverse'
        chain += `,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:-1:-1:color=black,setsar=1`
        if (seg.flipH) chain += ',hflip'
        if (seg.flipV) chain += ',vflip'
        chain += buildGradingFilters(seg, seg.duration)
        chain += `[${contentLabel}]`
        filterParts.push(chain)
        idx++
      }

      const wipe = applyWipeTransitions(contentLabel, seg, seg.duration, { width, height, fps }, idx)
      if (wipe) {
        inputs.push(...wipe.inputs)
        filterParts.push(...wipe.filterLines)
        idx = wipe.nextIdx
        filterParts.push(`[${wipe.label}]null[v${i}]`)
      } else {
        filterParts.push(`[${contentLabel}]null[v${i}]`)
      }
    }

    const dissolveBoundaries = findDissolveBoundaries(segments)

    if (dissolveBoundaries.length === 0) {
      // No dissolves: concat all segments in one pass, then apply fps ONCE to
      // the entire output. This is how real NLEs work - frame rate conversion
      // happens globally, not per-clip, so per-segment duration quantization
      // doesn't accumulate.
      const concatInputs = segments.map((_, i) => `[v${i}]`).join('')
      lastLabel = 'fpsout'
      filterParts.push(`${concatInputs}concat=n=${segments.length}:v=1:a=0[concatraw]`)
      filterParts.push(opts.frameCount
        ? `[concatraw]tpad=stop_mode=clone:stop=2,fps=${fps}[${lastLabel}]`
        : `[concatraw]fps=${fps}[${lastLabel}]`)
    } else {
      // At least one dissolve: xfade blends two streams frame-for-frame, which
      // needs matched timing, so every segment gets fps-normalized up front
      // instead of once at the end. Segments combine left-to-right through an
      // accumulator, using xfade at dissolve boundaries (which - like the
      // editor's own preview - overlaps the tail of one clip with the head of
      // the next, shrinking total duration by the dissolve's length) and plain
      // concat everywhere else.
      //
      // xfade's "dissolve" transition is a misnomer for what this app (and
      // every mainstream NLE) means by dissolve: it's a randomized pixel
      // dither, not a smooth cross-fade - confirmed by blending solid red and
      // blue test frames at 50%: "dissolve" produced visibly speckled
      // red/blue pixels, not a uniform blend. xfade's "fade" is the one that
      // actually does a plain linear alpha blend (verified: uniform purple at
      // 50%), matching the editor's own opacity-based preview.
      const XFADE_DISSOLVE_TYPE = 'fade'
      const dissolveDurationAfter = new Map(dissolveBoundaries.map(b => [b.index, b.duration]))

      filterParts.push(`[v0]fps=${fps}[vacc0]`)
      let accLabel = 'vacc0'
      let accDuration = segments[0].duration

      for (let i = 1; i < segments.length; i++) {
        const segFpsLabel = `v${i}fps`
        filterParts.push(`[v${i}]fps=${fps}[${segFpsLabel}]`)

        const nextAccLabel = `vacc${i}`
        const dissolveDuration = dissolveDurationAfter.get(i - 1)
        if (dissolveDuration !== undefined) {
          const offset = Math.max(0, accDuration - dissolveDuration)
          filterParts.push(
            `[${accLabel}][${segFpsLabel}]xfade=transition=${XFADE_DISSOLVE_TYPE}:duration=${dissolveDuration.toFixed(4)}:offset=${offset.toFixed(4)}[${nextAccLabel}]`,
          )
          accDuration = accDuration + segments[i].duration - dissolveDuration
        } else {
          filterParts.push(`[${accLabel}][${segFpsLabel}]concat=n=2:v=1:a=0[${nextAccLabel}]`)
          accDuration = accDuration + segments[i].duration
        }
        accLabel = nextAccLabel
      }

      lastLabel = 'fpsout'
      filterParts.push(`[${accLabel}]null[${lastLabel}]`)
    }
    }

  if (stage === 'segments' && opts.frameCount) {
    // Pad with clones of the true last frame (each per-segment fps in the dissolve path can
    // also lose one), then cut to the exact count.
    const pad = segments.length + 2
    filterParts.push(`[${lastLabel}]tpad=stop_mode=clone:stop=${pad},trim=end_frame=${opts.frameCount},setpts=PTS-STARTPTS[fixedfps]`)
    lastLabel = 'fixedfps'
  }

  if (stage !== 'segments') {
    // Letterbox overlay (drawbox)
    if (letterbox) {
      const containerRatio = width / height
      const targetRatio = letterbox.ratio
      const hexColor = letterbox.color.replace('#', '')
      const alphaHex = Math.round(letterbox.opacity * 255).toString(16).padStart(2, '0')
      const colorStr = `0x${hexColor}${alphaHex}`
      const nextLabel = 'lbout'

      if (targetRatio >= containerRatio) {
        // Letterbox: bars on top and bottom
        const visibleH = Math.round(width / targetRatio)
        const barH = Math.round((height - visibleH) / 2)
        if (barH > 0) {
          filterParts.push(`[${lastLabel}]drawbox=x=0:y=0:w=iw:h=${barH}:c=${colorStr}:t=fill,drawbox=x=0:y=ih-${barH}:w=iw:h=${barH}:c=${colorStr}:t=fill[${nextLabel}]`)
          lastLabel = nextLabel
        }
      } else {
        // Pillarbox: bars on left and right
        const visibleW = Math.round(height * targetRatio)
        const barW = Math.round((width - visibleW) / 2)
        if (barW > 0) {
          filterParts.push(`[${lastLabel}]drawbox=x=0:y=0:w=${barW}:h=ih:c=${colorStr}:t=fill,drawbox=x=iw-${barW}:y=0:w=${barW}:h=ih:c=${colorStr}:t=fill[${nextLabel}]`)
          lastLabel = nextLabel
        }
      }
    }

    // Layer clips (logos, graphics, PiP) composited over the flattened program.
    if (layers && layers.length > 0) {
      const built = buildOverlayLayers(layers, lastLabel, idx, {
        width, height, fps, segments, vertical, toProgramTime,
      })
      inputs.push(...built.inputs)
      filterParts.push(...built.filterLines)
      idx = built.nextIdx
      lastLabel = built.label
    }

    // Text-overlay burn-in (drawtext) — the type:'text' clips with a textStyle.
    // The live preview renders these as DOM; export mirrors position/size/color so
    // the baked video matches. Letter-spacing and shadow blur aren't representable
    // in drawtext and are dropped; explicit newlines are preserved (no auto-wrap —
    // the preview doesn't wrap either). Opacity keyframes ride drawtext's alpha;
    // a non-uniform stretch draws the text on a transparent full-frame layer, scales
    // that layer, and overlays it centered on the text's anchor point.
    if (textOverlays && textOverlays.length > 0) {
      for (let ti = 0; ti < textOverlays.length; ti++) {
        const ov = textOverlays[ti]
        const s = ov.style
        const nextLabel = `txt${ti}`
        // 9:16: place and size through the shot's window; else plain frame fractions.
        // Nominal in, because the windows are picked against the segments' own clock.
        const vmap = vertical
          ? verticalTextMap(segments, ov.startTime, ov.endTime, width, height, toProgramTime)
          : null
        const ovStart = toProgramTime(ov.startTime)
        const ovEnd = ovStart + Math.max(0.0001, ov.endTime - ov.startTime)
        const hf = vmap ? vmap.scale : textScale // style px (authored against 1080p) → export px
        const keyed = Boolean(ov.opacityKeyframes && ov.opacityKeyframes.length > 0)
        const sx = s.scaleX && s.scaleX > 0 ? s.scaleX : 1
        const sy = s.scaleY && s.scaleY > 0 ? s.scaleY : 1
        const stretched = Math.abs(sx - 1) > 1e-3 || Math.abs(sy - 1) > 1e-3
        // Static opacity is baked into the colors; keyed opacity moves to the alpha
        // expr, and a stretched title gets its opacity on the layer instead.
        const gA = keyed || stretched ? 1 : Math.max(0, Math.min(1, (s.opacity ?? 100) / 100))
        const fontSize = Math.max(1, Math.round(s.fontSize * hf))
        const fontColor = cssColorToFfmpeg(s.color, gA) ?? `white@${gA.toFixed(3)}`

        // Preview positions the box's CENTER at (positionX%, positionY%); mirror that.
        const px = Math.max(0, Math.min(1, (s.positionX ?? 50) / 100))
        const py = Math.max(0, Math.min(1, (s.positionY ?? 50) / 100))

        const parts: string[] = []
        const bold = s.fontWeight === 'bold' || Number(s.fontWeight) >= 600
        const overlayFont = resolveFontFile?.(s.fontFamily, bold) ?? fontFile
        if (overlayFont) parts.push(fontFileArg(overlayFont))
        parts.push(`text='${escapeDrawtext(ov.text)}'`)
        if (ov.text.includes('\n')) parts.push(`text_align=${drawtextAlign(s.textAlign)}`)
        parts.push(`fontsize=${fontSize}`)
        parts.push(`fontcolor=${fontColor}`)
        // Stretched: centered on its own layer (placed by the overlay below).
        // Vertical: a program-time expression (commas escaped for drawtext).
        const escC = (e: string) => e.replace(/,/g, '\\,')
        parts.push(stretched ? 'x=(w-text_w)/2'
          : vmap ? `x='${escC(vmap.centerX(px))}-text_w/2'` : `x=(w*${px.toFixed(4)})-(text_w/2)`)
        parts.push(stretched ? 'y=(h-text_h)/2'
          : vmap ? `y='${escC(vmap.centerY(py))}-text_h/2'` : `y=(h*${py.toFixed(4)})-(text_h/2)`)

        if ((s.strokeWidth ?? 0) > 0) {
          const strokeColor = cssColorToFfmpeg(s.strokeColor, gA)
          if (strokeColor) {
            parts.push(`borderw=${Math.max(1, Math.round(s.strokeWidth * hf))}`)
            parts.push(`bordercolor=${strokeColor}`)
          }
        }

        const shx = Math.round((s.shadowOffsetX ?? 0) * hf)
        const shy = Math.round((s.shadowOffsetY ?? 0) * hf)
        if (shx !== 0 || shy !== 0) {
          const shadowColor = cssColorToFfmpeg(s.shadowColor, gA)
          if (shadowColor) {
            parts.push(`shadowx=${shx}`)
            parts.push(`shadowy=${shy}`)
            parts.push(`shadowcolor=${shadowColor}`)
          }
        }

        const boxColor = cssColorToFfmpeg(s.backgroundColor, gA)
        if (boxColor) {
          parts.push('box=1')
          parts.push(`boxcolor=${boxColor}`)
          parts.push(`boxborderw=${Math.max(0, Math.round((s.padding ?? 0) * hf))}`)
        }

        // Opacity fade in/out via a time-based alpha expression (defaults 0.5s,
        // each capped at half the overlay). Multiplies the drawtext alpha, so it
        // rides on top of the style's own opacity. Commas escaped like `enable`.
        const ovDur = ovEnd - ovStart
        const fin = Math.min(ov.fadeIn ?? 0.5, ovDur / 2)
        const fout = Math.min(ov.fadeOut ?? 0.5, ovDur / 2)
        const ramps: string[] = []
        if (fin > 0.001) ramps.push(`(t-${ovStart.toFixed(3)})/${fin.toFixed(3)}`)
        if (fout > 0.001) ramps.push(`(${ovEnd.toFixed(3)}-t)/${fout.toFixed(3)}`)
        const alphaTerms: string[] = []
        if (ramps.length > 0) {
          const inner = ramps.length === 2 ? `min(${ramps[0]}\\,${ramps[1]})` : ramps[0]
          alphaTerms.push(`max(0\\,min(1\\,${inner}))`)
        }
        if (keyed) alphaTerms.push(`(${linearKeyExpr(ov.opacityKeyframes!, ovStart)})/100`)
        // Drawn straight onto the video, drawtext's alpha is right. On the stretch
        // layer it isn't (see below), so there the opacity is applied to the layer.
        if (alphaTerms.length > 0 && !stretched) {
          parts.push(`alpha='max(0\\,min(1\\,${alphaTerms.join('*')}))'`)
        }

        parts.push(`enable='between(t\\,${ovStart.toFixed(3)}\\,${ovEnd.toFixed(3)})'`)

        if (stretched) {
          // Transparent layer that only exists for the overlay's lifetime, shifted
          // onto the program clock so drawtext's t / enable see program time.
          //
          // drawtext on an RGBA canvas writes PREMULTIPLIED color, and with alpha < 1
          // it also squares the written alpha (measured: alpha 0.5 → stored 64/255),
          // so a faded title nearly vanished. So: draw at full opacity (clean
          // premultiplied coverage), unpremultiply to straight alpha, and apply the
          // fade/keyframed opacity to the whole layer — one value per frame, pushed
          // into colorchannelmixer's alpha gain by sendcmd.
          const layer = `txtl${ti}`
          // The text is drawn at its unstretched size, so a title squeezed to fit the
          // frame is wider (or taller) than the frame before the squeeze. Size the
          // canvas so it still comes out frame-sized after scaling, or drawtext crops
          // the ends of the text at the canvas edge.
          const canvasDim = (frame: number, stretch: number) => (
            Math.min(8192, Math.ceil(frame / Math.min(1, stretch) / 2) * 2)
          )
          const canvasW = canvasDim(width, sx)
          const canvasH = canvasDim(height, sy)
          const opacityAt = (t: number) => {
            const local = t - ovStart
            let g = 1
            if (fin > 0.001 && local < fin) g = Math.max(0, Math.min(1, local / fin))
            if (fout > 0.001 && local > ovDur - fout) g = Math.min(g, Math.max(0, (ovDur - local) / fout))
            const base = keyed ? linearKeyValue(ov.opacityKeyframes!, local) / 100 : Math.max(0, Math.min(1, (s.opacity ?? 100) / 100))
            return Math.max(0, Math.min(1, g * base))
          }
          const cmds: string[] = []
          let last = -1
          const frames = Math.ceil(ovDur * fps) + 1
          for (let f = 0; f < frames; f++) {
            const t = ovStart + f / fps
            const v = opacityAt(t)
            if (Math.abs(v - last) > 0.002) {
              cmds.push(`${t.toFixed(4)} colorchannelmixer@txo${ti} aa ${v.toFixed(4)}`)
              last = v
            }
          }
          const first = opacityAt(ovStart)
          const opacityStage = cmds.length > 1
            ? `sendcmd=c='${cmds.join(';')}',colorchannelmixer@txo${ti}=aa=${first.toFixed(4)},`
            : first < 0.999 ? `colorchannelmixer=aa=${first.toFixed(4)},` : ''
          filterParts.push(
            `color=c=black@0.0:s=${canvasW}x${canvasH}:r=${fps}:d=${ovDur.toFixed(6)},format=rgba,` +
            `setpts=PTS+${ovStart.toFixed(6)}/TB,` +
            `drawtext=${parts.join(':')},` +
            `unpremultiply=inplace=1,` +
            opacityStage +
            `scale=w='trunc(iw*${sx.toFixed(4)})':h='trunc(ih*${sy.toFixed(4)})'[${layer}]`,
          )
          filterParts.push(
            vmap
              ? `[${lastLabel}][${layer}]overlay=x='${escC(vmap.centerX(px))}-w/2':y='${escC(vmap.centerY(py))}-h/2':eof_action=pass:format=auto[${nextLabel}]`
              : `[${lastLabel}][${layer}]overlay=x='W*${px.toFixed(4)}-w/2':y='H*${py.toFixed(4)}-h/2':eof_action=pass:format=auto[${nextLabel}]`,
          )
        } else {
          filterParts.push(`[${lastLabel}]drawtext=${parts.join(':')}[${nextLabel}]`)
        }
        lastLabel = nextLabel
      }
    }

    // Subtitle burn-in (drawtext)
    if (subtitles && subtitles.length > 0) {
      for (let si = 0; si < subtitles.length; si++) {
        const sub = subtitles[si]
        const subStart = toProgramTime(sub.startTime)
        const subEnd = subStart + Math.max(0.0001, sub.endTime - sub.startTime)
        const nextLabel = `sub${si}`
        // Escape text for ffmpeg drawtext (newlines stay raw, see escapeDrawtext).
        const escapedText = escapeDrawtext(sub.text)
        const alignPart = sub.text.includes('\n') ? ':text_align=C' : ''

        const fontSize = Math.round(sub.style.fontSize * textScale) // scale relative to export res
        const fontColor = sub.style.color.replace('#', '0x')

        // Y position based on style.position
        let yExpr: string
        if (sub.style.position === 'top') {
          yExpr = '20'
        } else if (sub.style.position === 'center') {
          yExpr = '(h-text_h)/2'
        } else {
          yExpr = 'h-text_h-30'
        }

        // Background box
        let boxPart = ''
        if (sub.style.backgroundColor && sub.style.backgroundColor !== 'transparent') {
          const bgHex = sub.style.backgroundColor.replace('#', '')
          // Handle 8-char hex with alpha (e.g., 00000099)
          const bgColor = bgHex.length > 6 ? `0x${bgHex.slice(0, 6)}` : `0x${bgHex}`
          const bgAlpha = bgHex.length > 6 ? (parseInt(bgHex.slice(6), 16) / 255).toFixed(2) : '0.6'
          boxPart = `:box=1:boxcolor=${bgColor}@${bgAlpha}:boxborderw=8`
        }

        const dtFilter = `drawtext=text='${escapedText}'${alignPart}:fontsize=${fontSize}:fontcolor=${fontColor}:x=(w-text_w)/2:y=${yExpr}${boxPart}:enable='between(t\\,${subStart.toFixed(3)}\\,${subEnd.toFixed(3)})'`

        filterParts.push(`[${lastLabel}]${dtFilter}[${nextLabel}]`)
        lastLabel = nextLabel
      }
    }

  }

  // Rename final label to outv
  if (lastLabel !== 'outv') {
    filterParts.push(`[${lastLabel}]null[outv]`)
  }

  return { inputs, filterScript: filterParts.join(';\n') }
}
