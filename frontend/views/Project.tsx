import { useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Sparkles, Film, Save, Download, Pencil, Clapperboard } from 'lucide-react'
import { DirectWithClaudeModal } from '../components/DirectWithClaudeModal'
import { useProjects } from '../contexts/ProjectContext'
import { useView } from '../contexts/ViewContext'
import { RixLogo } from '../components/RixLogo'
import { Button } from '../components/ui/button'
import { GenSpace } from './GenSpace'
import { VideoEditor } from './VideoEditor'
import type { ProjectTab } from '../types/project-model'
import {
  hasVisualAssetMetadataForMigration,
  runVisualAssetMetadataMigration,
} from '../lib/project-asset-metadata-migration'

/** If the Video Editor is mounted, ask it to flush any pending (debounced)
 * autosave immediately so a manual "Save Project" is guaranteed to capture
 * the latest timeline state, not just whatever was last auto-saved. */
function flushEditorAutosave(): void {
  window.dispatchEvent(new Event('ltx:flush-editor'))
}

export function Project() {
  const {
    activeProject,
    currentTab,
    setProject,
    getProject,
    setCurrentTab,
    updateAsset,
    renameProject,
    pendingRetakeUpdate,
    setPendingRetakeUpdate,
    pendingIcLoraUpdate,
    setPendingIcLoraUpdate,
  } = useProjects()
  const { goHome } = useView()
  const [assetMetadataMigrationProgress, setAssetMetadataMigrationProgress] = useState({ running: false, total: 0, completed: 0 })
  const [upgradePassProjectId, setUpgradePassProjectId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [isEditingName, setIsEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [showDirector, setShowDirector] = useState(false)
  const flashToast = useCallback((message: string) => {
    setToast(message)
    setTimeout(() => setToast(null), 2200)
  }, [])
  const activeProjectId = activeProject?.id ?? null

  // Gen Space stays mounted across tab switches so an in-progress generation
  // (prompt, progress, result) survives jumping to the Video Editor and back —
  // previously the tab switch unmounted it and silently dropped the work.
  // The Video Editor mounts on first visit and then also stays alive.
  const [editorMounted, setEditorMounted] = useState(currentTab === 'video-editor')
  useEffect(() => {
    if (currentTab === 'video-editor') setEditorMounted(true)
  }, [currentTab])
  const activeProjectAssets = activeProject?.assets ?? null
  const needsAssetMetadataMigration = activeProjectAssets
    ? hasVisualAssetMetadataForMigration(activeProjectAssets)
    : false

  const handleSaveActiveProject = useCallback((project: typeof activeProject extends null ? never : NonNullable<typeof activeProject>) => {
    if (!activeProjectId) return
    setProject(activeProjectId, project)
  }, [activeProjectId, setProject])

  const handleManualSave = useCallback(() => {
    if (!activeProjectId) return
    flushEditorAutosave()
    flashToast('Project saved')
  }, [activeProjectId, flashToast])

  const startEditingName = useCallback(() => {
    if (!activeProject) return
    setNameDraft(activeProject.name)
    setIsEditingName(true)
  }, [activeProject])

  const submitNameEdit = useCallback(() => {
    const trimmed = nameDraft.trim()
    if (activeProjectId && trimmed) renameProject(activeProjectId, trimmed)
    setIsEditingName(false)
  }, [activeProjectId, nameDraft, renameProject])

  const handleExportProject = useCallback(async () => {
    if (!activeProjectId) return
    const api = window.electronAPI
    if (!api) {
      flashToast('Export failed: native app features are unavailable in this window')
      return
    }
    flushEditorAutosave()
    const project = getProject(activeProjectId)
    if (!project) return

    try {
      const safeName = project.name.replace(/[^a-zA-Z0-9._ -]/g, '_').trim() || 'project'
      const filePath = await api.showSaveDialog({
        title: 'Export Project',
        defaultPath: `${safeName}.ltxproj.json`,
        filters: [{ name: 'LTX Project', extensions: ['json'] }],
      })
      if (!filePath) return // user cancelled the dialog — not an error

      const result = await api.saveFile({ filePath, data: JSON.stringify(project, null, 2) })
      flashToast(result.success ? 'Project exported' : `Export failed: ${result.error}`)
    } catch (error) {
      flashToast(`Export failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [activeProjectId, getProject, flashToast])

  // File menu's "Save Project" / "Export Project..." land here too.
  useEffect(() => {
    const handler = (e: Event) => {
      const action = (e as CustomEvent).detail
      if (action === 'save-project') handleManualSave()
      else if (action === 'export-project') void handleExportProject()
    }
    window.addEventListener('ltx:menu-action', handler)
    return () => window.removeEventListener('ltx:menu-action', handler)
  }, [handleManualSave, handleExportProject])

  useEffect(() => {
    if (!activeProjectId || !activeProjectAssets || !needsAssetMetadataMigration) return

    let cancelled = false

    const runAssetMetadataMigration = async () => {
      for await (const event of runVisualAssetMetadataMigration(activeProjectAssets, window.electronAPI)) {
        if (cancelled) return

        if (event.kind === 'progress') {
          setAssetMetadataMigrationProgress({ running: true, total: event.total, completed: event.completed })
          continue
        }

        for (const update of event.updates) {
          updateAsset(activeProjectId, update.assetId, update.updates)
        }

        setAssetMetadataMigrationProgress({ running: false, total: 0, completed: 0 })
        setUpgradePassProjectId(activeProjectId)
      }
    }

    void runAssetMetadataMigration()

    return () => {
      cancelled = true
    }
  }, [activeProjectAssets, activeProjectId, needsAssetMetadataMigration, updateAsset])

  useEffect(() => {
    if (currentTab !== 'video-editor') return
    if (pendingRetakeUpdate) setPendingRetakeUpdate(null)
    if (pendingIcLoraUpdate) setPendingIcLoraUpdate(null)
  }, [
    currentTab,
    pendingRetakeUpdate,
    setPendingRetakeUpdate,
    pendingIcLoraUpdate,
    setPendingIcLoraUpdate,
  ])
  
  if (!activeProject) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-zinc-400 mb-4">Project not found</p>
          <Button onClick={goHome}>Go Home</Button>
        </div>
      </div>
    )
  }
  
  const tabs: { id: ProjectTab; label: string; icon: React.ReactNode }[] = [
    { id: 'gen-space', label: 'Create', icon: <Sparkles className="h-4 w-4" /> },
    { id: 'video-editor', label: 'Video Editor', icon: <Film className="h-4 w-4" /> },
  ]
  const shouldShowAssetMetadataMigrationProgressScreen = assetMetadataMigrationProgress.running
    || (upgradePassProjectId !== activeProjectId && needsAssetMetadataMigration)

  if (shouldShowAssetMetadataMigrationProgressScreen) {
    const progressPct = assetMetadataMigrationProgress.total > 0
      ? (assetMetadataMigrationProgress.completed / assetMetadataMigrationProgress.total) * 100
      : 0

    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="w-[360px]">
          <p className="text-center text-sm text-zinc-300 mb-4">
            Preparing your project assets...
          </p>
          <div className="h-2 w-full rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-150"
              style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
            />
          </div>
        </div>
      </div>
    )
  }
  
  return (
    <div className="h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="flex items-center px-4 py-3 border-b border-zinc-800">
        <div className="flex-1 flex items-center gap-4">
          {/* Back button and logo */}
          <button 
            onClick={goHome}
            className="p-2 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <ArrowLeft className="h-5 w-5 text-zinc-400" />
          </button>
          
          <RixLogo className="h-5" />

          {/* Project name */}
          {isEditingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={submitNameEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitNameEdit()
                else if (e.key === 'Escape') setIsEditingName(false)
              }}
              className="bg-zinc-800 border border-zinc-700 rounded-md px-2 py-0.5 text-white font-medium text-sm outline-none focus:border-blue-500 w-40"
            />
          ) : (
            <button
              onClick={startEditingName}
              title="Rename this project"
              className="flex items-center gap-1.5 group"
            >
              <span className="text-white font-medium">{activeProject.name}</span>
              <Pencil className="h-3 w-3 text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          )}
        </div>
        
        {/* Center - Tabs */}
        <div className="flex items-center gap-1 bg-zinc-900 rounded-lg p-1">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setCurrentTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                currentTab === tab.id
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
        
        {/* Right - manual save/export, balances the left side to keep tabs centered.
            pr-20 clears the global Logs/Settings icons fixed at the window's top-right. */}
        <div className="flex-1 flex items-center justify-end gap-2 pr-20">
          <button
            onClick={() => {
              // Claude's edits land in the Video Editor, which must be mounted to accept them,
              // so take the user there up front: the panel opens over the editor they'll watch.
              setCurrentTab('video-editor')
              setShowDirector(true)
            }}
            title="Have Claude cut a video from your assets (runs in your own Claude app)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-white bg-[rgb(var(--accent)/0.85)] hover:bg-[rgb(var(--accent))] transition-colors"
          >
            <Clapperboard className="h-4 w-4" />Edit with Claude
          </button>
          <button
            onClick={handleManualSave}
            title="Save the project now (it also autosaves continuously)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <Save className="h-4 w-4" />Save
          </button>
          <button
            onClick={() => void handleExportProject()}
            title="Export this project to a file (for backup or moving to another computer)"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <Download className="h-4 w-4" />Export
          </button>
        </div>
      </header>

      {showDirector && (
        <DirectWithClaudeModal
          project={{ id: activeProject.id, name: activeProject.name }}
          projectAudio={activeProject.assets.filter(a => a.type === 'audio')}
          timelines={activeProject.timelines.map(t => ({ id: t.id, name: t.name }))}
          onClose={() => setShowDirector(false)}
          onOpened={(message) => {
            // Already on the editor (the button switched there); make sure it's still in front.
            setCurrentTab('video-editor')
            flashToast(message)
          }}
        />
      )}

      {toast && (
        <div className="absolute top-14 right-4 z-50 px-4 py-2 rounded-lg text-sm bg-zinc-800 border border-zinc-700 text-white shadow-xl">
          {toast}
        </div>
      )}

      <main className="flex-1 overflow-hidden relative">
        <div className={`absolute inset-0 ${currentTab === 'gen-space' ? '' : 'hidden'}`}>
          <GenSpace />
        </div>
        {editorMounted && (
          <div className={`absolute inset-0 ${currentTab === 'video-editor' ? '' : 'hidden'}`}>
            <VideoEditor
              key={activeProject.id}
              currentProject={activeProject}
              saveProject={handleSaveActiveProject}
              pendingRetakeUpdate={pendingRetakeUpdate}
              pendingIcLoraUpdate={pendingIcLoraUpdate}
            />
          </div>
        )}
      </main>
    </div>
  )
}
