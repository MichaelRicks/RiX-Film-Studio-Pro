import { z } from 'zod'

const fileFilter = z.object({ name: z.string(), extensions: z.array(z.string()) })

function ipcResult<T extends z.ZodRawShape>(valueShape: T) {
  return z.discriminatedUnion('success', [
    z.object({ success: z.literal(true), ...valueShape }),
    z.object({ success: z.literal(false), error: z.string() }),
  ])
}

export type IpcResult<T extends z.ZodRawShape> = z.infer<ReturnType<typeof ipcResult<T>>>

const emptyResult = ipcResult({})

const exportColorCorrection = z.object({
  brightness: z.number(),
  contrast: z.number(),
  saturation: z.number(),
  temperature: z.number(),
  tint: z.number(),
  exposure: z.number(),
  highlights: z.number(),
  shadows: z.number(),
})

const exportClipTransition = z.object({
  type: z.string(),
  duration: z.number(),
})

const exportClip = z.object({
  path: z.string(),
  type: z.string(),
  startTime: z.number(),
  duration: z.number(),
  trimStart: z.number(),
  speed: z.number(),
  reversed: z.boolean(),
  flipH: z.boolean(),
  flipV: z.boolean(),
  opacity: z.number(),
  trackIndex: z.number(),
  muted: z.boolean(),
  volume: z.number(),
  audioFadeIn: z.number().optional(),
  audioFadeOut: z.number().optional(),
  volumeKeyframes: z.array(z.object({ t: z.number(), value: z.number() })).optional(),
  opacityKeyframes: z.array(z.object({ t: z.number(), value: z.number() })).optional(),
  // 9:16 framing (see TimelineClip.reframe); only applied when exporting vertical.
  reframe: z.object({
    pos: z.number(),
    keys: z.array(z.object({ t: z.number(), pos: z.number() })).optional(),
  }).optional(),
  // Placement in the frame for a graphic/logo clip (see TimelineClip.layer). Set,
  // faded or flagged `composite` and the clip is drawn OVER the tracks below
  // instead of replacing them.
  layer: z.object({
    x: z.number(),
    y: z.number(),
    scaleX: z.number(),
    scaleY: z.number(),
    keys: z.array(z.object({
      t: z.number(), x: z.number(), y: z.number(), scaleX: z.number(), scaleY: z.number(),
    })).optional(),
  }).optional(),
  composite: z.boolean().optional(),
  // Layer fade up/down in seconds. Unset = the 0.5s default, 0 = a hard cut.
  fadeIn: z.number().optional(),
  fadeOut: z.number().optional(),
  colorCorrection: exportColorCorrection.optional(),
  filmLook: z.object({ presetId: z.string(), intensity: z.number() }).optional(),
  transitionIn: exportClipTransition.optional(),
  transitionOut: exportClipTransition.optional(),
})

const exportSubtitle = z.object({
  text: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  style: z.object({
    fontSize: z.number(),
    fontFamily: z.string(),
    fontWeight: z.string(),
    color: z.string(),
    backgroundColor: z.string(),
    position: z.string(),
    italic: z.boolean(),
  }),
})

const exportTextOverlay = z.object({
  text: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  fadeIn: z.number().optional(),
  fadeOut: z.number().optional(),
  // Opacity automation: t = seconds from overlay start, value 0..100 (linear).
  opacityKeyframes: z.array(z.object({ t: z.number(), value: z.number() })).optional(),
  style: z.object({
    fontSize: z.number(),
    color: z.string(),
    backgroundColor: z.string(),
    positionX: z.number(),
    positionY: z.number(),
    strokeColor: z.string(),
    strokeWidth: z.number(),
    shadowColor: z.string(),
    shadowOffsetX: z.number(),
    shadowOffsetY: z.number(),
    opacity: z.number(),
    padding: z.number(),
    textAlign: z.string().optional(),
    // Resolved to a font file via shared/font-catalog (unknown → Arial).
    fontFamily: z.string().optional(),
    fontWeight: z.string().optional(),
    // Non-uniform stretch about the text's center (1 = none).
    scaleX: z.number().optional(),
    scaleY: z.number().optional(),
  }),
})

