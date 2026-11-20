/**
 * gpm-core / renderer
 *
 * PURE module. Mirrors the backend `/api/generate` contract (FastAPI
 * `GenerateVideoRequest` / `GenerateVideoResponse` in `backend/api_types.py`)
 * and maps a composed prompt + optional source frame into a request.
 *
 * The module never reaches "up" into the app: it performs no I/O itself.
 * Transport is INJECTED by the frontend (which wires `backendFetch` in a later
 * phase), so gpm-core stays free of DOM, storage and React.
 */

// ---- Contract value types (mirror of api_types.py) --------------------------

export type LtxResolution = "540p" | "720p" | "1080p" | "1440p" | "2160p";
export type LtxDuration = 5 | 6 | 8 | 10 | 12 | 14 | 15 | 16 | 18 | 20;
export type LtxFps = 24 | 25 | 48 | 50;
export type LtxPipeline = "fast" | "pro";
export type LtxAspectRatio = "16:9" | "9:16";
export type VideoCameraMotion =
  | "none"
  | "dolly_in"
  | "dolly_out"
  | "dolly_left"
  | "dolly_right"
  | "jib_up"
  | "jib_down"
  | "static"
  | "focus_shift";

/** POST /api/generate body. Only `prompt` is required; the backend supplies
 *  defaults for every other field. */
export interface GenerateVideoRequest {
  prompt: string;
  resolution?: LtxResolution;
  model?: LtxPipeline;
  cameraMotion?: VideoCameraMotion;
  negativePrompt?: string;
  duration?: LtxDuration;
  fps?: LtxFps;
  audio?: boolean;
  imagePath?: string | null;
  audioPath?: string | null;
  aspectRatio?: LtxAspectRatio;
}

export interface GenerateVideoCompleteResponse {
  status: "complete";
  video_path: string;
}
export interface GenerateVideoCancelledResponse {
  status: "cancelled";
}
export type GenerateVideoResponse = GenerateVideoCompleteResponse | GenerateVideoCancelledResponse;

/** 402 body when LTX API credits are insufficient. */
export interface LtxInsufficientFundsError {
  code: "LTX_INSUFFICIENT_FUNDS";
  message: string;
}

/** GET /api/generation/progress. */
export interface GenerationProgressResponse {
  status: "idle" | "running" | "complete" | "cancelled" | "error";
  phase: string;
  progress: number;
  currentStep: number | null;
  totalSteps: number | null;
}

export interface CancelResponse {
  status: string;
}

// ---- Transports (injected by the frontend) ----------------------------------

export type GenerateTransport = (req: GenerateVideoRequest) => Promise<GenerateVideoResponse>;
export type ProgressTransport = () => Promise<GenerationProgressResponse>;
export type CancelTransport = () => Promise<CancelResponse>;

// ---- Request building -------------------------------------------------------

/** Options for composing a single shot's generation request. */
export interface RenderShotOptions {
  /** The composed prompt (e.g. from assemblePerformance / buildShotPrompt). */
  prompt: string;
  /** Existing frame to re-generate in place (image-to-video). */
  imagePath?: string | null;
  resolution?: LtxResolution;
  model?: LtxPipeline;
  cameraMotion?: VideoCameraMotion;
  negativePrompt?: string;
  duration?: LtxDuration;
  fps?: LtxFps;
  audio?: boolean;
  audioPath?: string | null;
  aspectRatio?: LtxAspectRatio;
}

/**
 * Build a `GenerateVideoRequest` from render options, omitting unspecified
 * fields so the backend applies its own defaults.
 */
export function buildGenerateRequest(opts: RenderShotOptions): GenerateVideoRequest {
  const req: GenerateVideoRequest = { prompt: opts.prompt };
  if (opts.resolution !== undefined) req.resolution = opts.resolution;
  if (opts.model !== undefined) req.model = opts.model;
  if (opts.cameraMotion !== undefined) req.cameraMotion = opts.cameraMotion;
  if (opts.negativePrompt !== undefined) req.negativePrompt = opts.negativePrompt;
  if (opts.duration !== undefined) req.duration = opts.duration;
  if (opts.fps !== undefined) req.fps = opts.fps;
  if (opts.audio !== undefined) req.audio = opts.audio;
  if (opts.imagePath !== undefined) req.imagePath = opts.imagePath;
  if (opts.audioPath !== undefined) req.audioPath = opts.audioPath;
  if (opts.aspectRatio !== undefined) req.aspectRatio = opts.aspectRatio;
  return req;
}

/**
 * Render a shot by handing a built request to the injected transport.
 * The caller (frontend) provides the transport, typically backed by
 * `backendFetch` against POST /api/generate.
 */
export function renderShot(
  transport: GenerateTransport,
  opts: RenderShotOptions,
): Promise<GenerateVideoResponse> {
  return transport(buildGenerateRequest(opts));
}
