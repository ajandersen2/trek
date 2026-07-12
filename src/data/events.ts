// Travel flavor events and random-encounter data. Content, not code.

export const TRAVEL_FLAVOR: readonly string[] = [
  'Long-range sensors log a micro-quasar flare in the Hromi Cluster. Science is delighted.',
  'Passing freighter SS Chin’toka requests a time check and wishes us "smooth vacuum."',
  'A calibration ghost puts a phantom contact on tactical for three seconds. Nerves.',
  'Subspace relay 47-C repeats yesterday’s news. The replicators still refuse to make good raktajino.',
  'We thread a drifting comet cluster. Helm logs it as "scenic route."',
  'Engineering runs warp coil diagnostics. Efficiency up 0.4%. The chief is insufferable.',
  'A Federation survey buoy pings us: all quiet on this heading.',
]

export const PATROL_SHIP_NAMES: readonly string[] = ['IKS Marauder', 'IKS Bloodwing', 'IKS Korvat']

/** Chance per jump of a Klingon patrol intercept (not at starbases). */
export const RANDOM_ENCOUNTER_CHANCE = 0.12
/** Chance per jump of a flavor log entry when nothing worse happens. */
export const FLAVOR_EVENT_CHANCE = 0.3