const logsResponse = z.object({
  logPath: z.string(),
  lines: z.array(z.string()),
  error: z.string().optional(),
})

const backendHealthStatus = z.object({
  status: z.enum(['alive', 'restarting', 'dead']),
  exitCode: z.number().nullable().optional(),
})

export type BackendHealthStatus = z.infer<typeof backendHealthStatus>

const updateStatePayload = z.object({
  status: z.enum(['idle', 'checking', 'available', 'downloading', 'downloaded', 'not-available']),
  currentVersion: z.string(),
  version: z.string().optional(),
  releaseNotes: z.string().optional(),
  percent: z.number().optional(),
  message: z.string().optional(),
})
export type UpdateStatePayload = z.infer<typeof updateStatePayload>

export const electronAPISchemas = {
  // App info
  getBackend: {
    input: z.object({}),
    output: z.object({ url: z.string(), token: z.string() }),
  },
  getModelsPath: {
    input: z.object({}),
    output: z.string(),
  },
  readLocalFile: {
    input: z.object({ filePath: z.string() }),
    output: z.object({ data: z.string(), mimeType: z.string() }),
  },
  checkGpu: {
    input: z.object({}),
    output: z.object({ available: z.boolean(), name: z.string().optional(), vram: z.number().optional() }),
  },
  getAppInfo: {
    input: z.object({}),
    output: z.object({ version: z.string(), isPackaged: z.boolean(), modelsPath: z.string(), userDataPath: z.string() }),
  },

  // First-run setup
  checkFirstRun: {
    input: z.object({}),
    output: z.object({ needsSetup: z.boolean(), needsLicense: z.boolean() }),
  },
  acceptLicense: {
    input: z.object({}),
    output: z.boolean(),
  },
  completeSetup: {
    input: z.object({}),
    output: z.boolean(),
  },
  fetchLicenseText: {
    input: z.object({}),
    output: z.string(),
  },
  getNoticesText: {
    input: z.object({}),
    output: z.string(),
  },

  // Open external pages / folders
  openLtxApiKeyPage: {
    input: z.object({}),
    output: z.boolean(),
  },
  openLtxBillingPage: {
    input: z.object({}),
    output: z.boolean(),
  },
  openFalApiKeyPage: {
    input: z.object({}),
    output: z.boolean(),
  },
  openHuggingFaceRepo: {
    input: z.object({ repoId: z.string() }),
    output: z.boolean(),
  },
  openExternalUrl: {
    input: z.object({ url: z.string() }),
    output: z.boolean(),
  },
  openHuggingFaceAuth: {
    input: z.object({
      clientId: z.string(),
      redirectUri: z.string(),
      scope: z.string(),
      state: z.string(),
      codeChallenge: z.string(),
      codeChallengeMethod: z.string(),
    }),
    output: z.boolean(),
  },
  openTwitterCompose: {
    input: z.object({ text: z.string().optional(), filePath: z.string().optional() }),
    output: z.boolean(),
  },
  openParentFolderOfFile: {
    input: z.object({ filePath: z.string() }),
    output: z.void(),
  },
  showItemInFolder: {
    input: z.object({ filePath: z.string() }),
    output: z.void(),
  },

  // Logs
  getLogs: {
    input: z.object({ query: z.string().optional() }),
    output: logsResponse,
  },
  getLogPath: {
    input: z.object({}),
    output: z.object({ logPath: z.string(), logDir: z.string() }),
  },
  openLogFolder: {
    input: z.object({}),
    output: z.boolean(),
  },

  // Paths
  getResourcePath: {
    input: z.object({}),
    output: z.string().nullable(),
  },
  getDownloadsPath: {
    input: z.object({}),
    output: z.string(),
  },
  getFreeDiskSpace: {
    input: z.object({ path: z.string() }),
    output: ipcResult({ bytes: z.number() }),
  },

  // Project assets
  addVisualAssetToProject: {
    input: z.object({ srcPath: z.string(), projectId: z.string(), type: z.enum(['video', 'image']) }),
    output: ipcResult({
      path: z.string(),
      bigThumbnailPath: z.string(),
      smallThumbnailPath: z.string(),
      width: z.number(),
      height: z.number(),
    }),
  },
  addGenericAssetToProject: {
    input: z.object({ srcPath: z.string(), projectId: z.string() }),
    output: ipcResult({ path: z.string() }),
  },
  makeThumbnailsForProjectAsset: {
    input: z.object({ path: z.string(), type: z.enum(['video', 'image']) }),
    output: ipcResult({
      bigThumbnailPath: z.string(),
      smallThumbnailPath: z.string(),
    }),
  },
  makeDimensionsForProjectAsset: {
    input: z.object({ path: z.string(), type: z.enum(['video', 'image']) }),
    output: ipcResult({
      width: z.number(),
      height: z.number(),
    }),
  },
  getProjectAssetsPath: {
    input: z.object({}),
    output: z.string(),
  },
  openProjectAssetsPathChangeDialog: {
    input: z.object({}),
    output: ipcResult({ path: z.string() }),
  },

  // On-disk copy of each project record (<project assets>/<id>/project.rix.json),
  // so projects survive localStorage being rolled back or wiped.
  saveProjectBackup: {
    input: z.object({ projectId: z.string(), data: z.string() }),
    output: emptyResult,
  },
  listProjectBackups: {
    input: z.object({}),
    output: z.array(z.object({
      projectId: z.string(),
      name: z.string(),
      updatedAt: z.number(),
      assetCount: z.number(),
    })),
  },
  listDeletedProjects: {
    input: z.object({}),
    output: z.array(z.object({ projectId: z.string(), deletedAt: z.number() })),
  },
  readProjectBackup: {
    input: z.object({ projectId: z.string() }),
    output: ipcResult({ data: z.string() }),
  },
  // Disk is the project store: everything on disk in one call at startup (newest
  // record per project, the saved list order, and delete tombstones).
  loadProjectStore: {
    input: z.object({}),
    output: z.object({
      ids: z.array(z.string()).nullable(),
      projects: z.array(z.object({ projectId: z.string(), data: z.string() })),
      deleted: z.array(z.object({ projectId: z.string(), deletedAt: z.number() })),
    }),
  },
  saveProjectIds: {
    input: z.object({ ids: z.array(z.string()) }),
    output: emptyResult,
  },
  deleteProjectBackup: {
    input: z.object({ projectId: z.string() }),
    output: emptyResult,
  },
  // Asks for a folder and copies every project's saved record into a dated
  // subfolder there (project files only, not media). Shows its own result dialog.
  backupAllProjects: {
    input: z.object({}),
    output: z.discriminatedUnion('status', [
      z.object({ status: z.literal('done'), count: z.number(), folder: z.string() }),
      z.object({ status: z.literal('cancelled') }),
      z.object({ status: z.literal('failed'), error: z.string() }),
    ]),
  },

  // File dialogs & save
  showSaveDialog: {
    input: z.object({
      title: z.string().optional(),
      defaultPath: z.string().optional(),
      filters: z.array(fileFilter).optional(),
    }),
    output: z.string().nullable(),
  },
  saveFile: {
    input: z.object({ filePath: z.string(), data: z.string(), encoding: z.string().optional() }),
    output: ipcResult({ path: z.string() }),
  },
  saveBinaryFile: {
    input: z.object({ filePath: z.string(), data: z.instanceof(ArrayBuffer) }),
    output: ipcResult({ path: z.string() }),
  },
  copyFileToPath: {
    input: z.object({ srcPath: z.string(), destPath: z.string() }),
    output: ipcResult({ path: z.string() }),
  },
  showOpenDirectoryDialog: {
    input: z.object({ title: z.string().optional() }),
    output: z.string().nullable(),
  },
  searchDirectoryForFiles: {
    input: z.object({ directory: z.string(), filenames: z.array(z.string()) }),
    output: z.record(z.string(), z.string()),
  },
  checkFilesExist: {
    input: z.object({ filePaths: z.array(z.string()) }),
    output: z.record(z.string(), z.boolean()),
  },
  showOpenFileDialog: {
    input: z.object({
      title: z.string().optional(),
      filters: z.array(fileFilter).optional(),
      properties: z.array(z.string()).optional(),
    }),
    output: z.array(z.string()).nullable(),
  },

  // Video export
  exportNative: {
    input: z.object({
      clips: z.array(exportClip),
      outputPath: z.string(),
      codec: z.string(),
      width: z.number(),
      height: z.number(),
      fps: z.number(),
      quality: z.number(),
      letterbox: z.object({ ratio: z.number(), color: z.string(), opacity: z.number() }).optional(),
      subtitles: z.array(exportSubtitle).optional(),
      textOverlays: z.array(exportTextOverlay).optional(),
      // 9:16 export: each visual clip is cropped to its reframe window before scaling.
      vertical: z.boolean().optional(),
    }),
    output: emptyResult,
  },
  exportCancel: {
    input: z.object({ sessionId: z.string() }),
    output: emptyResult,
  },

  // RiX MCP server status + the user's opt-in "Allow Claude to control the editor".
  mcpGetStatus: {
    input: z.object({}),
    output: z.object({
      enabled: z.boolean(),
      forcedOn: z.boolean(),
      running: z.boolean(),
      port: z.number(),
      lastClient: z.object({ name: z.string(), version: z.string().optional(), at: z.number() }).nullable(),
      lastRequestAt: z.number().nullable(),
    }),
  },
  mcpSetEnabled: {
    input: z.object({ enabled: z.boolean() }),
    output: emptyResult,
  },
  // "Connect Claude": is the user's Claude Code set up to drive this RiX install?
  claudeConnectStatus: {
    input: z.object({}),
    output: z.object({
      claudeFound: z.boolean(),
      mcpRegistered: z.boolean(),
      skillInstalled: z.boolean(),
      skillCurrent: z.boolean(),
    }),
  },
  // Registers the RiX tools with the user's Claude Code and installs the editing skill.
  claudeConnect: {
    input: z.object({ updateSkill: z.boolean().optional() }),
    output: ipcResult({ via: z.enum(['cli', 'config']), skill: z.enum(['installed', 'updated', 'kept', 'current']) }),
  },
  claudeDisconnect: {
    input: z.object({}),
    output: emptyResult,
  },
  // "Edit with Claude": open Claude Desktop's Code tab with this brief prefilled.
  openClaudeCode: {
    input: z.object({ prompt: z.string() }),
    output: emptyResult,
  },

  // RiX MCP server: the renderer's reply to an editor tool request (see onMcpEditorRequest).
  mcpEditorResponse: {
    input: z.object({ id: z.string(), ok: z.boolean(), result: z.unknown().optional(), error: z.string().optional() }),
    output: z.void(),
  },

  // Python setup
  checkPythonReady: {
    input: z.object({}),
    output: z.object({ ready: z.boolean() }),
  },
  startPythonSetup: {
    input: z.object({}),
    output: z.void(),
  },
  startPythonBackend: {
    input: z.object({}),
    output: z.void(),
  },
  getBackendHealthStatus: {
    input: z.object({}),
    output: backendHealthStatus.nullable(),
  },
  // Tells the liveness monitor a generation is known to be in flight, so it doesn't mistake a
  // long-running local generation (MPS/CUDA compute can starve the backend's own event loop for
  // tens of seconds, delaying /health) for a genuinely hung process and kill it mid-generation.
  notifyGenerationActive: {
    input: z.object({ active: z.boolean() }),
    output: z.void(),
  },

  // Preview playback of a reversed clip: renders (once, cached) a reversed copy of the
  // source so the editor can play it forward with sound. Preview only; export reverses
  // the original. `failed` leaves the clip on the old paused-frame behaviour.
  ensureReverseProxy: {
    input: z.object({ srcPath: z.string() }),
    output: z.discriminatedUnion('status', [
      z.object({ status: z.literal('ready'), path: z.string() }),
      z.object({ status: z.literal('failed'), error: z.string() }),
    ]),
  },

  // Video processing
  extractVideoFrame: {
    input: z.object({ videoPath: z.string(), seekTime: z.number(), width: z.number().optional(), quality: z.number().optional(), outputPath: z.string().optional() }),
    output: z.object({ path: z.string() }),
  },

  // A clip dropped on the prompt bar's start-frame slot: pull its opening frame
  // into a temp PNG the renderer can hand straight to the image input. Temp, not
  // Continuations — this is a scratch still for a re-roll, not a saved asset.
  extractVideoSeedFrame: {
    input: z.object({ videoPath: z.string() }),
    output: z.object({ path: z.string() }),
  },

  // "Continue as new shot": extract a clip's last frame into the Continuations
  // library folder to seed an i2v continuation; returns source dims/fps so the
  // next gen matches (clips must cut together cleanly on the timeline).
  continuationExtractLastFrame: {
    // seekTime present = "Continue from this frame" (enlarged-player scrub);
    // absent = the clip's last frame.
    input: z.object({ videoPath: z.string(), seekTime: z.number().optional() }),
    output: z.object({ framePath: z.string(), width: z.number(), height: z.number(), fps: z.number() }),
  },
  // Drop the duplicate lead frame from a freshly generated continuation and save
  // the clean clip into Continuations, ready to butt-join the source.
  continuationSaveTrimmed: {
    // colorMatchReference (the seed frame = the source clip's last frame) lets the
    // trim step neutralize the i2v VAE's systematic ~2-3/255 darkening of the
    // continuation, which otherwise compounds across chained continuations.
    input: z.object({ videoPath: z.string(), colorMatchReference: z.string().optional() }),
    output: z.object({ path: z.string() }),
  },
  // Reframe: crop an image/video to a region (source pixels), optionally scaling
  // the result to outWidth×outHeight. Writes to a temp file; the caller imports it
  // into the project like any other asset.
  reframeCrop: {
    input: z.object({
      srcPath: z.string(),
      type: z.enum(['image', 'video']),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      outWidth: z.number().optional(),
      outHeight: z.number().optional(),
      suffix: z.string(),
      // Videos only: animate the crop origin between these keys (source px, seconds).
      keyframes: z.array(z.object({ t: z.number(), x: z.number(), y: z.number() })).optional(),
    }),
    output: z.object({ path: z.string() }),
  },

  // Logging
  writeLog: {
    input: z.object({ level: z.string(), message: z.string() }),
    output: z.void(),
  },

  // Models
  openModelsDirChangeDialog: {
    input: z.object({}),
    output: ipcResult({ path: z.string() }),
  },
  openModelsFolder: {
    // No path argument by design — the main process resolves the configured models dir
    // from the backend so a renderer can't ask to open an arbitrary location.
    input: z.object({}),
    output: ipcResult({}),
  },

  // Analytics
  getAnalyticsState: {
    input: z.object({}),
    output: z.object({ analyticsEnabled: z.boolean(), installationId: z.string() }),
  },
  setAnalyticsEnabled: {
    input: z.object({ enabled: z.boolean() }),
    output: z.void(),
  },
  sendAnalyticsEvent: {
    input: z.object({ eventName: z.string(), extraDetails: z.record(z.string(), z.unknown()).nullable().optional() }),
    output: z.void(),
  },

  // Prompt Manager Pro — Downloads Browser (real-filesystem media library)
  gpmLibList: {
    input: z.object({}),
    output: z.object({
      root: z.string(),
      folders: z.array(z.string()),
      files: z.array(z.object({ folder: z.string(), name: z.string(), path: z.string(), isVideo: z.boolean(), isAudio: z.boolean(), mtimeMs: z.number() })),
    }),
  },
  gpmLibCreateFolder: { input: z.object({ name: z.string() }), output: emptyResult },
  gpmLibRenameFolder: { input: z.object({ from: z.string(), to: z.string() }), output: emptyResult },
  gpmLibDeleteFolder: { input: z.object({ name: z.string() }), output: emptyResult },
  // baseName: optional content-derived subject for auto-naming (e.g. "toy-robot"). When set,
  // each copied file lands as "<baseName>-NN.<ext>" sequenced per destination folder, instead
  // of keeping the source's hashed basename. Omitted = keep the original name (imports/drag-drop).
  gpmLibAddFiles: { input: z.object({ folder: z.string(), srcPaths: z.array(z.string()), baseName: z.string().optional() }), output: ipcResult({ added: z.number() }) },
  gpmLibMoveFile: { input: z.object({ fromFolder: z.string(), name: z.string(), toFolder: z.string() }), output: emptyResult },
  gpmLibDeleteFile: { input: z.object({ folder: z.string(), name: z.string() }), output: emptyResult },
  gpmLibReveal: { input: z.object({ folder: z.string().optional() }), output: emptyResult },
  gpmLibReadAsDataUrl: {
    input: z.object({ path: z.string() }),
    output: ipcResult({ dataUrl: z.string() }),
  },
  gpmLibGetRoot: { input: z.object({}), output: z.object({ root: z.string(), isDefault: z.boolean() }) },
  gpmLibChooseRoot: { input: z.object({}), output: z.object({ root: z.string().nullable() }) },
  gpmLibResetRoot: { input: z.object({}), output: z.object({ root: z.string() }) },
  // --- App updates ---
  getUpdateState: {
    input: z.object({}),
    output: updateStatePayload,
  },
  checkForUpdatesNow: {
    input: z.object({}),
    output: emptyResult,
  },
  startUpdateDownload: {
    input: z.object({}),
    output: emptyResult,
  },
  installUpdateAndRestart: {
    input: z.object({}),
    output: emptyResult,
  },
  skipUpdateVersion: {
    input: z.object({ version: z.string() }),
    output: emptyResult,
  },
  getAutoCheckUpdates: {
    input: z.object({}),
    output: z.object({ enabled: z.boolean() }),
  },
  setAutoCheckUpdates: {
    input: z.object({ enabled: z.boolean() }),
    output: emptyResult,
  },
} as const

