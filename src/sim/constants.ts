// Balance constants for the encounter sim. Tune here, not inline.

export const BASE_PHASER_ACCURACY = 0.85
/** acc *= 0.6 + 0.4 * sensorFactor (sensorFactor capped below). */
export const ACCURACY_SENSOR_WEIGHT = 0.4
export const ACCURACY_SENSOR_FLOOR = 0.6
export const SENSOR_FACTOR_CAP = 1.25
/** Max accuracy penalty from target speed. */
export const EVASION_COEFF = 0.3
export const MIN_HIT_CHANCE = 0.05
export const MAX_HIT_CHANCE = 0.95
/** Phaser damage falls to this fraction at max range. */
export const PHASER_MAX_RANGE_DAMAGE = 0.5
/** Untargeted hull damage has this chance to also hit a random subsystem... */
export const COLLATERAL_CHANCE = 0.35
/** ...for this fraction of the hull damage. */
export const COLLATERAL_RATIO = 0.5
/** Minimum distance to the nearest living enemy before warping out. */
export const WARP_OUT_MIN_RANGE = 15
/** Engineering field repair per round. */
export const REPAIR_HP_PER_ROUND = 12
/** Impulse throttle steps (0..4 = quarters of max speed). */
export const THROTTLE_MAX = 4
