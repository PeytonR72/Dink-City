"""Each Venue's ambience, synthesized from scratch -> art/audio/<venue>-ambience.ogg (CC0: made here, no
samples used).

Seamless 24 s loops:
- park: a soft breeze, leaf rustles and bird chirps
- rooftop: a low city rumble, an AC hum, distant car horns and pigeons
- beach: waves swelling and washing in, and gulls

The WAV is written with plain Python, then Blender's audio library (audaspace, with its bundled ffmpeg)
encodes it as Ogg Vorbis. The game loops it (src/audio/ambience.ts).
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
# Reseeded per Venue (see VENUES).
rng = random.Random(7)


def breeze(n, cutoff=0.02, gain=9.0, level=None):
    """Low-passed noise whose loudness drifts slowly (`level(t)`, periodic in the loop), so the loop is seamless."""
    out = [0.0] * n
    lp1 = lp2 = 0.0
    for i in range(n):
        lp1 += cutoff * (rng.uniform(-1, 1) - lp1)
        lp2 += cutoff * (lp1 - lp2)
        t = i / RATE
        gust = level(t) if level else 0.55 + 0.25 * math.sin(2 * math.pi * t / SECONDS) + 0.2 * math.sin(2 * math.pi * 3 * t / SECONDS + 1.3)
        out[i] = lp2 * gain * gust
    return out


def looped(buf):
    """Crossfades the tail (FADE samples past N) into the head, so the loop point is inaudible."""
    for i in range(FADE):
        w = i / FADE
        buf[i] = buf[i] * w + buf[N + i] * (1 - w)
    return buf[:N]


def normalized(buf, peak_level=0.7):
    peak = max(abs(x) for x in buf)
    return [x * peak_level / peak for x in buf]


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


def park():
    buf = looped(breeze(N + FADE))
    for _ in range(9):
        rustle(buf, rng.randrange(0, N - 2 * RATE), int(RATE * rng.uniform(0.6, 1.4)), rng.uniform(0.02, 0.05))
    # Songs never cross the loop point: the longest phrase lasts under 3 s.
    t = int(RATE * rng.uniform(0.5, 1.5))
    while t < N - RATE * 4:
        t = song(buf, t) + int(RATE * rng.uniform(0.8, 3.0))
    return normalized(buf)


def tone(buf, start, freq, length, level, harmonics=(1.0,), attack=0.02):
    """A steady note with a soft attack and release."""
    phase = 0.0
    a = max(1, int(RATE * attack))
    for k in range(length):
        i = start + k
        if i >= len(buf):
            break
        phase += 2 * math.pi * freq / RATE
        env = min(1.0, k / a, (length - k) / a)
        buf[i] += sum(h * math.sin((n + 1) * phase) for n, h in enumerate(harmonics)) * env * level


def horn(buf, start):
    """A distant car horn: one or two short honks of a buzzy two-note chord."""
    level = rng.uniform(0.025, 0.05)
    f = rng.uniform(380, 460)
    t = start
    for _ in range(rng.choice((1, 2, 2))):
        length = int(RATE * rng.uniform(0.15, 0.4))
        for mult in (1.0, 1.26):
            tone(buf, t, f * mult, length, level, harmonics=(1.0, 0.5, 0.3, 0.2), attack=0.015)
        t += length + int(RATE * 0.1)
    return t


def coo(buf, start):
    """A pigeon's 'croo-oo': a low, wobbling two-part note."""
    level = rng.uniform(0.05, 0.08)
    f = rng.uniform(380, 460)
    t = start
    for length, slide in ((0.28, 60), (0.5, -90)):
        n = int(RATE * length)
        phase = 0.0
        for k in range(n):
            i = t + k
            if i >= len(buf):
                break
            u = k / n
            phase += 2 * math.pi * (f + slide * u + 12 * math.sin(2 * math.pi * 18 * k / RATE)) / RATE
            env = math.sin(math.pi * u) ** 1.2
            buf[i] += (math.sin(phase) + 0.3 * math.sin(2 * phase)) * env * level
        t += n + int(RATE * 0.05)
    return t


