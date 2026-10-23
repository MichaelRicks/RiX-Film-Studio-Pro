"""Stage a music folder as a downloadable song pack (what a GitHub release would hold).

usage (from the repo root):
  backend/.venv/Scripts/python.exe -I scripts/music/stage-pack.py "<music folder>" "<output folder>"

Writes, into the output folder, every song under a web-safe file name (lower-case letters,
digits and hyphens; GitHub rewrites spaces and punctuation in asset names, which would break
the download) plus a catalogue.json in which each song says which asset holds it (`remote`) and
how many bytes it should be (`bytes`, so an interrupted download is caught). The app fetches
catalogue.json first, then a song only when it is previewed or added.

Run scripts/music/update-catalogue.py on the folder first so the catalogue is complete.
"""
import json
import pathlib
import re
import shutil
import sys


def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-') or 'song'


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    source, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    doc = json.loads((source / 'catalogue.json').read_text(encoding='utf-8'))
    out.mkdir(parents=True, exist_ok=True)

    used = set()
    tracks = []
    for track in doc['tracks']:
        path = source / track['file']
        if not path.exists():
            print(f'skipped (file missing): {track["file"]}')
            continue
        base = slug(path.stem)
        name, n = f'{base}{path.suffix.lower()}', 2
        while name in used:
            name, n = f'{base}-{n}{path.suffix.lower()}', n + 1
        used.add(name)
        shutil.copyfile(path, out / name)
        entry = {k: v for k, v in track.items() if k != 'reviewNote'}
        entry['remote'] = name
        entry['bytes'] = path.stat().st_size
        tracks.append(entry)

    doc['tracks'] = tracks
    (out / 'catalogue.json').write_text(json.dumps(doc, indent=1, ensure_ascii=False) + '\n', encoding='utf-8')
    total = sum(t['bytes'] for t in tracks)
    print(f'{len(tracks)} songs, {total / 1048576:.1f} MB staged in {out}')


main()
