import { z } from 'zod'
import { clampKeyframeStrength } from '../lib/keyframe-strength.ts'

export const generationModeValues = [
  'text-to-video',
  'image-to-video',
  'audio-to-video',
  'multi-keyframe',
  'text-to-image',
  'image-edit',
  'retake',
  'extend',
  'ic-lora',
  // A crop of another asset (Reframe 9:16) — not regenerable, but listed in the gallery.
  'reframe',
] as const

export const assetTypeValues = ['image', 'video', 'audio', 'adjustment'] as const
export const timelineClipTypeValues = [...assetTypeValues, 'text'] as const
export const transitionTypeValues = [
  'none',
  'dissolve',
  'fade-to-black',
  'fade-to-white',
  'wipe-left',
  'wipe-right',
  'wipe-up',
  'wipe-down',
] as const
export const trackTypeValues = ['default', 'subtitle'] as const
export const trackKindValues = ['video', 'audio'] as const
export const subtitlePositionValues = ['bottom', 'top', 'center'] as const
export const fontWeightValues = ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const
export const fontStyleValues = ['normal', 'italic'] as const
export const textAlignValues = ['left', 'center', 'right'] as const
export const effectTypeValues = [
  'blur',
  'sharpen',
  'glow',
  'vignette',
  'grain',
  'lut-cinematic',
  'lut-vintage',
  'lut-bw',
  'lut-cool',
  'lut-warm',
  'lut-muted',
  'lut-vivid',
] as const
export const effectMaskShapeValues = ['rectangle', 'ellipse'] as const
export const letterboxAspectRatioValues = ['2.35:1', '2.39:1', '2.76:1', '1.85:1', '4:3', 'custom'] as const
export const viewTypeValues = ['home', 'project'] as const
export const projectTabValues = ['gen-space', 'video-editor'] as const

export const transitionTypeSchema = z.enum(transitionTypeValues)
export const viewTypeSchema = z.enum(viewTypeValues)
export const projectTabSchema = z.enum(projectTabValues)

export const persistedKeyframeSchema = z.object({
  path: z.string(),
  frameIndex: z.number(),
  // Missing on #154 assets. Out of range is clamped so a bad float cannot fail the project.
  strength: z.unknown().optional().transform(clampKeyframeStrength),
})

export const generationParamsSchema = z.object({
  mode: z.enum(generationModeValues),
  prompt: z.string(),
  model: z.string(),
  // Local pipeline ids ("fast") are shared across LTX versions, so `model` alone can't say
  // which version produced the asset. Captured at generation time from the backend spec's
  // display name; absent on assets written before this existed.
  modelLabel: z.string().optional(),
  // Seed the backend actually used (local + FAL image gens). Absent on older assets / LTX API.
  seed: z.number().optional(),
  duration: z.number().nullable(),
  resolution: z.string(),
  fps: z.number(),
  audio: z.boolean(),
  cameraMotion: z.string(),
  imageAspectRatio: z.string().optional(),
  imageSteps: z.number().optional(),
  imageEditStrength: z.number().optional(),
  // Variation boost (0-1) used for a local text-to-image gen; absent = 0 / older assets.
  imageVariation: z.number().optional(),
  inputImageUrl: z.string().optional(),
  inputLastImageUrl: z.string().optional(),
  inputAudioUrl: z.string().optional(),
  keyframes: z.array(persistedKeyframeSchema).optional(),
  retakeVideoPath: z.string().optional(),
  retakeStartTime: z.number().optional(),
  retakeDuration: z.number().optional(),
  retakeMode: z.string().optional(),
  extendVideoPath: z.string().optional(),
  extendDuration: z.number().optional(),
  extendDirection: z.string().optional(),
  icLoraVideoPath: z.string().optional(),
  icLoraConditioningType: z.string().optional(),
  icLoraConditioningStrength: z.number().optional(),
  loras: z.array(z.object({
    ref: z.string(),
    name: z.string(),
    scale: z.number(),
  })).optional(),
})