type Schemas = typeof electronAPISchemas

type InvokeAPI = {
  [K in keyof Schemas]: z.infer<Schemas[K]['input']> extends Record<string, never>
    ? () => Promise<z.infer<Schemas[K]['output']>>
    : (input: z.infer<Schemas[K]['input']>) => Promise<z.infer<Schemas[K]['output']>>
}

/** Live video-export progress pushed from the main process while ffmpeg runs. */
export interface ExportProgress {
  /** 0–100, overall across the export's ffmpeg stages. */
  percent: number
  /** Human-readable current stage, e.g. "Encoding video", "Finalizing". */
  stage: string
  /** While the video is being rendered: how far into the program it is, and the program's length (seconds). */
  renderedSec?: number
  totalSec?: number
}

/** An editor tool call forwarded from the RiX MCP server; answered via mcpEditorResponse. */
export interface McpEditorRequest {
  id: string
  tool: string
  args: Record<string, unknown>
}

export type ElectronAPI = InvokeAPI & {
  onMcpEditorRequest: (cb: (req: McpEditorRequest) => void) => (() => void)
  onPythonSetupProgress: (cb: (data: unknown) => void) => void
  removePythonSetupProgress: () => void
  onBackendHealthStatus: (cb: (data: BackendHealthStatus) => void) => (() => void)
  onExportProgress: (cb: (data: ExportProgress) => void) => (() => void)
  onMenuAction: (cb: (action: string) => void) => (() => void)
  /** Fires (debounced) when the Studio Assets library folder changes on disk. */
  onGpmLibChanged: (cb: () => void) => (() => void)
  onUpdateEvent: (cb: (data: UpdateStatePayload) => void) => (() => void)
  getPathForFile: (file: File) => string
  platform: string
}
