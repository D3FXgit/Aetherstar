import { useEffect, useMemo } from 'react'
import { motion, type MotionValue } from 'framer-motion'
import type { SongLine, SongMeta } from '../contracts/types'
import { usePlayersStore } from '../players/store'
import { micRimColor } from '../design/tokens'
import { Gameplay, LOCAL_PLAYER_ID_FALLBACK } from '../game/Gameplay'
import { LanePanel } from '../game/lane/LanePanel'
import { LanePagingContext, useLanePagingValue } from '../game/lane/LanePagingContext'
import { laneGapPx, laneHeightForPlayerCount } from '../game/lane/laneStack'
import { MicStatusPill } from '../game/hud/MicStatusPill'
import { ScoreColumn, type ScoreEntry } from '../game/hud/ScoreColumn'
import { useScoreStore } from '../game/state/useScoreStore'
import { useHitStore } from '../game/state/useHitStore'
import { useInstrumentalFade } from '../game/useInstrumentalFade'
import { useSessionStore } from '../session/sessionStore'
import { TugOfWarBar } from '../session/duel/TugOfWarBar'
import { useStageClockContext } from '../stage/timing/StageClockContext'
import { linesForLane } from './laneParts'
import { useLaneColorsStore } from './laneColors'
import {
  STAGE_GRID_CLASS,
  STAGE_LANE_CELL,
  STAGE_SCORE_COLUMN_CELL,
  STAGE_STATUS_CELL,
} from '../stage/layout'
import { useMicSlotStore } from './store'
import { captureKeyOfSlot } from './captureKey'
import { claimableMicNumbers } from './slots'
import { isConfigured } from './types'

/** The name this component holds its capture claim under (see `acquireCaptures`). */
export const GAMEPLAY_CAPTURE_OWNER = 'gameplay'

interface MultiplayerGameplayProps {
  meta: SongMeta
  lines: SongLine[]
  beatPosition: MotionValue<number>
  /**
   * The singers picked for this song, in the order they were picked -- which is
   * the order they claimed microphones in (see slots.ts). Empty/undefined (the
   * Dev Lab, which never runs the assign phase) falls back to one lane per
   * configured mic.
   */
  assignedPlayerIds?: string[]
}

/** No lines: what this layer hands its own fade when Stage already computes one. */
const NO_LINES: SongLine[] = []

interface LaneLayer {
  playerId: string
  /** The *mic number* this lane is, 1-based. Its colour and its label both come from it. */
  micNumber: number
  captureKey: string | undefined
}

/**
 * The singer view's gameplay half -- one floating pitch lane per singer, a
 * score card per singer down the right edge, the mic status pill -- drawn into
 * the same grid Stage uses (src/stage/layout.ts).
 *
 * A lane's identity is a **microphone**: its number, its colour and the capture
 * its pitch comes from all resolve from the claim order over
 * `claimableMicNumbers`, so they match what Player Selection showed. The lanes
 * paint no background; the song's video is the backdrop.
 */
