import type { PlayerProfile } from '../contracts/types'
import type { CreatePlayerInput, UpdatePlayerInput } from './types'

// Guarded (unlike the other actions below) because several screens call this
// unconditionally on mount, including in contexts with no Electron preload
// (browser preview) -- matches multiplayer/api.ts's listMicSlots()
// convention for the same reason. Guarded at `players` too, not just `api`: a
// partial preload leaves the object there with the namespace missing.
export function list(): Promise<PlayerProfile[]> {
  return window.api?.players?.list() ?? Promise.resolve([])
}

export function create(input: CreatePlayerInput): Promise<PlayerProfile> {
  return window.api!.players.create(input)
}

export function update(input: UpdatePlayerInput): Promise<PlayerProfile> {
  return window.api!.players.update(input)
}

export function deletePlayer(id: string): Promise<void> {
  return window.api!.players.delete(id)
}

export function reorder(orderedIds: string[]): Promise<void> {
  return window.api!.players.reorder(orderedIds)
}

export function readImportedPhoto(path: string): Promise<string> {
  return window.api!.players.readImportedPhoto(path)
}
