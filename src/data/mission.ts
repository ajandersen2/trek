// M1 authored mission: "The Veyra Distress Call". One episode's worth of content.

export const MISSION_ID = 'm1-veyra-distress'
export const MISSION_TITLE = 'The Veyra Distress Call'

export const MISSION_BRIEFING: readonly string[] = [
  'INCOMING — PRIORITY ONE — STARBASE 4 OPERATIONS',
  'Distress call from Veyra Colony: a Klingon Bird-of-Prey is raiding the mining settlement.',
  'Orbital phaser battery is down. 4,000 colonists are counting on us, Captain.',
  'Orders: proceed to Veyra and stop the raider. How you stop it is your call.',
]

export const MISSION_ENEMY_NAME = 'IKS Vengeance'

export const MISSION_RESOLUTION: Record<string, readonly string[]> = {
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
}

export const MISSION_WITHDRAWN_LINE =
  'We broke off the engagement. The colony is still under threat — we must return to Veyra.'