export function MultiplayerGameplay({ meta, lines, beatPosition, assignedPlayerIds }: MultiplayerGameplayProps) {
  const players = usePlayersStore((state) => state.players)
  const slots = useMicSlotStore((state) => state.slots)

  /**
   * The song's capture claim: the configured mics are live exactly while a song
   * is on screen. `load()` runs alongside so it works even when no screen that
   * reads the mic configuration was visited; the claim is recorded first, so
   * slots arriving a tick later start through the same sync.
   */
  useEffect(() => {
    const store = useMicSlotStore.getState()
    void store.acquireCaptures(GAMEPLAY_CAPTURE_OWNER)
    void store.load()
    return () => {
      void store.releaseCaptures(GAMEPLAY_CAPTURE_OWNER)
    }
  }, [])

  const configuredSlots = useMemo(() => slots.filter(isConfigured), [slots])
  const hasHardware = configuredSlots.length > 0

  // With no routing configured at all there is still exactly one singer: the
  // first assigned player, else roster index 0 -- the same player Gameplay
  // resolves internally on that path, so its card and its lane agree.
  const fallbackPlayerId = assignedPlayerIds?.[0] ?? players[0]?.id ?? LOCAL_PLAYER_ID_FALLBACK

  // Memoized so its identity is stable across re-renders that don't actually
  // change the lanes -- otherwise the score-reset effect below would re-fire on
  // every unrelated re-render and wipe the scores back to zero mid-song.
  const laneLayers: LaneLayer[] = useMemo(() => {
    // No routing configured at all: exactly one lane, whoever was picked. This
    // has to come before the assignment branch -- with nothing configured
    // `claimableMicNumbers` offers all eight mics (so a fresh install can still
    // pick singers), and building one lane per pick would hand N lanes the same
    // default capture and pile every score onto one card. The audience window
    // collapses the same way (see audienceLanes.ts).
    if (!hasHardware) return [{ playerId: fallbackPlayerId, micNumber: 1, captureKey: undefined }]

    const claimable = claimableMicNumbers(slots)
    const slotFor = (micNumber: number) => slots.find((slot) => slot.slotNumber === micNumber)

    if (assignedPlayerIds && assignedPlayerIds.length > 0) {
      return assignedPlayerIds.slice(0, claimable.length).map((playerId, index) => {
        const micNumber = claimable[index]
        const slot = slotFor(micNumber)
        return { playerId, micNumber, captureKey: (slot && captureKeyOfSlot(slot)) ?? undefined }
      })
    }

    // No assign phase ran (the Dev Lab). One lane per configured mic, handed to
    // the roster in order purely so each lane has a score card to write to.
    return configuredSlots.map((slot, index) => ({
      playerId: players[index]?.id ?? `mic-${slot.slotNumber}`,
      micNumber: slot.slotNumber,
      captureKey: captureKeyOfSlot(slot) ?? undefined,
    }))
  }, [assignedPlayerIds, slots, configuredSlots, hasHardware, players, fallbackPlayerId])

  /**
   * Every song starts -- and ends -- with an empty hit history, whatever the
   * rig. With configured mics the lanes leave seeding to this layer, so nothing
   * else clears it between songs: the next song's tallies and best line would
   * start from the last one's, and the television would be sent the last
   * song's judgements under the same `note-N` ids (see audienceBroadcast.ts).
   */
  useEffect(() => {
    useHitStore.getState().reset()
    return () => useHitStore.getState().reset()
  }, [lines])

  useEffect(() => {
    if (!hasHardware) return
    useScoreStore.getState().reset({
      players: laneLayers.map((layer, index) => {
        const profile = players.find((p) => p.id === layer.playerId)
        return { playerId: layer.playerId, name: profile?.name ?? `Player ${index + 1}`, score: 0, combo: 0, rank: index + 1 }
      }),
      combo: 0,
      rank: laneLayers.map((layer) => layer.playerId),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-seed once per lane set/chart, not on every render
  }, [laneLayers, lines])

  const laneHeightPx = laneHeightForPlayerCount(laneLayers.length)

  // The lyric box highlights in the singers' colours (see laneColors.ts).
  useEffect(() => {
    useLaneColorsStore.getState().setColors(laneLayers.map((layer) => micRimColor(layer.micNumber - 1)))
  }, [laneLayers])
  useEffect(() => () => useLaneColorsStore.getState().setColors([]), [])

  const renderLane = (layer: LaneLayer, index: number) => (
    <MultiplayerLane
      key={layer.playerId}
      layer={layer}
      // Which lines this singer sings: shared with the audience window (see
      // laneParts.ts) so a broadcast note id names the same note on both
      // screens. The no-hardware fallback is lane 0 -- P1 in a duet.
      lines={linesForLane(lines, index)}
      meta={meta}
      beatPosition={beatPosition}
      singerName={players.find((p) => p.id === layer.playerId)?.name ?? null}
      // Always this lane's own singer: Gameplay scores only `[0]`, so handing
      // every lane the whole line-up would score them all as singer 1.
      assignedPlayerIds={[layer.playerId]}
      seedStores={!hasHardware}
      laneHeightPx={laneHeightPx}
    />
  )

  /**
   * The instrumental fade: Stage's, from its clock context, so the lanes and the
   * lyric box are one MotionValue. Outside a Stage (the Dev Lab) this layer
   * derives its own.
   */
  const stageClock = useStageClockContext()
  const ownOpacity = useInstrumentalFade(stageClock ? NO_LINES : lines, meta.bpm, beatPosition)
  const laneOpacity = stageClock?.instrumentalOpacity ?? ownOpacity

  /** Score cards stack in the same order the lanes do, so a card sits near its lane. */
  const scoreEntries: ScoreEntry[] = laneLayers.map((layer) => ({
    playerId: layer.playerId,
    micNumber: layer.micNumber,
  }))

  const sessionMode = useSessionStore((state) => state.mode)

  return (
    <div className={`${STAGE_GRID_CLASS} pointer-events-none`} data-testid="gameplay-overlay">
      <motion.div
        data-testid="lane-stack"
        data-lane-count={laneLayers.length}
        className={`${STAGE_LANE_CELL} flex flex-col`}
        style={{ gap: `${laneGapPx(laneLayers.length)}px`, opacity: laneOpacity }}
      >
        {sessionMode === 'battle' && laneLayers.length >= 2 && (
          <div className="mb-2 self-center w-full max-w-xl pointer-events-auto">
            <TugOfWarBar
              player1Id={laneLayers[0].playerId}
              player2Id={laneLayers[1].playerId}
              player1Color={micRimColor(laneLayers[0].micNumber - 1)}
              player2Color={micRimColor(laneLayers[1].micNumber - 1)}
            />
          </div>
        )}

        {laneLayers.map(renderLane)}
      </motion.div>

      <div className={STAGE_SCORE_COLUMN_CELL}>
        <ScoreColumn entries={scoreEntries} />
      </div>

      <div className={STAGE_STATUS_CELL}>
        <MicStatusPill />
      </div>
    </div>
  )
}

/**
 * One singer's lane: its line paging (see linePaging.ts), the lane chrome,
 * and the gameplay layer, drawn on the paging's live pitch scale so the pitch
 * rule and the sustain spark follow the page that is up.
 */
function MultiplayerLane({
  layer,
  lines,
  meta,
  beatPosition,
  singerName,
  assignedPlayerIds,
  seedStores,
  laneHeightPx,
}: {
  layer: LaneLayer
  lines: SongLine[]
  meta: SongMeta
  beatPosition: MotionValue<number>
  singerName: string | null
  assignedPlayerIds: string[] | undefined
  seedStores: boolean
  laneHeightPx: number
}) {
  const color = micRimColor(layer.micNumber - 1)
  const paging = useLanePagingValue(lines, meta.bpm, beatPosition)

  return (
    <div data-testid={`multiplayer-lane-${layer.playerId}`} data-player-color={color} data-slot-number={layer.micNumber}>
      <LanePagingContext.Provider value={paging}>
        <LanePanel slotNumber={layer.micNumber} singerName={singerName} accentColor={color} laneHeightPx={laneHeightPx}>
          <Gameplay
            meta={meta}
            lines={lines}
            beatPosition={beatPosition}
            assignedPlayerIds={assignedPlayerIds}
            deviceId={layer.captureKey}
            seedStores={seedStores}
            pitchScale={paging.liveScale}
            laneHeightPx={laneHeightPx}
            accentColor={color}
          />
        </LanePanel>
      </LanePagingContext.Provider>
    </div>
  )
}