export const assetTakeSchema = z.object({
  path: z.string(),
  bigThumbnailPath: z.string().optional(),
  smallThumbnailPath: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  createdAt: z.number(),
})

export const subtitleStyleSchema = z.object({
  fontSize: z.number(),
  fontFamily: z.string(),
  fontWeight: z.enum(['normal', 'bold']),
  color: z.string(),
  backgroundColor: z.string(),
  position: z.enum(subtitlePositionValues),
  italic: z.boolean(),
})

export const DEFAULT_SUBTITLE_STYLE = subtitleStyleSchema.parse({
  fontSize: 32,
  fontFamily: 'sans-serif',
  fontWeight: 'normal',
  color: '#FFFFFF',
  backgroundColor: 'transparent',
  position: 'bottom',
  italic: false,
})

export const trackSchema = z.object({
  id: z.string(),
  name: z.string(),
  muted: z.boolean(),
  locked: z.boolean(),
  solo: z.boolean().optional(),
  enabled: z.boolean().optional(),
  sourcePatched: z.boolean().optional(),
  type: z.enum(trackTypeValues).optional(),
  kind: z.enum(trackKindValues).optional(),
  subtitleStyle: subtitleStyleSchema.partial().optional(),
})

// New timelines start with just one video + one audio track (pre-selected as
// the drop target via sourcePatched) — most projects never need more, and
// starting with extras pushed the first clip down where it required vertical
// scrolling to even see. Users can add more tracks with one click as needed.
export const DEFAULT_TRACKS = trackSchema.array().parse([
  { id: 'track-v1', name: 'V1', muted: false, locked: false, sourcePatched: true, kind: 'video' },
  { id: 'track-a1', name: 'A1', muted: false, locked: false, sourcePatched: true, kind: 'audio' },
])

export const subtitleClipSchema = z.object({
  id: z.string(),
  text: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  trackIndex: z.number(),
  style: subtitleStyleSchema.partial().optional(),
})

export const clipTransitionSchema = z.object({
  type: transitionTypeSchema,
  duration: z.number(),
})

export const DEFAULT_CLIP_TRANSITION = clipTransitionSchema.parse({
  type: 'none',
  duration: 0.5,
})

export const colorCorrectionSchema = z.object({
  brightness: z.number(),
  contrast: z.number(),
  saturation: z.number(),
  temperature: z.number(),
  tint: z.number(),
  exposure: z.number(),
  highlights: z.number(),
  shadows: z.number(),
})

export const DEFAULT_COLOR_CORRECTION = colorCorrectionSchema.parse({
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  exposure: 0,
  highlights: 0,
  shadows: 0,
})

export const letterboxSettingsSchema = z.object({
  enabled: z.boolean(),
  aspectRatio: z.enum(letterboxAspectRatioValues),
  customRatio: z.number().optional(),
  color: z.string(),
  opacity: z.number(),
})

export const DEFAULT_LETTERBOX = letterboxSettingsSchema.parse({
  enabled: false,
  aspectRatio: '2.35:1',
  color: '#000000',
  opacity: 100,
})

export const effectMaskSchema = z.object({
  enabled: z.boolean(),
  shape: z.enum(effectMaskShapeValues),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  feather: z.number(),
  invert: z.boolean(),
  rotation: z.number(),
})

export const DEFAULT_EFFECT_MASK = effectMaskSchema.parse({
  enabled: false,
  shape: 'ellipse',
  x: 50,
  y: 50,
  width: 40,
  height: 40,
  feather: 20,
  invert: false,
  rotation: 0,
})

export const clipEffectSchema = z.object({
  id: z.string(),
  type: z.enum(effectTypeValues),
  enabled: z.boolean(),
  params: z.record(z.string(), z.number()),
  mask: effectMaskSchema.optional(),
})

