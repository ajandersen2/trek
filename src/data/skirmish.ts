// Skirmish mode content: which classes are playable and what the duelists fly.

export interface SkirmishShipOption {
  classId: string
  /** Ship name for seat A / seat B (B gets the second so mirror matches differ). */
  names: [string, string]
  blurb: string
}

export const SKIRMISH_SHIPS: readonly SkirmishShipOption[] = [
  {
    classId: 'fed-cruiser',
    names: ['USS Farragut', 'USS Reliant'],
    blurb: 'Tough all-rounder. 270° phasers, deep shields, superior sensors.',
  },
  {
    classId: 'klingon-bop',
    names: ['IKS Vengeance', 'IKS Bloodwing'],
    blurb: 'Cloaked knife-fighter. Strike from nowhere; never linger.',
  },
  {
    classId: 'klingon-ktinga',
    names: ["IKS Fek'lhr", "IKS Gr'oth"],
    blurb: 'Battlecruiser. Slow, brutal, batteries on every quarter.',
  },
  {
    classId: 'klingon-raptor',
    names: ['IKS Talon', 'IKS Swiftwind'],
    blurb: 'Scout. Fast slashing runs; fragile if caught mid-turn.',
  },
]
