/**
 * FILTERS: the look library for the clip(s) selected on the timeline. It lives beside
 * Assets in the left column, as its own panel, so it has room to grow: each kind of
 * filter is a section below, and Film Looks is the first.
 */

import { useMemo } from 'react'
import { Film } from 'lucide-react'
import { FILM_LOOKS_BY_ID } from '../../../shared/film-looks'
import type { ClipFilmLook } from '../../../shared/film-looks'
import { pathToFileUrl } from '../../lib/file-url'
import { selectAssets, selectClips, selectSelectedClipIds } from './editor-selectors'
import { useEditorActions, useEditorStore } from './editor-store'
import { FilmLookPicker } from './FilmLookPicker'

export function FiltersPanel() {
  const { setClipsFilmLook } = useEditorActions()
  const assets = useEditorStore(selectAssets)
  const clips = useEditorStore(selectClips)
  const selectedIds = useEditorStore(selectSelectedClipIds)

  // Filters only mean something for picture clips.
  const targets = useMemo(
    () => clips.filter(c => selectedIds.has(c.id) && (c.type === 'video' || c.type === 'image')),
    [clips, selectedIds],
  )
  const first = targets[0]

  // Swatches grade the first selected clip's own frame, so the grid shows this shot in each look.
  const asset = first ? (first.assetId ? assets.find(a => a.id === first.assetId) ?? first.asset : first.asset) : null
  const thumbPath = asset?.smallThumbnailPath
    ?? asset?.bigThumbnailPath
    ?? (first?.type === 'image' ? asset?.path : undefined)
  const thumbnailUrl = thumbPath ? pathToFileUrl(thumbPath) : null

  const activeLookName = first?.filmLook ? FILM_LOOKS_BY_ID.get(first.filmLook.presetId)?.name ?? null : null

  const applyToSelection = (next: ClipFilmLook | undefined) => {
    if (targets.length === 0) return
    setClipsFilmLook(targets.map(c => c.id), next)
  }

  const applyToAllClips = () => {
    const look = first?.filmLook
    if (!look) return
    const ids = clips.filter(c => c.type === 'video' || c.type === 'image').map(c => c.id)
    setClipsFilmLook(ids, { ...look })
  }

  const status = targets.length === 0
    ? 'Select a clip on the timeline to apply a filter.'
    : targets.length === 1
      ? 'Applies to the selected clip.'
      : `Applies to ${targets.length} selected clips.`

  return (
    <div className="flex flex-col min-h-0 h-full border-r border-zinc-800">
      <div className="p-4 pb-2 flex-shrink-0">
        <h3 className="text-sm font-semibold tracking-wider text-white">FILTERS</h3>
        <p className="mt-0.5 text-[11px] text-zinc-500">{status}</p>
      </div>

      <div className="flex-1 min-h-0 overflow-auto px-4 pb-4 space-y-4">
        <section>
          <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-zinc-400">
            <Film className="h-3.5 w-3.5" />
            Film Looks
            {activeLookName && (
              <span className="ml-auto text-[10px] font-normal text-zinc-500 truncate max-w-[140px]">{activeLookName}</span>
            )}
          </div>
          <div className={targets.length === 0 ? 'opacity-50 pointer-events-none' : undefined}>
            <FilmLookPicker
              value={first?.filmLook}
              thumbnailUrl={thumbnailUrl}
              onChange={applyToSelection}
              onApplyToAll={applyToAllClips}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
