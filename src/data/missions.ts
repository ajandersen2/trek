// Authored missions. Content is data — src/sim/game.ts interprets triggers,
// activation chains, and resolution text. Adding an episode means adding an
// entry here, not code.

import type { EncounterStatus } from '../sim/types'

export type MissionTrigger =
  | { type: 'at-system'; systemId: string }
  /** Fires on arrival anywhere (except starbases) after N jumps since activation. */
  | { type: 'intercept-after'; jumps: number }

export interface MissionDef {
  id: string
  title: string
  /** Log lines shown when the mission activates. */
  briefing: readonly string[]
  trigger: MissionTrigger
  enemyClassId: string
  enemyName: string
  /** Extra log lines when the encounter begins. */
  contact: readonly string[]
  /** Mission id that must resolve before this one activates; null = active at campaign start. */
  activateAfter: string | null
  resolution: Partial<Record<EncounterStatus, readonly string[]>>
  /** Line shown when the player disengages without resolving. */
  withdrawnLine: string
}

export const MISSION_DEFS: readonly MissionDef[] = [
  {
    id: 'm1-veyra-distress',
    title: 'The Veyra Distress Call',
    briefing: [
      'INCOMING — PRIORITY ONE — STARBASE 4 OPERATIONS',
      'Distress call from Veyra Colony: a Klingon Bird-of-Prey is raiding the mining settlement.',
      'Orbital phaser battery is down. 4,000 colonists are counting on us, Captain.',
      'Orders: proceed to Veyra and stop the raider. How you stop it is your call.',
    ],
    trigger: { type: 'at-system', systemId: 'veyra' },
    enemyClassId: 'klingon-bop',
    enemyName: 'IKS Vengeance',
    contact: [
      'IKS Vengeance is firing on the colony. It is coming about to face us.',
      'RED ALERT. All stations, battle orders.',
    ],
    activateAfter: null,
    resolution: {
      victory: [
        'The Vengeance breaks apart over Veyra II. The colony is safe.',
        'Starbase 4 sends congratulations — though Command notes the Empire will want an answer for this.',
      ],
      'enemy-disabled': [
        'The Vengeance drifts, weapons dark, engines cold. Its captain accepts internment over destruction.',
        'Veyra Colony is safe. Starfleet Command commends the restraint — a crew captured, not killed.',
      ],
      'enemy-withdrawn': [
        'The raider limps into warp and runs for the border. Veyra Colony is safe — for now.',
        'Starbase 4 logs the incursion. Patrols along the Gasko line are doubled.',
      ],
    },
    withdrawnLine:
      'We broke off the engagement. The colony is still under threat — we must return to Veyra.',
  },
  {
    id: 'm2-fek-lhr',
    title: "The Fek'lhr Is Hunting",
    briefing: [
      'FLASH TRAFFIC — STARBASE 4 INTELLIGENCE',
      'The High Council has named the Veyra incident an insult to the Empire.',
      "The battlecruiser IKS Fek'lhr crossed the border six hours ago. Her captain has our warp signature.",
      'There will be no outrunning this one, Captain. Choose the ground where she finds us.',
    ],
    trigger: { type: 'intercept-after', jumps: 3 },
    enemyClassId: 'klingon-ktinga',
    enemyName: "IKS Fek'lhr",
    contact: [
      "Massive disruption wake closing fast — the Fek'lhr has found us.",
      'A K\'t\'inga-class battlecruiser. Twice our tonnage. RED ALERT.',
    ],
    activateAfter: 'm1-veyra-distress',
    resolution: {
      victory: [
        "The Fek'lhr's core breaches in a white sphere of light. The hunt is over.",
        'Starbase 4 is quiet on the channel for a long moment. Then: "Understood, Farragut. Come home."',
      ],
      'enemy-disabled': [
        "The Fek'lhr hangs dead in space, her batteries silent. Her captain, improbably, is laughing.",
        '"Well fought, Federation. The Council will argue about you for a year." The hunt is over.',
      ],
      'enemy-withdrawn': [
        "Bleeding plasma, the Fek'lhr comes about and limps for the border. The hunt is over — her captain will not report this as a victory.",
      ],
    },
    withdrawnLine:
      "We slipped away this time. The Fek'lhr is still out there, hunting.",
  },
]

export function getMissionDef(id: string): MissionDef {
  const def = MISSION_DEFS.find((m) => m.id === id)
  if (!def) throw new Error(`unknown mission: ${id}`)
  return def
}
