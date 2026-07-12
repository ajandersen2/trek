// Balance constants for the encounter sim. Tune here, not inline.

export const BASE_PHASER_ACCURACY = 0.8
/** acc *= 0.6 + 0.4 * sensorFactor (sensorFactor capped below). */
export const ACCURACY_SENSOR_WEIGHT = 0.4
export const ACCURACY_SENSOR_FLOOR = 0.6
export const SENSOR_FACTOR_CAP = 1.25
/** Max accuracy penalty from target speed. */
export const EVASION_COEFF = 0.3
/** Firing-solution bonus against a scanned (scanLevel >= 1) target. */
export const SCANNED_ACCURACY_BONUS = 0.1
export const MIN_HIT_CHANCE = 0.05
export const MAX_HIT_CHANCE = 0.95
/** Phaser damage falls to this fraction at max range. */
export const PHASER_MAX_RANGE_DAMAGE = 0.65
/** Untargeted hull damage has this chance to also hit a random subsystem... */
export const COLLATERAL_CHANCE = 0.35
/** ...for this fraction of the hull damage. */
export const COLLATERAL_RATIO = 0.5
/** Minimum distance to the nearest living enemy before warping out. */
export const WARP_OUT_MIN_RANGE = 15
/** Engineering field repair per round (triage, not a shipyard). */
export const REPAIR_HP_PER_ROUND = 8
/** Impulse throttle steps (0..4 = quarters of max speed). */
export const THROTTLE_MAX = 4

// --- Cloaking device ---------------------------------------------------------
/** Rounds after a decloak before the cloak can be re-engaged. */
export const CLOAK_COOLDOWN_ROUNDS = 2
/** Tachyon sweep: base chance to force a cloaked ship to decloak... */
export const SWEEP_BASE_CHANCE = 0.25
/** ...plus this much per point of the sweeping ship's sensor power. */
export const SWEEP_PER_SENSOR_POWER = 0.08
/** Sweeps only bite inside this range. */
export const SWEEP_RANGE = 10
/** Failed sweeps inside this range still yield a rough contact bearing. */
export const GHOST_BEARING_RANGE = 14