def rooftop():
    # The city far below: a low rumble that swells like passing traffic, and wind over the roof.
    rumble = breeze(N + FADE, cutoff=0.006, gain=26.0,
                    level=lambda t: 0.6 + 0.2 * math.sin(2 * math.pi * 2 * t / SECONDS) + 0.2 * math.sin(2 * math.pi * 5 * t / SECONDS + 0.7))
    wind = breeze(N + FADE, cutoff=0.03, gain=4.0, level=lambda t: 0.4 + 0.3 * math.sin(2 * math.pi * t / SECONDS + 2.0))
    buf = looped([a + b for a, b in zip(rumble, wind)])
    # The AC units: a steady hum with a whole number of cycles per loop, so it loops cleanly.
    for freq, level in ((60, 0.05), (120, 0.03), (180, 0.012)):
        for i in range(N):
            buf[i] += math.sin(2 * math.pi * freq * i / RATE) * level
    t = int(RATE * rng.uniform(1.0, 3.0))
    while t < N - RATE * 3:
        t = horn(buf, t) + int(RATE * rng.uniform(3.0, 7.0))
    t = int(RATE * rng.uniform(2.0, 4.0))
    while t < N - RATE * 3:
        for _ in range(rng.randint(1, 3)):
            t = coo(buf, t) + int(RATE * rng.uniform(0.2, 0.5))
        t += int(RATE * rng.uniform(4.0, 8.0))
    return normalized(buf)


def gull(buf, start):
    """A gull's 'kee-ow': a bright falling sweep, repeated a few times."""
    level = rng.uniform(0.04, 0.08)
    t = start
    for _ in range(rng.randint(1, 4)):
        f0 = rng.uniform(1300, 1700)
        n = int(RATE * rng.uniform(0.22, 0.35))
        phase = 0.0
        for k in range(n):
            i = t + k
            if i >= len(buf):
                break
            u = k / n
            f = f0 * (1 + 0.25 * math.sin(math.pi * u)) * (1 - 0.35 * u)
            phase += 2 * math.pi * f / RATE
            env = math.sin(math.pi * min(1.0, u * 1.4)) ** 0.8 if u < 0.7 else (1 - u) / 0.3
            buf[i] += (math.sin(phase) + 0.45 * math.sin(2 * phase) + 0.2 * math.sin(3 * phase)) * env * level
        t += n + int(RATE * rng.uniform(0.08, 0.2))
    return t


def beach():
    # Four waves per loop: each swells and breaks, then washes out as brighter hiss.
    def swell(t):
        u = (t / (SECONDS / 4)) % 1.0
        return 0.15 + 0.85 * math.sin(math.pi * u / 1.2) ** 2 if u < 0.6 else 0.15 + 0.85 * (1 - (u - 0.6) / 0.4)

    def wash(t):
        u = (t / (SECONDS / 4) - 0.35) % 1.0
        return 0.05 + 0.6 * math.exp(-(((u - 0.2) / 0.12) ** 2))

    surf = breeze(N + FADE, cutoff=0.015, gain=16.0, level=swell)
    hiss = breeze(N + FADE, cutoff=0.25, gain=1.6, level=wash)
    buf = looped([a + b for a, b in zip(surf, hiss)])
    t = int(RATE * rng.uniform(1.0, 2.5))
    while t < N - RATE * 3:
        t = gull(buf, t) + int(RATE * rng.uniform(3.5, 8.0))
    return normalized(buf)


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


# Each Venue's recipe and seed. The Park's is unchanged from milestone 04, so its loop is too.
VENUES = {"park": (park, 7), "rooftop": (rooftop, 8), "beach": (beach, 9)}

for venue, (recipe, seed) in VENUES.items():
    rng = random.Random(seed)
    samples = recipe()
    tmp = os.path.join(tempfile.gettempdir(), f"dink-{venue}-ambience.wav")
    write_wav(tmp, samples)
    out = os.path.join(ART, "audio", f"{venue}-ambience.ogg")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    encode(tmp, out)
    os.remove(tmp)
    print(f"[art] ambience {venue}: {SECONDS} s loop, {os.path.getsize(out)} bytes -> {out}")
