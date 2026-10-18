import React, { createContext, useCallback, useContext, useState } from 'react'
import { hasLegacyProjectsEntry } from '../hooks/useProjectReferencesMigration'
import { createDefaultTimeline, normalizeProject, type Project, type Asset, type AssetTake, type ProjectTab } from '../types/project-model'
import {
  deleteProjectEntry,
  readProject,
  readProjectIds,
  writeProject,
  writeProjectIds,
} from '../lib/project-storage'

interface ProjectContextType {
  currentTab: ProjectTab
  setCurrentTab: (tab: ProjectTab) => void

  projectIds: string[]
  activeProject: Project | null
  getProject: (id: string) => Project | null
  setProject: (id: string, project: Project) => void
  createProject: (name: string) => Project
  importProject: (projectData: unknown) => Project
  restoreProject: (projectData: unknown) => Project
  duplicateProject: (id: string) => Project | null
  deleteProject: (id: string) => void
  renameProject: (id: string, name: string) => void
  setProjectCover: (id: string, assetId: string | null) => void
  activateProject: (id: string) => void
  clearActiveProject: () => void
  reloadProjectIds: () => void

  addAsset: (projectId: string, asset: Omit<Asset, 'id' | 'createdAt'>) => Asset
  deleteAsset: (projectId: string, assetId: string) => void
  updateAsset: (projectId: string, assetId: string, updates: Partial<Asset>) => void
  addTakeToAsset: (projectId: string, assetId: string, take: AssetTake) => void
  deleteTakeFromAsset: (projectId: string, assetId: string, takeIndex: number) => void
  setAssetActiveTake: (projectId: string, assetId: string, takeIndex: number) => void
  toggleFavorite: (projectId: string, assetId: string) => void

  createBin: (projectId: string, name: string) => string
  renameBin: (projectId: string, binId: string, name: string) => void
  deleteBin: (projectId: string, binId: string) => void

  genSpaceEditImagePath: string | null
  setGenSpaceEditImagePath: (path: string | null) => void
  genSpaceEditMode: 'image' | 'video' | null
  setGenSpaceEditMode: (mode: 'image' | 'video' | null) => void
  genSpaceAudioPath: string | null
  setGenSpaceAudioPath: (path: string | null) => void
  genSpaceRetakeSource: GenSpaceRetakeSource | null
  setGenSpaceRetakeSource: (source: GenSpaceRetakeSource | null) => void
  pendingRetakeUpdate: PendingRetakeUpdate | null
  setPendingRetakeUpdate: (update: PendingRetakeUpdate | null) => void
  genSpaceIcLoraSource: GenSpaceIcLoraSource | null
  setGenSpaceIcLoraSource: (source: GenSpaceIcLoraSource | null) => void
  pendingIcLoraUpdate: PendingIcLoraUpdate | null
  setPendingIcLoraUpdate: (update: PendingIcLoraUpdate | null) => void

  // Prompt text pushed into the Gen Space prompt box (e.g. from Prompt Manager Pro).
  genSpacePromptInjection: string | null
  setGenSpacePromptInjection: (text: string | null) => void
  // Reference image set as the Gen Space input image WITHOUT clearing the prompt
  // (used by Prompt Manager Pro's "send to Gen Space" / drag-drop).
  genSpaceInputImagePath: string | null
  setGenSpaceInputImagePath: (path: string | null) => void
  // Bumped to request clearing the Gen Space prompt box (Prompt Manager Pro).
  genSpacePromptClearNonce: number
  clearGenSpacePrompt: () => void
}

export interface GenSpaceRetakeSource {
  videoPath: string
  clipId?: string
  assetId?: string
  linkedClipIds?: string[]
  duration?: number
}

export interface PendingRetakeUpdate {
  assetId: string
  clipIds: string[]
  newTakeIndex: number
}

export interface GenSpaceIcLoraSource {
  videoPath: string
  clipId?: string
  assetId?: string
  linkedClipIds?: string[]
}

export interface PendingIcLoraUpdate {
  assetId: string
  clipIds: string[]
  newTakeIndex: number
}

const ProjectContext = createContext<ProjectContextType | null>(null)

