"""Park ambience, synthesized from scratch -> art/audio/park-ambience.ogg (CC0: made here, no samples used).

A seamless loop of a soft breeze, leaf rustles and bird chirps. The WAV is written with plain Python, then
Blender's audio library (audaspace, with its bundled ffmpeg) encodes it as Ogg Vorbis. The game loops it
(src/audio/ambience.ts).
"""
import array
import math
import os
import random
import sys
import tempfile
import wave

sys.path.insert(0, os.path.dirname(__file__))
import aud  # noqa: E402
from lib import ART  # noqa: E402

RATE = 22050
SECONDS = 24
N = RATE * SECONDS
FADE = RATE // 2
rng = random.Random(7)


def breeze(n):
    """Low-passed noise whose loudness drifts slowly. Its gusts repeat every loop, so the loop is seamless."""
    out = [0.0] * n
    lp1 = lp2 = 0.0
    for i in range(n):
        lp1 += 0.02 * (rng.uniform(-1, 1) - lp1)
        lp2 += 0.02 * (lp1 - lp2)
        t = i / RATE
        gust = 0.55 + 0.25 * math.sin(2 * math.pi * t / SECONDS) + 0.2 * math.sin(2 * math.pi * 3 * t / SECONDS + 1.3)
        out[i] = lp2 * 9.0 * gust
    return out


def rustle(buf, start, length, level):
    """A short burst of brighter noise: leaves moving."""
    hp = prev = 0.0
    for k in range(length):
        i = start + k
        if i >= len(buf):
            break
        x = rng.uniform(-1, 1)
        hp = 0.7 * (hp + x - prev)
        prev = x
        env = math.sin(math.pi * k / length) ** 2
        buf[i] += hp * env * level


def chirp(buf, start, f0, f1, length, level):
    """One bird note: a sine sweep with a little second harmonic and a quick envelope."""
    phase = 0.0
    for k in range(length):
        i = start + k
        if i >= len(buf):
            break
        u = k / length
        f = f0 + (f1 - f0) * u
        phase += 2 * math.pi * f / RATE
        env = math.sin(math.pi * u) ** 1.5
        buf[i] += (math.sin(phase) + 0.25 * math.sin(2 * phase)) * env * level


def song(buf, start):
    """A little phrase of 2-6 notes, in one of a few bird 'voices'."""
    voice = rng.choice(("tweet", "trill", "whistle"))
    level = rng.uniform(0.05, 0.12)
    t = start
    for _ in range(rng.randint(2, 6)):
        if voice == "tweet":
            f0 = rng.uniform(3200, 4200)
            chirp(buf, t, f0, f0 * rng.uniform(1.15, 1.35), int(RATE * 0.06), level)
            t += int(RATE * rng.uniform(0.09, 0.14))
        elif voice == "trill":
            f0 = rng.uniform(2600, 3000)
            chirp(buf, t, f0 * 1.2, f0, int(RATE * 0.035), level * 0.8)
            t += int(RATE * 0.05)
        else:
            f0 = rng.uniform(1800, 2300)
            chirp(buf, t, f0, f0 * rng.choice((0.8, 1.25)), int(RATE * 0.22), level * 0.7)
            t += int(RATE * rng.uniform(0.28, 0.4))
    return t


def build():
    buf = breeze(N + FADE)
    # Crossfade the tail into the head, so the loop point is inaudible.
    for i in range(FADE):
        w = i / FADE
        buf[i] = buf[i] * w + buf[N + i] * (1 - w)
    buf = buf[:N]
    for _ in range(9):
        rustle(buf, rng.randrange(0, N - 2 * RATE), int(RATE * rng.uniform(0.6, 1.4)), rng.uniform(0.02, 0.05))
    # Songs never cross the loop point: the longest phrase lasts under 3 s.
    t = int(RATE * rng.uniform(0.5, 1.5))
    while t < N - RATE * 4:
        t = song(buf, t) + int(RATE * rng.uniform(0.8, 3.0))
    peak = max(abs(x) for x in buf)
    return [x * 0.7 / peak for x in buf]


def write_wav(path, samples):
    data = array.array("h", (max(-32767, min(32767, int(x * 32767))) for x in samples))
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(data.tobytes())


def encode(wav, ogg):
    # Audaspace encodes synchronously; bpy.ops.sound.mixdown writes nothing in background mode.
    aud.Sound(wav).write(ogg, rate=RATE, channels=aud.CHANNELS_MONO, format=aud.FORMAT_S16, container=aud.CONTAINER_OGG, codec=aud.CODEC_VORBIS, bitrate=48000)


samples = build()
tmp = os.path.join(tempfile.gettempdir(), "dink-park-ambience.wav")
write_wav(tmp, samples)
out = os.path.join(ART, "audio", "park-ambience.ogg")
os.makedirs(os.path.dirname(out), exist_ok=True)
encode(tmp, out)
os.remove(tmp)
print(f"[art] ambience: {SECONDS} s loop, {os.path.getsize(out)} bytes -> {out}")
