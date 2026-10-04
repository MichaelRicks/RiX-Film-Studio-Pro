// Timeline zoom. 1 = 100 px per second; the floor is 0.1 px per second, which
// puts about three hours across a 1100 px timeline.
export const MAX_ZOOM = 4
export const MIN_ZOOM_FLOOR = 0.001
export const ZOOM_SLIDER_MAX = 1000

const ZOOM_STEP = 1.25

export function clampZoom(zoom: number, minZoom: number): number {
  return +Math.min(MAX_ZOOM, Math.max(minZoom, zoom)).toFixed(4)
}

/** One zoom step in or out. Proportional, so it feels the same at 4 px/s as at 400. */
export function stepZoom(zoom: number, direction: 1 | -1, minZoom: number, factor = ZOOM_STEP): number {
  return clampZoom(direction > 0 ? zoom * factor : zoom / factor, minZoom)
}

// The slider runs on a log scale: on a long timeline the useful range spans three
// orders of magnitude, and a linear slider would spend almost all of its travel
// on the zoomed-in end.
export function zoomToSlider(zoom: number, minZoom: number): number {
  const lo = Math.log(Math.min(minZoom, MAX_ZOOM / 2))
  const hi = Math.log(MAX_ZOOM)
  const t = (Math.log(Math.max(zoom, minZoom)) - lo) / (hi - lo)
  return Math.round(Math.max(0, Math.min(1, t)) * ZOOM_SLIDER_MAX)
}

export function sliderToZoom(value: number, minZoom: number): number {
  const lo = Math.log(Math.min(minZoom, MAX_ZOOM / 2))
  const hi = Math.log(MAX_ZOOM)
  return clampZoom(Math.exp(lo + (value / ZOOM_SLIDER_MAX) * (hi - lo)), minZoom)
}

export function formatZoom(zoom: number): string {
  const pct = zoom * 100
  return `${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%`
}
