"""Keep a music folder's catalogue.json in step with the audio files in it.

usage (from the repo root, with the backend's Python):
  backend/.venv/Scripts/python.exe -I scripts/music/update-catalogue.py "<music folder>" [--force] [--ffmpeg <path>]

For every MP3/WAV in the folder it measures the length, the tempo and the beat positions and
writes them into catalogue.json. Songs already in the catalogue keep their title, genre, mood
and the rest; only the measured fields (seconds, bpm, beats) are filled in. A song with no entry
yet gets one with its filename as the title and genre "Other", for you to edit. Songs already
measured are skipped unless --force.

Beats come from an onset-strength envelope and the dynamic-programming beat tracker of Ellis
(2007): it finds the tempo, then the chain of beats that best lines up with the onsets while
staying near that tempo. It follows slow drifts in tempo but is a rough guide, good to a few
hundredths of a second on steady music; it does not find downbeats (which beat starts a bar).
"""
import json
import pathlib
import subprocess
import sys

import numpy as np

SR = 22050
HOP = 256
N_FFT = 1024
AUDIO_EXT = {'.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac'}


def find_ffmpeg(arg):
    if arg:
        return arg
    root = pathlib.Path(__file__).resolve().parents[2]
    hits = sorted((root / 'backend' / '.venv' / 'Lib' / 'site-packages' / 'imageio_ffmpeg' / 'binaries').glob('ffmpeg-*'))
    return str(hits[0]) if hits else 'ffmpeg'


