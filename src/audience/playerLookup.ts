import type { PlayerProfile } from '../contracts/types'

export function fetchPlayerProfiles(): Promise<PlayerProfile[]> {
  return window.api!.players.list()
}

export function buildProfileMap(profiles: PlayerProfile[]): Map<string, PlayerProfile> {
  return new Map(profiles.map((profile) => [profile.id, profile]))
}