export const textOverlayStyleSchema = z.object({
  text: z.string(),
  fontFamily: z.string(),
  fontSize: z.number(),
  fontWeight: z.enum(fontWeightValues),
  fontStyle: z.enum(fontStyleValues),
  color: z.string(),
  backgroundColor: z.string(),
  textAlign: z.enum(textAlignValues),
  positionX: z.number(),
  positionY: z.number(),
  strokeColor: z.string(),
  strokeWidth: z.number(),
  shadowColor: z.string(),
  shadowBlur: z.number(),
  shadowOffsetX: z.number(),
  shadowOffsetY: z.number(),
  letterSpacing: z.number(),
  lineHeight: z.number(),
  maxWidth: z.number(),
  padding: z.number(),
  borderRadius: z.number(),
  opacity: z.number(),
  // Non-uniform stretch from the preview's edge handles (1 = none). Uniform
  // (corner-handle) resizing changes fontSize instead, so text stays crisp.
  scaleX: z.number().optional(),
  scaleY: z.number().optional(),
})

export const DEFAULT_TEXT_STYLE = textOverlayStyleSchema.parse({
  text: 'Title Text',
  fontFamily: 'Inter, Arial, sans-serif',
  fontSize: 64,
  fontWeight: 'bold',
  fontStyle: 'normal',
  color: '#FFFFFF',
  backgroundColor: 'transparent',
  textAlign: 'center',
  positionX: 50,
  positionY: 50,
  strokeColor: 'transparent',
  strokeWidth: 0,
  shadowColor: 'rgba(0,0,0,0.5)',
  shadowBlur: 4,
  shadowOffsetX: 2,
  shadowOffsetY: 2,
  letterSpacing: 0,
  lineHeight: 1.2,
  maxWidth: 80,
  padding: 0,
  borderRadius: 0,
  opacity: 100,
})

export const assetSchema = z.object({
  id: z.string(),
  type: z.enum(assetTypeValues),
  path: z.string(),
  bigThumbnailPath: z.string().optional(),
  smallThumbnailPath: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  prompt: z.string(),
  resolution: z.string(),
  duration: z.number().optional(),
  createdAt: z.number(),
  favorite: z.boolean().optional(),
  binId: z.string().optional(),
  generationParams: generationParamsSchema.optional(),
  takes: z.array(assetTakeSchema).optional(),
  activeTakeIndex: z.number().optional(),
  colorLabel: z.string().optional(),
  // Wall-clock time the render took, in milliseconds (local generations only).
  renderMs: z.number().optional(),
})

/** Where a media clip sits in the frame and how big it is. `x`/`y` are the
 *  layer's CENTER as a fraction of frame width/height (0.5/0.5 = centered);
 *  `scaleX`/`scaleY` multiply the size it would fill the frame at (1 = unchanged).
 *  Chosen so the same numbers drive a CSS transform and ffmpeg's scale/overlay
 *  without conversion. */
export const clipLayerFrameSchema = z.object({
  x: z.number(),
  y: z.number(),
  scaleX: z.number(),
  scaleY: z.number(),
})

export const clipLayerSchema = clipLayerFrameSchema.extend({
  /** Keys are eased with smoothstep, like reframe. `t` = seconds from clip start. */
  keys: z.array(clipLayerFrameSchema.extend({ t: z.number() })).optional(),
})

export const DEFAULT_CLIP_LAYER: ClipLayerFrame = { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1 }

