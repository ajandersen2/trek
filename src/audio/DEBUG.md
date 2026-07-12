# Audio engine — audit sheet

Everything is synthesized live (no assets). This sheet lists each cue's recipe
and the character it should have, so a human can audit by ear and tune numbers
in `cues.ts` / `loops.ts` without reverse-engineering the code.

## Auditioning

In the browser console on `npm run dev` (click the page once first — the
engine needs a gesture to unlock):

```js
const { createAudio } = await import('/src/audio/engine.ts')
const a = createAudio()
a.unlock()
a.play('phaser-fed')          // any SoundCue from api.ts
a.uiBeep('execute')           // 'tap' | 'confirm' | 'deny' | 'execute'
a.stingers.victory()
a.setAmbient(true)            // wait ~12 s to hear a console chirp
a.setRedAlert(true)
a.play('explosion-ship')      // klaxon should duck under it, then recover
a.setMuted(true)              // 30 ms fade, no click; loops resume on unmute
```

A scheduling audit harness (mock Web Audio API, validates ramps/stops/cleanup
on every cue) lives in the session scratchpad as `audit.ts`; run with `npx tsx`.

## Master chain

```
one-shot voices → ui bus (0.8) ─┐
one-shot voices → fx bus (1.0) ─┼→ premix (0.5) → compressor → master (0.55) → out
ambient/klaxon  → loops bus ────┘                 (-14 dB, 4.5:1)      │
                    ▲                                             mute ramps
                    └ ducked to 0.6 under fx cues, +0.4 s recovery    this gain
```

- Every one-shot is a self-contained "voice": its nodes disconnect on the last
  source's `onended` — no leaks.
- Envelopes: linear attack from 0, exponential decay to 1e-4 (never to 0),
  sources stop ~20 ms after their envelope reaches silence.
- Repeated cues get ±2–6% random pitch/length variation (`vary()`).

## UI beeps (ui bus)

| Cue | Recipe | Should sound like |
| --- | --- | --- |
| `tap` | triangle 1500→1340 Hz, 60 ms, peak 0.22 | subtle console blip, not a test tone |
| `confirm` | triangle 1050 then 1575 Hz (rising fifth), 165 ms | quick cheerful "accepted" chirp |
| `deny` | square 150→118 Hz through 480 Hz lowpass, 150 ms | short low buzz, polite refusal |
| `execute` | triangle 587 / 784 / 1046 Hz quartal ascent + faint 2092 Hz sparkle, 330 ms | authoritative three-note commit |

## Combat / diegetic cues (fx bus)

| Cue | Recipe | Should sound like |
| --- | --- | --- |
| `phaser-fed` | saw 1400→900 Hz through resonant bandpass (1600→1000, Q 7), 24 Hz vibrato, noise sheen on same sweep; 750 ms sustain | steady descending energy beam, slightly alive |
| `disruptor` | square 500→220 + saw 250→110 through tanh shaper (drive 4.5) and closing lowpass 1400→480, 43 Hz amp wobble; 520 ms | meaner, lower, growlier than the phaser |
| `torpedo-launch` | sine thump 130→48 Hz at release + 2.6 kHz snap + noise whoosh rising 350→2100 Hz with playback-rate ramp 0.8→1.4; 640 ms | thunk then something leaving fast |
| `torpedo-hit` | noise blast, lowpass 4200→160 Hz + sine body 92→50 Hz + 1.1 kHz crack; 650 ms | sharp detonation with weight |
| `explosion-small` | same family: lowpass 3000→160, longer, no crack; 830 ms | darker secondary explosion |
| `explosion-ship` | 0.24 s noise swell → blast (lowpass 4800→110 over 1.9 s, peak 0.95) + sub thumps 64→34 / 52→30 Hz + fluttering 160 Hz rumble tail (5.5 Hz LFO) + 3 falling debris pings 1750/1180/790 Hz; ~2.6 s | the big one — swell, boom, long rumble, debris |
| `shield-hit` | FM bell: sine 520 Hz, modulator 2.76× ratio, index 480→8 Hz over 0.32 s + rising 972 Hz partial + noise spark; 450 ms | metallic energy splash on a forcefield |
| `hull-hit` | FM clank: sine 175→150 Hz, modulator 1.4× ratio + lowpassed thud; 310 ms | dull structural clank, no ring |
| `miss-whoosh` | bandpass noise 500→2300→380 Hz, playback rate 1.35→0.75; peak only 0.16; 470 ms | quiet doppler fly-by |
| `scan` | sine ping sweeping 600→2400 Hz + two echoes at 0.26/0.52 s, each quieter and shorter; 710 ms | sonar-ish rising sweep with fading repeats |
| `hail` | two soft sine sweeps converging on ~1380 Hz (920 up, 1720 down) with gentle 6 Hz warble; 590 ms | friendly two-tone comms whistle (original contour) |
| `repair` | 4 high-Q noise ticks alternating 2300/1850 Hz (70 ms apart) + two-note triangle chime; 510 ms | tool ratchet then "fixed" |
| `warp-out` | 3 detuned saws 220→880 Hz, detune widening ±9→±26 cents, lowpass opening 900→6500 Hz, noise whoosh tail; 1.3 s | shimmering riser that blooms then whooshes away |
| `warp-travel` | statelier: saws 165→660 Hz + quiet fifth layer, slower attack, longer whoosh; 1.6 s | grander version for the sector jump |
| `cloak` | triangle stack 720→175 Hz, lowpass closing 4200→260 Hz, chorus widening, faint noise wash; 930 ms | dissolving downward shimmer, "fading away" |
| `decloak` | reverse: stack 185→740 Hz, lowpass opening 320→5000 Hz, detune narrowing (solidifying), bright glint at 0.5 s; 730 ms | rematerializing upward shimmer |
| `dock` | sine thud 90→52 Hz + short FM contact clank (1.33× ratio) + 3.2 kHz latch click + gentle 880/1318 Hz welcome chime; 660 ms | solid mechanical capture, then "you're home" |

