import type { PlayerProfile } from '../contracts/types'

export interface CreatePlayerInput {
  name: string
  color: string
  /** Cropped avatar as a data URL (canvas toDataURL()/toBlob() output), or omitted for the initials-only default. */
  avatarDataUrl?: string
}

export interface UpdatePlayerInput {
  id: string
  name?: string
  color?: string
  avatarDataUrl?: string
  /** Party-session stats, written back after a song completes. */
  songsSung?: number
  bestScore?: number
}

export type { PlayerProfile }
