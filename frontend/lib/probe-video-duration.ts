/** Real duration of a video file (seconds), or undefined if it can't be read. The length that
 *  was requested is not it: auto-duration clips and trimmed outputs differ. */
export function probeVideoDuration(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => resolve(Number.isFinite(v.duration) && v.duration > 0 ? v.duration : undefined)
    v.onerror = () => resolve(undefined)
    v.src = url
  })
}