def decode(ffmpeg, path):
    raw = subprocess.run(
        [ffmpeg, '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
        capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32)


def band_flux(y):
    """Log-spectral flux per frequency band: (low, all). `low` is the bass band (kick, bass line)."""
    frames = 1 + (len(y) - N_FFT) // HOP
    idx = np.arange(N_FFT)[None, :] + HOP * np.arange(frames)[:, None]
    spec = np.abs(np.fft.rfft(y[idx] * np.hanning(N_FFT).astype(np.float32), axis=1))
    freqs = np.fft.rfftfreq(N_FFT, 1 / SR)
    flux = np.maximum(0, np.diff(np.log1p(10.0 * spec), axis=0))
    flux = np.vstack([np.zeros((1, flux.shape[1])), flux])
    edges = [(30, 150), (150, 400), (400, 1200), (1200, 3000), (3000, 6000)]
    weights = [2.0, 1.5, 1.0, 0.7, 0.5]  # the bass says where the beat is; hats say where it is not
    bands = []
    for lo, hi in edges:
        f = flux[:, (freqs >= lo) & (freqs < hi)].sum(axis=1)
        bands.append(f / (f.mean() + 1e-9))  # every band counts by how much it moves, not how loud it is
    low = bands[0]
    total = sum(w * b for w, b in zip(weights, bands))
    return low, total


def clean(env):
    env = env - np.convolve(env, np.ones(43) / 43, mode='same')  # drop the slow baseline
    return np.maximum(env, 0) / (env.std() + 1e-9)


def estimate_period(onset):
    """Beat period in frames: the autocorrelation peak among 60..180 BPM, weighted toward 110."""
    fps = SR / HOP
    ac = np.correlate(onset, onset, mode='full')[len(onset) - 1:]
    lo, hi = int(fps * 60 / 180), int(fps * 60 / 60)
    lags = np.arange(lo, hi)
    bpm = 60 * fps / lags
    score = ac[lo:hi] * np.exp(-0.5 * (np.log2(bpm / 110.0) / 0.9) ** 2)
    k = int(np.argmax(score))
    lag = lags[k]
    if 0 < k < len(score) - 1:  # parabolic refinement of the peak
        a, b, c = score[k - 1], score[k], score[k + 1]
        denom = a - 2 * b + c
        if denom != 0:
            lag = lag + 0.5 * (a - c) / denom
    return float(lag)


def track_beats(onset, period, tightness=100.0):
    n = len(onset)
    score = onset.astype(np.float64).copy()
    prev = -np.ones(n, dtype=int)
    lo, hi = max(1, int(round(period / 2))), int(round(period * 2))
    for t in range(n):
        first, last = max(0, t - hi), t - lo
        if last < first:
            continue
        taus = np.arange(first, last + 1)
        candidate = score[taus] - tightness * np.log((t - taus) / period) ** 2
        j = int(np.argmax(candidate))
        score[t] = onset[t] + candidate[j]
        prev[t] = taus[j]
    tail = max(0, n - int(period))
    t = tail + int(np.argmax(score[tail:]))
    beats = []
    while t >= 0:
        beats.append(t)
        t = prev[t]
    return np.array(beats[::-1])


def prefer_bass_phase(frames, low):
    """A beat tracker can lock on to the off-beat (hi-hats between the kicks). Compare the bass energy on the
    tracked beats with the bass energy halfway between them, and use whichever is stronger."""
    if len(frames) < 8:
        return frames
    mids = ((frames[:-1] + frames[1:]) // 2)

    def bass_at(positions):
        # a small window, since the exact onset frame can sit a frame or two to either side
        return float(np.mean([low[max(0, p - 2):p + 3].max() for p in positions]))

    if bass_at(mids) > 1.25 * bass_at(frames):
        first = frames[0] - (frames[1] - frames[0]) // 2
        shifted = np.concatenate([[first] if first >= 0 else [], mids, [frames[-1] + (frames[-1] - frames[-2]) // 2]])
        return shifted.astype(int)
    return frames


def analyse(ffmpeg, path):
    y = decode(ffmpeg, path)
    low, total = band_flux(y)
    low, onset = clean(low), clean(total)
    period = estimate_period(onset)
    frames = track_beats(onset, period)
    frames = prefer_bass_phase(frames, low)
    times = (frames * HOP + N_FFT / 2) / SR
    gaps = np.diff(times)
    bpm = 60.0 / float(np.median(gaps)) if len(gaps) else 0.0
    return {
        'seconds': round(len(y) / SR, 1),
        'bpm': round(bpm, 1),
        'beats': [round(float(b), 3) for b in times],
        # How steady the tracked beats are (1 = perfectly even); a low value means treat the grid as a guess.
        'beatSteadiness': round(float(1 - min(1, np.std(gaps) / (np.mean(gaps) + 1e-9) * 4)), 2) if len(gaps) > 2 else 0,
    }


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    folder = pathlib.Path(args[0])
    force = '--force' in args
    ffmpeg = find_ffmpeg(args[args.index('--ffmpeg') + 1] if '--ffmpeg' in args else None)
    catalogue_path = folder / 'catalogue.json'
    doc = json.loads(catalogue_path.read_text(encoding='utf-8')) if catalogue_path.exists() else {
        'name': folder.name, 'license': '', 'tracks': []}
    by_file = {t['file']: t for t in doc['tracks']}

    for path in sorted(p for p in folder.iterdir() if p.suffix.lower() in AUDIO_EXT):
        entry = by_file.get(path.name)
        if entry is None:
            entry = {'id': path.stem.lower().replace(' ', '-'), 'file': path.name, 'title': path.stem, 'version': '',
                     'genre': 'Other', 'mood': [], 'vocal': 'unknown', 'energy': 'unknown'}
            doc['tracks'].append(entry)
            by_file[path.name] = entry
        if not force and entry.get('beats'):
            continue
        result = analyse(ffmpeg, path)
        entry.update(result)
        print(f"{path.name}: {result['seconds']}s  {result['bpm']} BPM  {len(result['beats'])} beats  steadiness {result['beatSteadiness']}", flush=True)

    doc['tracks'] = [t for t in doc['tracks'] if (folder / t['file']).exists()]
    catalogue_path.write_text(json.dumps(doc, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


main()
