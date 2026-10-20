/**
 * The film-look grid for the FILTERS panel.
 *
 * Each swatch is the clip's OWN frame with that look applied — the same SVG
 * filter the program monitor uses, so the grid is a true preview of the grade
 * rather than a stock sample image. Looks and their math live in
 * shared/film-looks.ts, which the export reads too.
 */

import { Film, RotateCcw } from 'lucide-react'
import { FILM_LOOKS, type ClipFilmLook } from '../../../shared/film-looks'
import { FilmLookDefs, filmLookFilterId } from '../../components/FilmLookDefs'
import { Tooltip } from '../../components/ui/tooltip'

const DEFAULT_INTENSITY = 100

/** Full-strength swatches; the clip's own intensity only drives the monitor. */
const SWATCH_LOOKS: readonly ClipFilmLook[] = FILM_LOOKS.map((l) => ({ presetId: l.id, intensity: 100 }))

export function FilmLookPicker({
  value,
  thumbnailUrl,
  onChange,
  onApplyToAll,
}: {
  value: ClipFilmLook | undefined
  thumbnailUrl: string | null
  onChange: (next: ClipFilmLook | undefined) => void
  onApplyToAll: () => void
}) {
  const activeId = value?.presetId
  const intensity = value?.intensity ?? DEFAULT_INTENSITY

  const swatchBody = (filterId: string | null) => (
    thumbnailUrl
      ? (
        <img
          src={thumbnailUrl}
          alt=""
          draggable={false}
          className="w-full h-full object-cover"
          style={filterId ? { filter: `url(#${filterId})` } : undefined}
        />
      )
      : (
        // No thumbnail yet (a still being imported, a missing file): grade a
        // gradient instead so the swatch still reads as its look.
        <div
          className="w-full h-full"
          style={{
            background: 'linear-gradient(135deg, #e8e2d8 0%, #9a8f7d 45%, #2b2b33 100%)',
            ...(filterId ? { filter: `url(#${filterId})` } : {}),
          }}
        />
      )
  )

  return (
    <div className="space-y-2">
      <FilmLookDefs looks={SWATCH_LOOKS} />

      <div className="grid grid-cols-3 gap-1.5">
        <button
          onClick={() => onChange(undefined)}
          title="No look — the clip's own colour"
          className={`relative aspect-video rounded overflow-hidden border transition-colors ${
            !activeId ? 'border-blue-500' : 'border-zinc-700 hover:border-zinc-500'
          }`}
        >
          {swatchBody(null)}
          <span className="absolute inset-x-0 bottom-0 bg-black/70 text-[9px] text-zinc-200 py-0.5 text-center">
            None
          </span>
        </button>

        {FILM_LOOKS.map((look) => {
          const selected = activeId === look.id
          return (
            <Tooltip key={look.id} content={look.blurb} side="right">
              <button
                onClick={() => onChange({ presetId: look.id, intensity: value?.intensity ?? DEFAULT_INTENSITY })}
                className={`relative aspect-video w-full rounded overflow-hidden border transition-colors ${
                  selected ? 'border-blue-500' : 'border-zinc-700 hover:border-zinc-500'
                }`}
              >
                {swatchBody(filmLookFilterId({ presetId: look.id, intensity: 100 }))}
                <span className="absolute inset-x-0 bottom-0 bg-black/70 text-[9px] text-zinc-200 py-0.5 px-1 text-center truncate">
                  {look.name}
                </span>
              </button>
            </Tooltip>
          )
        })}
      </div>

      {value && (
        <>
          <div>
            <div className="flex items-center justify-between mb-0.5">
              <div className="flex items-center gap-1.5">
                <Film className="h-3 w-3 text-zinc-500" />
                <span className="text-[11px] text-zinc-400">Intensity</span>
              </div>
              <span className="text-[10px] text-zinc-500 tabular-nums">{intensity}</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={intensity}
              onChange={(e) => onChange({ presetId: value.presetId, intensity: parseInt(e.target.value, 10) })}
              className="w-full h-1.5 accent-blue-500"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-blue-400 transition-colors"
              onClick={onApplyToAll}
            >
              <Film className="h-3 w-3" />
              Apply to all clips
            </button>
            <button
              className="flex items-center gap-1.5 text-[10px] text-zinc-500 hover:text-blue-400 transition-colors"
              onClick={() => onChange(undefined)}
            >
              <RotateCcw className="h-3 w-3" />
              Clear
            </button>
          </div>
        </>
      )}
    </div>
  )
}