export const timelineClipSchema = z.object({
  id: z.string(),
  assetId: z.string().nullable(),
  type: z.enum(timelineClipTypeValues),
  startTime: z.number(),
  duration: z.number(),
  trimStart: z.number(),
  trimEnd: z.number(),
  speed: z.number().default(1),
  reversed: z.boolean().default(false),
  muted: z.boolean().default(false),
  volume: z.number().default(1),
  audioFadeIn: z.number().optional(),
  audioFadeOut: z.number().optional(),
  // Volume automation: piecewise-linear gain envelope, t = seconds from clip
  // start, value = 0..2. When present + non-empty, replaces the flat `volume`
  // as the base gain (the fade envelope still multiplies on top).
  volumeKeyframes: z.array(z.object({ t: z.number(), value: z.number() })).optional(),
  // Vertical (9:16) export framing — where the 9:16 window sits across the
  // frame's free axis (0 = left/top, 1 = right/bottom; unset = centered),
  // optionally keyframed. Key `t` = SOURCE seconds for video (so trims don't
  // slide the keys), clip-local seconds for images. Ignored by 16:9 exports.
  reframe: z.object({
    pos: z.number(),
    keys: z.array(z.object({ t: z.number(), pos: z.number() })).optional(),
  }).optional(),
  // Text-overlay opacity fade in/out (seconds). Unset = the 0.5s default (a soft
  // in/out is almost always wanted); set 0 explicitly for a hard cut.
  textFadeIn: z.number().optional(),
  textFadeOut: z.number().optional(),
  // The same, for a media clip acting as a layer: a logo that pops on and off is
  // almost never what's wanted, and keyframing every one by hand is tedious. Unset
  // = the 0.5s default, 0 = a hard cut. Ignored while the clip still fills the
  // frame — a full-frame shot must not fade up from nothing.
  fadeIn: z.number().optional(),
  fadeOut: z.number().optional(),
  // Opacity automation: t = seconds from clip start, value 0..100. When present +
  // non-empty it replaces the clip's base opacity — textStyle.opacity for text
  // clips, `opacity` for video/image (linear between keys; a text clip's fade
  // in/out still multiplies on top).
  opacityKeyframes: z.array(z.object({ t: z.number(), value: z.number() })).optional(),
  trackIndex: z.number(),
  asset: assetSchema.nullable(),
  importedName: z.string().optional(),
  flipH: z.boolean().default(false),
  flipV: z.boolean().default(false),
  transitionIn: clipTransitionSchema.default(DEFAULT_CLIP_TRANSITION),
  transitionOut: clipTransitionSchema.default(DEFAULT_CLIP_TRANSITION),
  colorCorrection: colorCorrectionSchema.default(DEFAULT_COLOR_CORRECTION),
  // Curated film look (shared/film-looks.ts), applied BEFORE the manual color
  // correction above. Only the preset id and intensity are stored, so the recipe
  // stays in one place for the preview and the export to read.
  filmLook: z.object({ presetId: z.string(), intensity: z.number() }).optional(),
  opacity: z.number().default(100),
  takeIndex: z.number().optional(),
  isRegenerating: z.boolean().optional(),
  linkedClipIds: z.array(z.string()).optional(),
  colorLabel: z.string().optional(),
  effects: z.array(clipEffectSchema).optional(),
  letterbox: letterboxSettingsSchema.optional(),
  textStyle: textOverlayStyleSchema.optional(),
  // Graphic/logo placement for a video or image clip: where it sits in the frame
  // and how big it is, optionally keyframed. Absent = fills the frame as it always
  // has. See clipLayerAt() in video-editor-utils for sampling.
  layer: clipLayerSchema.optional(),
  // Composite over the tracks below instead of replacing them. Set automatically
  // the first time a clip is transformed or faded; also settable on its own, for a
  // full-frame logo with an alpha channel that needs no resizing. Unset keeps the
  // NLE default, where the highest track wins outright.
  composite: z.boolean().optional(),
})

export const timelineSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  tracks: z.array(trackSchema),
  clips: z.array(timelineClipSchema),
  subtitles: z.array(subtitleClipSchema).default([]),
  inPoint: z.number().nullable().optional(),
  outPoint: z.number().nullable().optional(),
  // Seconds the user has set the timeline to run to. Never shorter than the content.
  length: z.number().positive().optional(),
})

export const assetBinsSchema = z.record(z.string(), z.string())

export const projectV2Schema = z.object({
  version: z.literal(2),
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  bins: assetBinsSchema,
  assets: z.array(assetSchema),
  timelines: z.array(timelineSchema),
  activeTimelineId: z.string().optional(),
})

const assetV1Schema = assetSchema
  .omit({ binId: true })
  .extend({
    bin: z.string().optional(),
  })

export const projectV1Schema = projectV2Schema
  .omit({ version: true, bins: true, assets: true, timelines: true })
  .extend({
    version: z.undefined().optional(),
    bins: z.undefined().optional(),
    assets: z.array(assetV1Schema),
    timelines: z.array(timelineSchema).optional(),
  })

