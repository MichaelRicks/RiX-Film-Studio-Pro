import { DEFAULT_DUCK_AMOUNT_DB } from '../../../shared/music-ducking'

/** Drag type for a song dragged from the MUSIC tab onto the timeline. Lower-case on
 *  purpose: the browser lower-cases custom drag types. */
export const MUSIC_DND = 'application/x-rix-music'

/** Tracks made for music are named "Music", "Music 2", ... */
export const isMusicTrackName = (name: string): boolean => /^Music( \d+)?$/.test(name)

export interface MusicDragPayload { path: string; title: string; beats?: number[] }

const AUTO_DUCK_KEY = 'rix.music.autoDuck'

/** Whether music added from the MUSIC tab starts out ducking under dialogue. On unless turned off. */
export function getAutoDuckDefault(): boolean {
  try { return localStorage.getItem(AUTO_DUCK_KEY) !== 'off' } catch { return true }
}

export function setAutoDuckDefault(on: boolean): void {
  try { localStorage.setItem(AUTO_DUCK_KEY, on ? 'on' : 'off') } catch { /* storage unavailable */ }
}

const FIT_KEY = 'rix.music.fit'

/** Whether music added from the MUSIC tab is cut to end where the picture ends. On unless turned off. */
export function getFitDefault(): boolean {
  try { return localStorage.getItem(FIT_KEY) !== 'off' } catch { return true }
}

export function setFitDefault(on: boolean): void {
  try { localStorage.setItem(FIT_KEY, on ? 'on' : 'off') } catch { /* storage unavailable */ }
}

/** The `duck` setting a newly added music clip gets, or undefined when the default is off. */
export function defaultMusicDuck(): { enabled: boolean; amountDb: number } | undefined {
  return getAutoDuckDefault() ? { enabled: true, amountDb: DEFAULT_DUCK_AMOUNT_DB } : undefined
}
