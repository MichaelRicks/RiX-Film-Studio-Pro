import { useState } from 'react'
import type { ReactNode } from 'react'
import { FiltersPanel } from './FiltersPanel'
import { MusicPanel } from './MusicPanel'

type LibraryTab = 'assets' | 'filters' | 'music'

const TAB_KEY = 'rix.editor.libraryTab'

function readTab(): LibraryTab {
  try {
    const saved = localStorage.getItem(TAB_KEY)
    return saved === 'filters' || saved === 'music' ? saved : 'assets'
  } catch { return 'assets' }
}

/** The top of the editor's left column: Assets, FILTERS or MUSIC, one tab each. The Assets panel stays
 *  mounted while hidden so its selection, scroll and open bins are still there when you come back. */
export function EditorLibraryPanel({ assetsPanel, currentProjectId }: { assetsPanel: ReactNode; currentProjectId: string | null }) {
  const [tab, setTabState] = useState<LibraryTab>(readTab)
  const setTab = (next: LibraryTab) => {
    setTabState(next)
    try { localStorage.setItem(TAB_KEY, next) } catch { /* storage unavailable */ }
  }

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="flex-shrink-0 flex gap-1 px-4 pt-3 border-r border-zinc-800">
        {([['assets', 'ASSETS'], ['filters', 'FILTERS'], ['music', 'MUSIC']] as const).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-1 rounded-md text-[10px] font-semibold tracking-wider transition-colors ${
              tab === id ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className={tab === 'assets' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>{assetsPanel}</div>
      {tab === 'filters' && <div className="flex-1 min-h-0 flex flex-col"><FiltersPanel /></div>}
      {tab === 'music' && <div className="flex-1 min-h-0 flex flex-col"><MusicPanel currentProjectId={currentProjectId} /></div>}
    </div>
  )
}