export const projectSchema = projectV2Schema

export const projectReferenceSchema = z.object({
  id: z.string(),
})

const projectVersionSchema = z.object({
  version: z.unknown().optional(),
})

export type GenerationParams = z.infer<typeof generationParamsSchema>
export type AssetTake = z.infer<typeof assetTakeSchema>
export type Asset = z.infer<typeof assetSchema>
export type Track = z.infer<typeof trackSchema>
export type SubtitleStyle = z.infer<typeof subtitleStyleSchema>
export type SubtitleClip = z.infer<typeof subtitleClipSchema>
export type TransitionType = z.infer<typeof transitionTypeSchema>
export type ClipTransition = z.infer<typeof clipTransitionSchema>
export type ColorCorrection = z.infer<typeof colorCorrectionSchema>
export type LetterboxSettings = z.infer<typeof letterboxSettingsSchema>
export type EffectMask = z.infer<typeof effectMaskSchema>
export type EffectType = z.infer<typeof clipEffectSchema.shape.type>
export type ClipEffect = z.infer<typeof clipEffectSchema>
export type TextOverlayStyle = z.infer<typeof textOverlayStyleSchema>
export type ClipLayerFrame = z.infer<typeof clipLayerFrameSchema>
export type ClipLayer = z.infer<typeof clipLayerSchema>
export type ClipLayerKey = NonNullable<ClipLayer['keys']>[number]
export type TimelineClip = z.infer<typeof timelineClipSchema>
export type Timeline = z.infer<typeof timelineSchema>
export type AssetBins = z.infer<typeof assetBinsSchema>
export type ProjectV1 = z.infer<typeof projectV1Schema>
export type ProjectV2 = z.infer<typeof projectV2Schema>
export type Project = ProjectV2
export type ViewType = z.infer<typeof viewTypeSchema>
export type ProjectTab = z.infer<typeof projectTabSchema>

export function createAssetBinId(): string {
  return `bin-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`
}

export function createDefaultTimeline(name: string = 'Timeline 1'): Timeline {
  return {
    id: `timeline-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    name,
    createdAt: Date.now(),
    tracks: DEFAULT_TRACKS.map(track => ({ ...track })),
    clips: [],
    subtitles: [],
  }
}

function normalizeLegacyBinName(bin: string | undefined): string | null {
  const normalized = bin?.trim()
  return normalized ? normalized : null
}

function migrateProjectV1ToV2(project: ProjectV1): ProjectV2 {
  const bins = Object.fromEntries(
    Array.from(new Set(project.assets.flatMap(asset => {
      const binName = normalizeLegacyBinName(asset.bin)
      return binName ? [binName] : []
    }))).map(binName => [createAssetBinId(), binName]),
  )
  const binNameToId = new Map<string, string>(
    Object.entries(bins).map(([binId, binName]) => [binName, binId]),
  )

  return projectV2Schema.parse({
    ...project,
    version: 2,
    bins,
    assets: project.assets.map(({ bin, ...asset }) => {
      const binName = normalizeLegacyBinName(bin)
      const binId = binName ? binNameToId.get(binName) : undefined
      return binId ? { ...asset, binId } : asset
    }),
    timelines: project.timelines ?? [createDefaultTimeline('Timeline 1')],
    activeTimelineId: project.timelines ? project.activeTimelineId : undefined,
  })
}

export function migrateProjectData(projectData: unknown): { project: Project; migrated: boolean } {
  const { version } = projectVersionSchema.parse(projectData)

  if (version === undefined) {
    return {
      project: migrateProjectV1ToV2(projectV1Schema.parse(projectData)),
      migrated: true,
    }
  }

  if (version === 2) {
    return {
      project: projectV2Schema.parse(projectData),
      migrated: false,
    }
  }

  throw new Error(`Unsupported project version: ${String(version)}`)
}

export function normalizeProject(projectData: unknown): Project {
  return migrateProjectData(projectData).project
}