function loadInitialProjectIds(): string[] {
  if (hasLegacyProjectsEntry()) return []
  return readProjectIds()
}

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [currentTab, setCurrentTab] = useState<ProjectTab>('gen-space')
  const [projectIds, setProjectIds] = useState<string[]>(() => loadInitialProjectIds())
  const [activeProject, setActiveProject] = useState<Project | null>(null)
  const [projectRevision, setProjectRevision] = useState(0)
  const [genSpaceEditImagePath, setGenSpaceEditImagePath] = useState<string | null>(null)
  const [genSpaceEditMode, setGenSpaceEditMode] = useState<'image' | 'video' | null>(null)
  const [genSpaceAudioPath, setGenSpaceAudioPath] = useState<string | null>(null)
  const [genSpaceRetakeSource, setGenSpaceRetakeSource] = useState<GenSpaceRetakeSource | null>(null)
  const [pendingRetakeUpdate, setPendingRetakeUpdate] = useState<PendingRetakeUpdate | null>(null)
  const [genSpaceIcLoraSource, setGenSpaceIcLoraSource] = useState<GenSpaceIcLoraSource | null>(null)
  const [pendingIcLoraUpdate, setPendingIcLoraUpdate] = useState<PendingIcLoraUpdate | null>(null)
  const [genSpacePromptInjection, setGenSpacePromptInjection] = useState<string | null>(null)
  const [genSpaceInputImagePath, setGenSpaceInputImagePath] = useState<string | null>(null)
  const [genSpacePromptClearNonce, setGenSpacePromptClearNonce] = useState(0)
  const clearGenSpacePrompt = useCallback(() => setGenSpacePromptClearNonce((n) => n + 1), [])

  const bumpProjectRevision = useCallback(() => {
    setProjectRevision(prev => prev + 1)
  }, [])

  const getProject = useCallback((id: string): Project | null => readProject(id), [projectRevision])

  const reloadProjectIds = useCallback(() => {
    const nextProjectIds = hasLegacyProjectsEntry() ? [] : readProjectIds()
    setProjectIds(nextProjectIds)
    setActiveProject(prev => (
      prev && nextProjectIds.includes(prev.id) ? prev : null
    ))
    bumpProjectRevision()
  }, [bumpProjectRevision])

  const activateProject = useCallback((id: string) => {
    setActiveProject(readProject(id))
  }, [])

  const clearActiveProject = useCallback(() => {
    setActiveProject(null)
  }, [])

  const persistProject = useCallback((projectId: string, project: Project): Project => {
    const persistedProject = writeProject(projectId, normalizeProject({ ...project, id: projectId }))
    setActiveProject(prev => (prev?.id === projectId ? persistedProject : prev))
    bumpProjectRevision()
    return persistedProject
  }, [bumpProjectRevision])

  const mutateProject = useCallback((projectId: string, updater: (project: Project) => Project): Project | null => {
    const project = readProject(projectId)
    if (!project) return null
    return persistProject(projectId, updater(project))
  }, [persistProject])

  const setProject = useCallback((projectId: string, project: Project) => {
    persistProject(projectId, project)
  }, [persistProject])

  const createProject = useCallback((name: string): Project => {
    const defaultTimeline = createDefaultTimeline('Timeline 1')
    const newProject = normalizeProject({
      id: `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      assets: [],
      timelines: [defaultTimeline],
      activeTimelineId: defaultTimeline.id,
    })

    const persistedProject = writeProject(newProject.id, newProject)
    const nextProjectIds = [persistedProject.id, ...readProjectIds().filter(id => id !== persistedProject.id)]
    writeProjectIds(nextProjectIds)
    setProjectIds(nextProjectIds)
    bumpProjectRevision()
    return persistedProject
  }, [bumpProjectRevision])

  // Register an exported project file (see Project.tsx's "Export Project...")
  // as a new project. Always assigns a fresh id so re-importing the same file,
  // or importing on a machine that already has a project with that id, never
  // collides with or overwrites an existing project.
  const importProject = useCallback((projectData: unknown): Project => {
    const normalized = normalizeProject(projectData)

    const existingNames = new Set(
      readProjectIds().map(id => readProject(id)?.name).filter((name): name is string => !!name)
    )
    let importedName = normalized.name
    if (existingNames.has(importedName)) {
      let suffix = 1
      let candidate = `${importedName} (Imported)`
      while (existingNames.has(candidate)) {
        suffix += 1
        candidate = `${importedName} (Imported ${suffix})`
      }
      importedName = candidate
    }

    const importedProject = normalizeProject({
      ...normalized,
      name: importedName,
      id: `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      updatedAt: Date.now(),
    })

    const persistedProject = writeProject(importedProject.id, importedProject)
    const nextProjectIds = [persistedProject.id, ...readProjectIds().filter(id => id !== persistedProject.id)]
    writeProjectIds(nextProjectIds)
    setProjectIds(nextProjectIds)
    bumpProjectRevision()
    return persistedProject
  }, [bumpProjectRevision])

  // Put back a project from its on-disk backup (lib/project-backup.ts). Unlike
  // importProject this keeps the id, so the project's asset folder and backup
  // file still belong to it, and it replaces a stale copy of the same project.
  const restoreProject = useCallback((projectData: unknown): Project => {
    const restored = normalizeProject(projectData)
    const persistedProject = writeProject(restored.id, restored)
    const nextProjectIds = [persistedProject.id, ...readProjectIds().filter(id => id !== persistedProject.id)]
    writeProjectIds(nextProjectIds)
    setProjectIds(nextProjectIds)
    setActiveProject(prev => (prev?.id === persistedProject.id ? persistedProject : prev))
    bumpProjectRevision()
    return persistedProject
  }, [bumpProjectRevision])

  // Duplicate a project for incremental work. Assets keep their original
  // `path`/`bigThumbnailPath`/`smallThumbnailPath` references rather than
  // copying files on disk, mirroring how importProject already works.
  const duplicateProject = useCallback((id: string): Project | null => {
    const source = readProject(id)
    if (!source) return null

    const existingNames = new Set(
      readProjectIds().map(projectId => readProject(projectId)?.name).filter((name): name is string => !!name)
    )
    let duplicateName = `${source.name} (Copy)`
    let suffix = 1
    while (existingNames.has(duplicateName)) {
      suffix += 1
      duplicateName = `${source.name} (Copy ${suffix})`
    }

    const duplicatedProject = normalizeProject({
      ...source,
      name: duplicateName,
      id: `project-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    const persistedProject = writeProject(duplicatedProject.id, duplicatedProject)
    const nextProjectIds = [persistedProject.id, ...readProjectIds().filter(projectId => projectId !== persistedProject.id)]
    writeProjectIds(nextProjectIds)
    setProjectIds(nextProjectIds)
    bumpProjectRevision()
    return persistedProject
  }, [bumpProjectRevision])

  const deleteProject = useCallback((id: string) => {
    const nextProjectIds = readProjectIds().filter(projectId => projectId !== id)
    writeProjectIds(nextProjectIds)
    setProjectIds(nextProjectIds)
    deleteProjectEntry(id)
    setActiveProject(prev => (prev?.id === id ? null : prev))
    bumpProjectRevision()
  }, [bumpProjectRevision])

  const renameProject = useCallback((id: string, name: string) => {
    mutateProject(id, project => ({
      ...project,
      name,
      updatedAt: Date.now(),
    }))
  }, [mutateProject])

  const setProjectCover = useCallback((id: string, assetId: string | null) => {
    mutateProject(id, project => ({
      ...project,
      coverAssetId: assetId ?? undefined,
      updatedAt: Date.now(),
    }))
  }, [mutateProject])

  const addAsset = useCallback((projectId: string, assetData: Omit<Asset, 'id' | 'createdAt'>): Asset => {
    const newAsset: Asset = {
      ...assetData,
      id: `asset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now(),
    }

    mutateProject(projectId, project => ({
      ...project,
      assets: [newAsset, ...project.assets],
      updatedAt: Date.now(),
    }))

    return newAsset
  }, [mutateProject])

  const deleteAsset = useCallback((projectId: string, assetId: string) => {
    mutateProject(projectId, project => ({
      ...project,
      assets: project.assets.filter(asset => asset.id !== assetId),
      updatedAt: Date.now(),
    }))
  }, [mutateProject])

  const updateAsset = useCallback((projectId: string, assetId: string, updates: Partial<Asset>) => {
    mutateProject(projectId, project => ({
      ...project,
      assets: project.assets.map(asset => (
        asset.id === assetId ? { ...asset, ...updates } : asset
      )),
      updatedAt: Date.now(),
    }))
  }, [mutateProject])

  const addTakeToAsset = useCallback((projectId: string, assetId: string, take: AssetTake) => {
    mutateProject(projectId, project => ({
      ...project,
      assets: project.assets.map(asset => {
        if (asset.id !== assetId) return asset

        const existingTakes: AssetTake[] = asset.takes || [{
          path: asset.path,
          bigThumbnailPath: asset.bigThumbnailPath,
          smallThumbnailPath: asset.smallThumbnailPath,
          width: asset.width,
          height: asset.height,
          createdAt: asset.createdAt,
        }]
        const newTakes = [...existingTakes, take]
        const newIndex = newTakes.length - 1

        return {
          ...asset,
          takes: newTakes,
          activeTakeIndex: newIndex,
          path: take.path,
          bigThumbnailPath: take.bigThumbnailPath,
          smallThumbnailPath: take.smallThumbnailPath,
          width: take.width,
          height: take.height,
        }
      }),
      updatedAt: Date.now(),
    }))
  }, [mutateProject])

  const deleteTakeFromAsset = useCallback((projectId: string, assetId: string, takeIndex: number) => {
    mutateProject(projectId, project => ({
      ...project,
      assets: project.assets.map(asset => {
        if (asset.id !== assetId || !asset.takes || asset.takes.length <= 1) return asset

        const newTakes = asset.takes.filter((_, index) => index !== takeIndex)
        let newActiveIdx = asset.activeTakeIndex ?? newTakes.length - 1
        if (newActiveIdx >= newTakes.length) newActiveIdx = newTakes.length - 1
        if (newActiveIdx < 0) newActiveIdx = 0
        const activeTake = newTakes[newActiveIdx]

        return {
          ...asset,
          takes: newTakes,
          activeTakeIndex: newActiveIdx,
          path: activeTake.path,
          bigThumbnailPath: activeTake.bigThumbnailPath,
          smallThumbnailPath: activeTake.smallThumbnailPath,
          width: activeTake.width,
          height: activeTake.height,
        }
      }),
      updatedAt: Date.now(),
    }))
  }, [mutateProject])

  const setAssetActiveTake = useCallback((projectId: string, assetId: string, takeIndex: number) => {
    mutateProject(projectId, project => ({
      ...project,
      assets: project.assets.map(asset => {
        if (asset.id !== assetId || !asset.takes) return asset

        const nextIndex = Math.max(0, Math.min(takeIndex, asset.takes.length - 1))
        const take = asset.takes[nextIndex]

        return {
          ...asset,
          activeTakeIndex: nextIndex,
          path: take.path,
          bigThumbnailPath: take.bigThumbnailPath,
          smallThumbnailPath: take.smallThumbnailPath,
          width: take.width,
          height: take.height,
        }
      }),
      updatedAt: Date.now(),
    }))
  }, [mutateProject])

  const toggleFavorite = useCallback((projectId: string, assetId: string) => {
    mutateProject(projectId, project => ({
      ...project,
      assets: project.assets.map(asset => (
        asset.id === assetId ? { ...asset, favorite: !asset.favorite } : asset
      )),
      updatedAt: Date.now(),
    }))
  }, [mutateProject])

  const createBin = useCallback((projectId: string, name: string): string => {
    const binId = `bin-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    mutateProject(projectId, project => ({
      ...project,
      bins: { ...project.bins, [binId]: name },
      updatedAt: Date.now(),
    }))
    return binId
  }, [mutateProject])

  const renameBin = useCallback((projectId: string, binId: string, name: string) => {
    mutateProject(projectId, project => ({
      ...project,
      bins: { ...project.bins, [binId]: name },
      updatedAt: Date.now(),
    }))
  }, [mutateProject])

  const deleteBin = useCallback((projectId: string, binId: string) => {
    mutateProject(projectId, project => {
      const nextBins = { ...project.bins }
      delete nextBins[binId]
      return {
        ...project,
        bins: nextBins,
        assets: project.assets.map(asset => (
          asset.binId === binId ? { ...asset, binId: undefined } : asset
        )),
        updatedAt: Date.now(),
      }
    })
  }, [mutateProject])

  return (
    <ProjectContext.Provider value={{
      currentTab,
      setCurrentTab,
      projectIds,
      activeProject,
      getProject,
      setProject,
      createProject,
      importProject,
      duplicateProject,
      restoreProject,
      deleteProject,
      renameProject,
      setProjectCover,
      activateProject,
      clearActiveProject,
      reloadProjectIds,
      addAsset,
      deleteAsset,
      updateAsset,
      addTakeToAsset,
      deleteTakeFromAsset,
      setAssetActiveTake,
      toggleFavorite,
      createBin,
      renameBin,
      deleteBin,
      genSpaceEditImagePath,
      setGenSpaceEditImagePath,
      genSpaceEditMode,
      setGenSpaceEditMode,
      genSpaceAudioPath,
      setGenSpaceAudioPath,
      genSpaceRetakeSource,
      setGenSpaceRetakeSource,
      pendingRetakeUpdate,
      setPendingRetakeUpdate,
      genSpaceIcLoraSource,
      setGenSpaceIcLoraSource,
      pendingIcLoraUpdate,
      setPendingIcLoraUpdate,
      genSpacePromptInjection,
      setGenSpacePromptInjection,
      genSpaceInputImagePath,
      setGenSpaceInputImagePath,
      genSpacePromptClearNonce,
      clearGenSpacePrompt,
    }}>
      {children}
    </ProjectContext.Provider>
  )
}

export function useProjects() {
  const context = useContext(ProjectContext)
  if (!context) {
    throw new Error('useProjects must be used within a ProjectProvider')
  }
  return context
}
