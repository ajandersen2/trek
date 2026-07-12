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

/** Random patrol composition: weighted class mix with name pools. */
export interface PatrolEntry {
  classId: string
  names: readonly string[]
  weight: number
}

export const PATROL_TABLE: readonly PatrolEntry[] = [
  {
    classId: 'klingon-raptor',
    names: ['IKS Swiftwind', 'IKS Talon', 'IKS Vekma'],
    weight: 5,
  },
  {
    classId: 'klingon-bop',
    names: ['IKS Marauder', 'IKS Bloodwing', 'IKS Korvat'],
    weight: 3,
  },
  {
    classId: 'klingon-ktinga',
    names: ['IKS Gr\'oth', 'IKS Amar'],
    weight: 2,
  },
]

/** Chance per jump of a Klingon patrol intercept (not at starbases). */
export const RANDOM_ENCOUNTER_CHANCE = 0.12
/** Chance per jump of a flavor log entry when nothing worse happens. */
export const FLAVOR_EVENT_CHANCE = 0.3
