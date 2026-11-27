import type { ReactNode } from 'react'
import { ChevronUp } from 'lucide-react'
import { SettingsDropdown } from './SettingsDropdown'
import type { IcLoraControlsProps } from './IcLoraSettingsControls'
import type { IcLoraAudioMode } from '../hooks/use-ic-lora'

// One labelled row: caption on the left, the dropdown on the right, a short explanation below.
function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="pb-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-zinc-500 uppercase tracking-wide shrink-0 px-1">{label}</span>
        {children}
      </div>
      <p className="px-1 text-[10px] leading-snug text-zinc-500">{hint}</p>
    </div>
  )
}

const triggerValue = (text: string) => (
  <>
    <span className="text-zinc-300 font-medium">{text}</span>
    <ChevronUp className="h-3 w-3 text-zinc-500" />
  </>
)

// Advanced IC-LoRA controls, in a side panel beside the prompt bar (so they don't push the
// Generate button off the bottom row). Reuses the shared IcLoraControlsProps bag.
export function IcLoraAdvancedPanel({
  icLoraSkipStage2,
  onIcLoraSkipStage2Change,
  icLoraUseLoraInStage2,
  onIcLoraUseLoraInStage2Change,
  icLoraResolutionOptions,
  icLoraResolutionKey,
  onIcLoraResolutionKeyChange,
  icLoraResolutionFactor,
  onIcLoraResolutionFactorChange,
  icLoraAudioMode,
  onIcLoraAudioModeChange,
  icLoraFps,
  onIcLoraFpsChange,
  advancedIcLoraControls,
  isCatalogIcLora,
  icLoraSourceAudioAvailable,
}: IcLoraControlsProps) {
  // Advanced-only knobs. (LoRA strength is a regular control — it lives in the bottom bar.)
  if (!advancedIcLoraControls) return null
  // Only settings that change a run are shown: "source" audio needs a video input, and catalog
  // IC-LoRAs ignore the FPS override.
  const audioMode = icLoraAudioMode === 'source' && !icLoraSourceAudioAvailable ? 'generated' : (icLoraAudioMode ?? 'generated')
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/90 backdrop-blur p-1.5 flex flex-col gap-0.5 w-52 text-xs">
      <span className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider px-1">Advanced</span>

      <Row label="Stage 2" hint="A second pass that enlarges and refines. Slower.">
            <SettingsDropdown
              title="STAGE 2 REFINE"
              value={icLoraSkipStage2 ? 'skip' : 'keep'}
              onChange={(v) => onIcLoraSkipStage2Change?.(v === 'skip')}
              options={[
                { value: 'keep', label: 'On (two-stage)' },
                { value: 'skip', label: 'Off (stage 1 only)' },
              ]}
              trigger={triggerValue(icLoraSkipStage2 ? 'Off' : 'On')}
            />
          </Row>
          {/* Only does anything when Stage 2 runs. */}
          {!icLoraSkipStage2 && (
            <Row label="LoRA in S2" hint="Keeps the IC-LoRA guiding the second pass. Uses more memory.">
              <SettingsDropdown
                title="IC-LORA IN STAGE 2"
                value={icLoraUseLoraInStage2 ? 'on' : 'off'}
                onChange={(v) => onIcLoraUseLoraInStage2Change?.(v === 'on')}
                options={[
                  { value: 'off', label: 'Off (refine from prompt)' },
                  { value: 'on', label: 'On (keep effect, source res)' },
                ]}
                trigger={triggerValue(icLoraUseLoraInStage2 ? 'On' : 'Off')}
              />
            </Row>
          )}
          {!icLoraSkipStage2 && icLoraUseLoraInStage2 && (icLoraResolutionOptions?.length ?? 0) > 1 && (
            <Row label="Res" hint="Output size, never larger than the input.">
              <SettingsDropdown
                title="RESOLUTION"
                value={icLoraResolutionKey ?? 'original'}
                onChange={(v) => onIcLoraResolutionKeyChange?.(v)}
                options={icLoraResolutionOptions!.map((o) => ({ value: o.key, label: o.label }))}
                trigger={triggerValue(
                  (icLoraResolutionOptions!.find((o) => o.key === icLoraResolutionKey)?.label ?? 'Original').split(' ')[0],
                )}
              />
            </Row>
          )}
          {icLoraSkipStage2 && (
            <Row label="Res" hint="Video size. ×2.00 is standard. Source matches the input and can need much more memory.">
              <SettingsDropdown
                title="RES FACTOR"
                value={String(icLoraResolutionFactor ?? 2.0)}
                onChange={(v) => onIcLoraResolutionFactorChange?.(parseFloat(v))}
                options={[
                  // 0 is the "source dimensions" sentinel — output matches the input
                  // resolution and the multiplier is ignored (see ic_lora_handler).
                  { value: '0', label: 'Source dimensions' },
                  { value: '1', label: '1.00 (half)' },
                  { value: '1.25', label: '1.25' },
                  { value: '1.5', label: '1.50' },
                  { value: '1.75', label: '1.75' },
                  { value: '2', label: '2.00 (native)' },
                ]}
                trigger={triggerValue(
                  icLoraResolutionFactor === 0 ? 'Source' : `×${(icLoraResolutionFactor ?? 2.0).toFixed(2)}`,
                )}
              />
            </Row>
          )}
          <Row
            label="Audio"
            hint={icLoraSourceAudioAvailable
              ? 'Generated by the model, the input video\'s own sound, or silent.'
              : 'Sound and speech made by the model, or silent.'}
          >
            <SettingsDropdown
              title="AUDIO"
              value={audioMode}
              onChange={(v) => onIcLoraAudioModeChange?.(v as IcLoraAudioMode)}
              options={[
                { value: 'generated', label: 'Generated' },
                ...(icLoraSourceAudioAvailable ? [{ value: 'source', label: 'Source' }] : []),
                { value: 'off', label: 'Off' },
              ]}
              trigger={triggerValue(audioMode.replace(/^\w/, (c: string) => c.toUpperCase()))}
            />
          </Row>
          {!isCatalogIcLora && (
            <Row label="FPS" hint="Lower means fewer frames: faster, but choppier.">
              <SettingsDropdown
                title="FPS"
                value={icLoraFps == null ? 'source' : String(icLoraFps)}
                onChange={(v) => onIcLoraFpsChange?.(v === 'source' ? null : parseFloat(v))}
                options={[
                  { value: 'source', label: 'Source' },
                  { value: '24', label: '24 fps' },
                  { value: '16', label: '16 fps' },
                  { value: '12', label: '12 fps' },
                  { value: '8', label: '8 fps' },
                ]}
                trigger={triggerValue(icLoraFps == null ? 'Src' : String(icLoraFps))}
              />
            </Row>
          )}
    </div>
  )
}
