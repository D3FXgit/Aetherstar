import { create } from 'zustand'
import type { PlayerProfile } from '../contracts/types'
import type { CreatePlayerInput, UpdatePlayerInput } from './types'
import * as api from './api'

interface PlayersStoreState {
  players: PlayerProfile[]
  load: () => Promise<void>
  create: (input: CreatePlayerInput) => Promise<void>
  update: (input: UpdatePlayerInput) => Promise<void>
  delete: (id: string) => Promise<void>
  reorder: (orderedIds: string[]) => Promise<void>
}

export const usePlayersStore = create<PlayersStoreState>((set, get) => ({
  players: [],

  load: async () => {
    set({ players: await api.list() })
  },
  create: async (input) => {
    await api.create(input)
    await get().load()
  },
  update: async (input) => {
    await api.update(input)
    await get().load()
  },
  delete: async (id) => {
    await api.deletePlayer(id)
    await get().load()
  },
  reorder: async (orderedIds) => {
    await api.reorder(orderedIds)
    await get().load()
  },
}))