## Stingers (fx bus)

| Cue | Recipe | Should sound like |
| --- | --- | --- |
| `victory` | detuned saw pairs (±7 cents) through 2.4 kHz lowpass: C4 E4 G4 C5 → held E5 with late vibrato, timpani-ish 98→62 Hz downbeat; ~2 s | short triumphant brass-ish fanfare |
| `defeat` | dark sine+triangle pairs through 900 Hz lowpass: A3 F3 D3 → A2 held, sagging a whole step as it dies; ~2.5 s | low, somber descent |
| `missionComplete` | saw/triangle G4 C5 E5 → held G5 with B5+D6 chord shimmer and 2093 Hz sparkle, 3.2 kHz lowpass; ~2.3 s | brighter, resolved fanfare |

## Loops (loops bus — ducked to 0.6 under fx cues)

**Ambient** (`setAmbient(true)`): white-noise loop through 240 Hz lowpass
(gain 0.05, "breathing" ±25% at 0.07 Hz) + 57.5 Hz sine hum (0.028) + 115 Hz
octave (0.01); every 6–12 s one of four soft console chirp patterns (~0.05
peak, i.e. ~25 dB under cue peaks). Fades in over 1.2 s, out over 0.5 s.
Should disappear from attention within seconds; you notice it when it stops.

**Red alert** (`setRedAlert(true)`): ~0.82 s cycle — rising "whoop" 445→668 Hz
(saw+sine through 1350 Hz lowpass, peak 0.2) answered by a lower 334→297 Hz
tone (950 Hz lowpass, peak 0.17). Lookahead-scheduled 1.2 s ahead so a busy
main thread never gaps it. Atmospheric, under gameplay — never ear-splitting.

## Tuning knobs

- Bus levels / duck depth: `MASTER_LEVEL`, `PREMIX_LEVEL`, `UI_LEVEL`,
  `DUCK_LEVEL` in `engine.ts`.
- Ambient loudness: `AMBIENT_*` and `CHIRP_PEAK` in `loops.ts`.
- Klaxon period/pitches: `KLAXON_PERIOD` and the `cycle()` body in `loops.ts`.
- Per-cue peaks/frequencies: inline in each recipe in `cues.ts` (each is
  commented with its intent).

## Behavior notes

- Engine is fully inert until the first `unlock()` (called from a user
  gesture); `setMuted` / `setAmbient` / `setRedAlert` before that just record
  desired state and apply on unlock.
- Mute ramps the post-compressor master gain over 30 ms (no clicks). Loops
  keep running silently while muted and are simply audible again on unmute.
- If an explosion, klaxon and beam overlap, the compressor (-14 dB threshold,
  4.5:1) catches the sum — nothing should clip.
