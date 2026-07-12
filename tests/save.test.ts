import { describe, expect, it } from 'vitest'
import { klingonAI } from '../src/sim/ai'
import { applyEncounterRound, newGame, travelTo } from '../src/sim/game'
import { createRng } from '../src/sim/rng'
import { SAVE_VERSION, SaveError, deserializeGame, serializeGame } from '../src/sim/save'
import { defaultPower } from '../src/sim/ship'
import type { OrderSet } from '../src/sim/types'

describe('save round-trips', () => {
  it('round-trips a fresh game exactly', () => {
    const { state } = newGame(2024)
    expect(deserializeGame(serializeGame(state))).toEqual(state)
  })

  it('round-trips a mid-campaign state including RNG position', () => {
    let s = newGame(7).state
    s = travelTo(s, 'tellun').state
    if (s.mode === 'sector') s = travelTo(s, 'drozana').state
    const restored = deserializeGame(serializeGame(s))
    expect(restored).toEqual(s)
    expect(restored.rngState).toBe(s.rngState)
  })

  it('a loaded game continues identically to the original (determinism across save/load)', () => {
    // Get into an encounter deterministically.
    let s = newGame(11).state
    for (const hop of ['archer', 'hromi', 'veyra']) {
      if (s.mode !== 'sector') break
      s = travelTo(s, hop).state
    }
    expect(s.mode).toBe('encounter')

    const loaded = deserializeGame(serializeGame(s))
    const orders = (): OrderSet[] => [
      {
        shipId: 'player',
        helm: { turn: 1, throttle: 2 },
        tactical: { firePhasers: { targetId: 'enemy', subsystem: null } },
        engineering: { power: defaultPower() },
      },
      klingonAI(s.encounter!, 'enemy', createRng(3)),
    ]
    const a = applyEncounterRound(s, orders())
    const b = applyEncounterRound(loaded, orders())
    expect(a.state).toEqual(b.state)
    expect(a.events).toEqual(b.events)
  })
})

describe('save rejection', () => {
  it('rejects garbage', () => {
    expect(() => deserializeGame('not json at all')).toThrow(SaveError)
    expect(() => deserializeGame('42')).toThrow(SaveError)
    expect(() => deserializeGame('{}')).toThrow(SaveError)
  })

  it('rejects saves from a newer version', () => {
    const { state } = newGame(1)
    const file = JSON.parse(serializeGame(state))
    file.version = SAVE_VERSION + 1
    expect(() => deserializeGame(JSON.stringify(file))).toThrow(/newer game version/)
  })

  it('rejects structurally broken states', () => {
    const { state } = newGame(1)
    const noShip = JSON.parse(serializeGame(state))
    delete noShip.state.ship
    expect(() => deserializeGame(JSON.stringify(noShip))).toThrow(SaveError)

    const badSystem = JSON.parse(serializeGame(state))
    badSystem.state.galaxy.currentSystemId = 'nowhere'
    expect(() => deserializeGame(JSON.stringify(badSystem))).toThrow(/unknown star system/)

    const badMode = JSON.parse(serializeGame(state))
    badMode.state.mode = 'flying'
    expect(() => deserializeGame(JSON.stringify(badMode))).toThrow(/unknown mode/)
  })
})
