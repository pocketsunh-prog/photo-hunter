#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Procedurally synthesise the game's background music and sound effects.

No third-party audio libraries and no downloaded media: everything here is
generated from oscillators + envelopes + a small Schroeder reverb, then written
as 16-bit PCM WAV. Outputs go to shared/assets/audio and are mirrored into
web/public/assets/audio and android/app/src/main/res/raw.

Tracks
  bgm-menu.wav        32 s seamless ambient loop (chapter-select screen)
  bgm-game.wav        32 s seamless ambient loop (in-level, a little more pulse)
  sfx-found.wav       bright bell arpeggio - an anachronism was found
  sfx-wrong.wav       soft muted thud - tapped empty photo
  sfx-hint.wav        rising sparkle - 錦囊 used
  sfx-level-clear.wav short pentatonic fanfare - chapter clear
  sfx-game-clear.wav  longer fanfare - all ten chapters cleared
  sfx-click.wav       UI tick
  sfx-bonus.wav       reward jingle - extra 錦囊 awarded

Usage: py tools/generate_audio.py
"""
from __future__ import annotations

import array
import math
import random
import shutil
import struct
import sys
import wave
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "shared" / "assets" / "audio"
# Android res/raw file names may only contain [a-z0-9_], so mirrors rename there.
MIRRORS = [
    (ROOT / "web" / "public" / "assets" / "audio", False),
    (ROOT / "android" / "app" / "src" / "main" / "res" / "raw", True),
]


def mirror_name(name: str, android: bool) -> str:
    return name.replace("-", "_") if android else name

BGM_SR = 22050
SFX_SR = 44100

# D minor pentatonic - a calm, "ancient China" colour
D4, F4, G4, A4, C5, D5, F5, G5, A5, C6, D6 = (
    293.66, 349.23, 392.00, 440.00, 523.25, 587.33, 698.46, 783.99, 880.00, 1046.50, 1174.66,
)
A3, D3, F3, C4, G3, Bb3 = 220.00, 146.83, 174.61, 261.63, 196.00, 233.08


class Buffer:
    """A mono float sample buffer with a little bit of glue."""

    def __init__(self, seconds: float, sr: int):
        self.sr = sr
        self.n = int(seconds * sr)
        self.data = [0.0] * self.n

    def add(self, index: int, value: float) -> None:
        if 0 <= index < self.n:
            self.data[index] += value

    def mix(self, other: "Buffer", offset: int, gain: float = 1.0) -> None:
        for i, v in enumerate(other.data):
            self.add(offset + i, v * gain)

    def wrap_mix(self, other: "Buffer", offset: int, gain: float = 1.0) -> None:
        """Add with wrap-around so reverb tails survive a seamless loop."""
        for i, v in enumerate(other.data):
            self.data[(offset + i) % self.n] += v * gain

    def seamless_loop(self, loop_seconds: float, cross_seconds: float) -> "Buffer":
        """Fold the rendered tail back over the head so the loop point is continuous.

        The buffer must have been rendered cross_seconds longer than the loop;
        sample loop_n-1 is then immediately followed by sample loop_n, which is
        exactly the neighbour it had in the continuous render, so there is no
        waveform discontinuity (and therefore no click) at the loop point.
        """
        loop_n = int(loop_seconds * self.sr)
        cross_n = int(cross_seconds * self.sr)
        if loop_n + cross_n > self.n:
            raise ValueError("buffer too short for requested crossfade")
        out = self.data[:loop_n]
        for i in range(cross_n):
            g = i / cross_n
            out[i] = self.data[i] * g + self.data[loop_n + i] * (1.0 - g)
        result = Buffer(loop_seconds, self.sr)
        result.data = out
        return result

    def normalise(self, peak: float = 0.85) -> None:
        hi = max((abs(v) for v in self.data), default=0.0)
        if hi > 0:
            k = peak / hi
            self.data = [v * k for v in self.data]

    def fade_edges(self, ms: float = 12.0) -> None:
        k = max(1, int(self.sr * ms / 1000))
        for i in range(min(k, self.n)):
            g = i / k
            self.data[i] *= g
            self.data[self.n - 1 - i] *= g

    def soft_clip(self) -> None:
        self.data = [math.tanh(v * 1.15) for v in self.data]

    def to_wav(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        pcm = array.array("h", (int(max(-1.0, min(1.0, v)) * 32767) for v in self.data))
        with wave.open(str(path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(self.sr)
            w.writeframes(pcm.tobytes())


def env_ad(n: int, sr: int, attack: float, decay: float, curve: float = 3.0):
    """Attack/decay envelope generator returning a float per sample."""
    na = max(1, int(attack * sr))
    for i in range(n):
        if i < na:
            yield (i / na) ** 1.5
        else:
            t = (i - na) / sr
            yield math.exp(-t / max(1e-4, decay)) ** (1.0 / curve) if curve else math.exp(-t / decay)


def pad(buf: Buffer, freq: float, start: float, dur: float, amp: float, detune: float = 0.004) -> None:
    """Warm sustained pad: three slightly detuned sines with a slow swell."""
    sr = buf.sr
    n = int(dur * sr)
    i0 = int(start * sr)
    two_pi = 2 * math.pi
    for i, e in enumerate(env_ad(n, sr, attack=min(1.2, dur * 0.35), decay=dur * 0.7, curve=1.0)):
        t = i / sr
        v = (
            math.sin(two_pi * freq * t)
            + 0.7 * math.sin(two_pi * freq * (1 + detune) * t + 0.7)
            + 0.5 * math.sin(two_pi * freq * (1 - detune) * t * 0.5)
        )
        # slow amplitude breathing so the loop never sounds static
        breathe = 0.82 + 0.18 * math.sin(two_pi * 0.06 * t)
        buf.add(i0 + i, v * e * amp * breathe / 2.2)


def pluck(buf: Buffer, freq: float, start: float, amp: float, decay: float = 0.9) -> None:
    """Guzheng/pipa-ish pluck: harmonic stack with fast exponential decay."""
    sr = buf.sr
    dur = decay * 4.5
    n = int(dur * sr)
    i0 = int(start * sr)
    two_pi = 2 * math.pi
    partials = [(1, 1.0), (2, 0.42), (3, 0.26), (4, 0.13), (5, 0.07), (6, 0.04)]
    for i, e in enumerate(env_ad(n, sr, attack=0.004, decay=decay, curve=2.2)):
        t = i / sr
        v = sum(g * math.sin(two_pi * freq * p * t + p * 0.3) for p, g in partials)
        buf.add(i0 + i, v * e * amp / 1.9)


def bell(buf: Buffer, freq: float, start: float, amp: float, decay: float = 1.6) -> None:
    """Inharmonic bell for the 'found it' chime."""
    sr = buf.sr
    n = int(decay * 3.2 * sr)
    i0 = int(start * sr)
    two_pi = 2 * math.pi
    partials = [(1.0, 1.0), (2.01, 0.5), (2.98, 0.3), (4.16, 0.18), (5.43, 0.1), (6.79, 0.06)]
    for i, e in enumerate(env_ad(n, sr, attack=0.002, decay=decay, curve=2.6)):
        t = i / sr
        v = sum(g * math.sin(two_pi * freq * p * t) for p, g in partials)
        buf.add(i0 + i, v * e * amp / 2.1)


def thud(buf: Buffer, freq: float, start: float, amp: float) -> None:
    """Muted, non-punishing 'nothing there' sound: low sine + noise burst."""
    sr = buf.sr
    n = int(0.30 * sr)
    i0 = int(start * sr)
    rnd = random.Random(7)
    two_pi = 2 * math.pi
    for i, e in enumerate(env_ad(n, sr, attack=0.002, decay=0.075, curve=2.0)):
        t = i / sr
        v = math.sin(two_pi * (freq * math.exp(-t * 5)) * t) + 0.35 * (rnd.random() * 2 - 1) * math.exp(-t * 45)
        buf.add(i0 + i, v * e * amp / 1.4)


def reverb(buf: Buffer, amount: float = 0.34, decay: float = 0.42) -> Buffer:
    """Compact Schroeder reverb (4 combs + 2 allpass) for room space."""
    sr = buf.sr
    out = [0.0] * buf.n
    combs = [int(sr * d) for d in (0.0297, 0.0371, 0.0411, 0.0437)]
    feedback = decay
    for delay in combs:
        line = [0.0] * delay
        idx = 0
        for i, x in enumerate(buf.data):
            y = line[idx]
            line[idx] = x + y * feedback
            idx = (idx + 1) % delay
            out[i] += y * 0.25
    for delay in (int(sr * 0.005), int(sr * 0.0017)):
        line = [0.0] * delay
        idx = 0
        for i in range(len(out)):
            bufidx = (idx - delay + 1) % delay
            y = line[bufidx] - 0.5 * out[i]
            line[bufidx] = out[i] + 0.5 * y
            out[i] = y
            idx = (idx + 1) % delay
    wet = Buffer(buf.n / sr, sr)
    wet.data = out
    mixed = Buffer(buf.n / sr, sr)
    mixed.data = [buf.data[i] + wet.data[i] * amount * 3.0 for i in range(buf.n)]
    return mixed


def make_bgm(pulse: bool, seed: int) -> Buffer:
    """32 s seamless loop: pad progression + sparse pentatonic plucks.

    Rendered 1 s longer than the loop, then tail-folded, so the loop point has
    no click (see Buffer.seamless_loop).
    """
    rnd = random.Random(seed)
    seconds = 32.0
    tail = 1.0
    buf = Buffer(seconds + tail, BGM_SR)

    # i - VI - III - VII in D minor, two bars each = 8 bars of 4 s
    progression = [
        (D3, [D4, F4, A4]),
        (Bb3, [D4, F4, Bb3 * 2]),
        (F3, [F4, A4, C5]),
        (C4, [C4, G4, C5]),
    ]
    bar = 4.0
    for b in range(8):
        root, chord = progression[b % len(progression)]
        t0 = b * bar
        pad(buf, root, t0, bar * 1.9, amp=0.30)
        for k, f in enumerate(chord):
            pad(buf, f, t0 + 0.12 * k, bar * 1.7, amp=0.16)

    # melody: pentatonic notes on a musical grid, deterministic per track
    scale = [D4, F4, G4, A4, C5, D5, F5, G5, A5, C6, D6]
    weights = [3, 3, 4, 4, 4, 5, 4, 3, 2, 2, 1]
    steps = int(seconds / 0.5)
    last = 5
    for s in range(steps):
        if s % 2 == 1 and rnd.random() > (0.34 if pulse else 0.20):
            continue
        if rnd.random() > (0.72 if pulse else 0.48):
            continue
        # melodic random walk keeps phrases coherent
        last = max(0, min(len(scale) - 1, last + rnd.choice([-2, -1, -1, 0, 1, 1, 2])))
        idx = last if rnd.random() < 0.75 else rnd.choices(range(len(scale)), weights=weights)[0]
        amp = 0.16 if s % 8 == 0 else 0.10
        pluck(buf, scale[idx], s * 0.5, amp=amp, decay=1.1 if s % 4 == 0 else 0.75)

    if pulse:
        # soft heartbeat on the downbeat for the in-level track
        for b in range(int(seconds / 2)):
            thud(buf, 92.0, b * 2.0, amp=0.10)

    wet = reverb(buf, amount=0.40, decay=0.46)
    looped = wet.seamless_loop(seconds, 0.8)
    looped.normalise(0.72)
    return looped


def make_found() -> Buffer:
    buf = Buffer(1.5, SFX_SR)
    for i, f in enumerate([D5, A5, D6]):
        bell(buf, f, i * 0.075, amp=0.55, decay=0.85 - i * 0.12)
    bell(buf, D6 * 2, 0.22, amp=0.16, decay=0.5)
    out = reverb(buf, amount=0.30, decay=0.35)
    out.normalise(0.9)
    out.fade_edges(6)
    return out


def make_wrong() -> Buffer:
    buf = Buffer(0.45, SFX_SR)
    thud(buf, 130.0, 0.0, amp=0.5)
    out = reverb(buf, amount=0.16, decay=0.28)
    out.normalise(0.62)
    out.fade_edges(6)
    return out


def make_hint() -> Buffer:
    buf = Buffer(1.6, SFX_SR)
    for i in range(7):
        bell(buf, D5 * (1.1225 ** i), i * 0.055, amp=0.30 - i * 0.025, decay=0.45)
    pluck(buf, A5, 0.42, amp=0.22, decay=0.7)
    out = reverb(buf, amount=0.34, decay=0.38)
    out.normalise(0.85)
    out.fade_edges(6)
    return out


def make_level_clear() -> Buffer:
    buf = Buffer(2.6, SFX_SR)
    run = [D4, F4, G4, A4, C5, D5, F5, G5, A5, D6]
    for i, f in enumerate(run):
        pluck(buf, f, i * 0.085, amp=0.34, decay=0.55)
    for j, f in enumerate([D5, A5, D6]):
        bell(buf, f, 0.95 + j * 0.03, amp=0.5, decay=1.5)
    pad(buf, D4, 0.9, 1.6, amp=0.22)
    out = reverb(buf, amount=0.36, decay=0.45)
    out.normalise(0.92)
    out.fade_edges(8)
    return out


def make_game_clear() -> Buffer:
    buf = Buffer(4.6, SFX_SR)
    run = [D4, F4, G4, A4, C5, D5, F5, G5, A5, C6, D6, D6 * 1.1892]  # ends on a high F6
    for i, f in enumerate(run):
        pluck(buf, f, i * 0.11, amp=0.32, decay=0.7)
    for j, f in enumerate([D5, A5, D6, A5 * 2]):
        bell(buf, f, 1.35 + j * 0.05, amp=0.46, decay=1.9)
    for k, f in enumerate([D3, D4, A4, D5]):
        pad(buf, f, 1.3, 3.0, amp=0.20)
    for j, f in enumerate([D6, A5, F5, D5]):
        bell(buf, f, 2.6 + j * 0.16, amp=0.30, decay=1.6)
    out = reverb(buf, amount=0.42, decay=0.5)
    out.normalise(0.95)
    out.fade_edges(10)
    return out


def make_bonus() -> Buffer:
    """Shorter, brighter cousin of the clear jingle for the 錦囊 reward."""
    buf = Buffer(2.2, SFX_SR)
    for i, f in enumerate([G4, C5, D5, G5]):
        pluck(buf, f, i * 0.09, amp=0.34, decay=0.6)
    for j, f in enumerate([G5, C6, D6]):
        bell(buf, f, 0.42 + j * 0.09, amp=0.40, decay=1.2)
    out = reverb(buf, amount=0.34, decay=0.4)
    out.normalise(0.9)
    out.fade_edges(6)
    return out


def make_click() -> Buffer:
    buf = Buffer(0.09, SFX_SR)
    pluck(buf, A5, 0.0, amp=0.30, decay=0.06)
    out = reverb(buf, amount=0.10, decay=0.2)
    out.normalise(0.5)
    out.fade_edges(3)
    return out


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tracks = {
        "bgm-menu.wav": lambda: make_bgm(pulse=False, seed=11),
        "bgm-game.wav": lambda: make_bgm(pulse=True, seed=29),
        "sfx-found.wav": make_found,
        "sfx-wrong.wav": make_wrong,
        "sfx-hint.wav": make_hint,
        "sfx-level-clear.wav": make_level_clear,
        "sfx-game-clear.wav": make_game_clear,
        "sfx-bonus.wav": make_bonus,
        "sfx-click.wav": make_click,
    }
    total = 0
    for name, factory in tracks.items():
        buf = factory()
        path = OUT_DIR / name
        buf.to_wav(path)
        for mirror, is_android in MIRRORS:
            mirror.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, mirror / mirror_name(name, is_android))
        kb = path.stat().st_size / 1024
        total += path.stat().st_size
        print(f"{name:24s} {buf.n / buf.sr:5.2f}s  {kb:7.0f} KB")
    print(f"\ntotal {total / 1024 / 1024:.1f} MB -> {OUT_DIR.relative_to(ROOT)}")
    print("mirrored into:", ", ".join(str(m.relative_to(ROOT)) for m, _ in MIRRORS))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
