"""Regenerate redistributable audio fixtures. Requires Python 3 and FFmpeg."""
from pathlib import Path
import json
import subprocess
import wave

root = Path(__file__).resolve().parent.parent / 'tests' / 'fixtures'
with wave.open(str(root / 'fleurs-529121125980696453.wav')) as source:
    assert source.getnchannels() == 1 and source.getframerate() == 16000 and source.getsampwidth() == 2
    samples = source.readframes(source.getnframes())


def write_wav(name, pcm):
    with wave.open(str(root / name), 'wb') as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(16000)
        output.writeframes(pcm)


write_wav('swedish.wav', samples)
long_samples = bytearray()
for fixture in json.loads((root / 'fleurs.json').read_text()):
    with wave.open(str(root / fixture['file'])) as source:
        long_samples.extend(source.readframes(source.getnframes()))
write_wav('long.wav', long_samples)
write_wav('silence.wav', bytes(2 * 16000 * 2))


def convert(name, rate, codec, *options, repetitions=1, source='swedish.wav'):
    subprocess.run([
        'ffmpeg', '-v', 'error', '-y', '-stream_loop', str(repetitions - 1),
        '-i', str(root / source), '-map_metadata', '-1', '-ar', str(rate),
        '-ac', '2', '-c:a', codec, *options, str(root / 'formats' / name),
    ], check=True)


convert('stereo.wav', 44100, 'pcm_s16le')
convert('speech.mp3', 44100, 'libmp3lame', '-b:a', '128k')
convert('speech.ogg', 44100, 'vorbis', '-strict', '-2')
convert('speech.m4a', 48000, 'aac', '-b:a', '128k')
convert('speech.webm', 48000, 'libopus')
convert('speech.flac', 48000, 'flac')
convert('delayed.m4a', 48000, 'aac', '-b:a', '128k', '-output_ts_offset', '5')
convert('long.mp3', 44100, 'libmp3lame', '-b:a', '128k', repetitions=2, source='long.wav')
convert('long.m4a', 48000, 'aac', '-b:a', '128k', repetitions=2, source='long.wav')
convert('long.webm', 48000, 'libopus', repetitions=2, source='long.wav')
print('Generated CC BY 4.0 FLEURS derivatives.')
