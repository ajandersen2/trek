import { describe, expect, it } from 'vitest'
import {
  POWER_MAX_PER_SYSTEM,
  clampAllocation,
  isValidAllocation,
  powerBudget,
  systemFactor,
} from '../src/sim/power'
import { createShip } from '../src/sim/ship'

describe('powerBudget', () => {
  it('gives rated power at full hull', () => {
    const ship = createShip('p', 'Test', 'fed-cruiser', { x: 0, y: 0 }, 0)
    expect(powerBudget(ship)).toBe(10)
  })

  it('shrinks with hull damage but never below 40% of rated', () => {
    const ship = createShip('p', 'Test', 'fed-cruiser', { x: 0, y: 0 }, 0)
    ship.hull = 50
    expect(powerBudget(ship)).toBe(7)
    ship.hull = 0
    expect(powerBudget(ship)).toBe(4)
  })
})

describe('isValidAllocation', () => {
  it('accepts allocations within budget and per-system max', () => {
    expect(isValidAllocation({ engines: 3, shields: 3, weapons: 3, sensors: 1 }, 10)).toBe(true)
  })

  it('rejects over-budget totals', () => {
    expect(isValidAllocation({ engines: 4, shields: 4, weapons: 4, sensors: 0 }, 10)).toBe(false)
  })

  it('rejects per-system overload and non-integers', () => {
    expect(isValidAllocation({ engines: 5, shields: 0, weapons: 0, sensors: 0 }, 10)).toBe(false)
    expect(isValidAllocation({ engines: 1.5, shields: 0, weapons: 0, sensors: 0 }, 10)).toBe(false)
    expect(isValidAllocation({ engines: -1, shields: 0, weapons: 0, sensors: 0 }, 10)).toBe(false)
  })
})

describe('clampAllocation', () => {
  it('passes valid allocations through', () => {
    const p = { engines: 2, shields: 3, weapons: 3, sensors: 2 }
    expect(clampAllocation(p, 10)).toEqual(p)
  })

  it('sheds sensors first, then weapons, shields, engines', () => {
    const p = clampAllocation({ engines: 4, shields: 4, weapons: 4, sensors: 4 }, 10)
    expect(p).toEqual({ engines: 4, shields: 4, weapons: 2, sensors: 0 })
  })

  it('clamps per-system overloads and garbage', () => {
    const p = clampAllocation({ engines: 99, shields: -3, weapons: 2.9, sensors: NaN }, 10)
    expect(p.engines).toBe(POWER_MAX_PER_SYSTEM)
    expect(p.shields).toBe(0)
    expect(p.weapons).toBe(2)
    expect(p.sensors).toBe(0)
  })
})

describe('systemFactor', () => {
  it('is 1.0 at nominal power and full health', () => {
    const ship = createShip('p', 'Test', 'fed-cruiser', { x: 0, y: 0 }, 0)
    ship.power = { engines: 2, shields: 2, weapons: 2, sensors: 2 }
    expect(systemFactor(ship, 'weapons')).toBe(1)
  })

  it('scales with power: 0 → 0.5×, 4 → 1.5×', () => {
    const ship = createShip('p', 'Test', 'fed-cruiser', { x: 0, y: 0 }, 0)
    ship.power = { engines: 0, shields: 2, weapons: 4, sensors: 2 }
    expect(systemFactor(ship, 'engines')).toBe(0.5)
    expect(systemFactor(ship, 'weapons')).toBe(1.5)
  })

  it('scales with subsystem health and dies at hp 0', () => {
    const ship = createShip('p', 'Test', 'fed-cruiser', { x: 0, y: 0 }, 0)
    ship.power = { engines: 2, shields: 2, weapons: 2, sensors: 2 }
    ship.subsystems.weapons.hp = ship.subsystems.weapons.maxHp / 2
    expect(systemFactor(ship, 'weapons')).toBe(0.5)
    ship.subsystems.weapons.hp = 0
    expect(systemFactor(ship, 'weapons')).toBe(0)
  })
})
