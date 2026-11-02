// `party-draw` phase (Mystery Roulette): singers are drawn fairly, least-sung
// first, and offered a handful of mystery songs to pick from. Passing a mic
// swaps in someone from the bench and re-deals the songs.
import { AnimatePresence } from 'framer-motion'
import { useT } from '../i18n'
import { useSceneStore } from '../scenes/sceneStore'
import { du } from '../scenes/designUnits'
import { useSongPreviewStore } from '../audio/songPreviewStore'
import { useSessionStore } from './sessionStore'
import {
  BUTTON_HOVER_CLASS,
  SESSION_COLORS,
  TEXT,
  displayType,
  primaryButtonStyle,
} from './sessionTheme'
import { PartyDrawFrame, PartyNotice } from './partyDraw/PartyDrawFrame'
import { PartyModeSwitcher, PlayerCountPicker } from './partyDraw/PartyControls'
import { PartySongGallery } from './partyDraw/PartySongGallery'
import { useSongBests } from './partyDraw/useSongBests'
import { micColor } from '../design/tokens'
import { SingerSlotCard } from './partyDraw/SingerSlotCard'
import { usePartyRound } from './partyDraw/usePartyRound'

function SectionHeading({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-wrap items-baseline" style={{ gap: du(14) }}>
      <h2 style={displayType(28, { fontWeight: 800 })}>{title}</h2>
      <span style={{ fontSize: `max(0.875rem, ${du(16)})`, color: TEXT.tertiary, fontWeight: 600 }}>{hint}</span>
    </div>
  )
}

export function SessionPartyDraw() {
  const t = useT()
  const setMode = useSessionStore((state) => state.setMode)
  const round = usePartyRound()
  const { status, roundState, selectedSong, players } = round
  // Hooks before any early return: an empty list fetches nothing.
  const bests = useSongBests((roundState?.offeredSongs ?? []).map((song) => song.path))

  if (status === 'loading') {
    return (
      <PartyDrawFrame>
        <PartyNotice title={t('party.loading')} />
      </PartyDrawFrame>
    )
  }

  if (status === 'no-mics' || status === 'no-players') {
    const noMics = status === 'no-mics'
    return (
      <PartyDrawFrame>
        <PartyNotice
          title={t(noMics ? 'party.noMics.title' : 'party.noPlayers.title')}
          description={t(noMics ? 'party.noMics.description' : 'party.noPlayers.description')}
          action={
            <button
              type="button"
              className={BUTTON_HOVER_CLASS}
              style={primaryButtonStyle()}
              onClick={() => useSceneStore.getState().navigate(noMics ? 'hardware-setup' : 'players')}
            >
              {t(noMics ? 'party.noMics.action' : 'party.noPlayers.action')}
            </button>
          }
        />
      </PartyDrawFrame>
    )
  }

  const offered = roundState?.offeredSongs ?? []
  // The pick is painted in the first drawn singer's mic colour.
  const accentColor = micColor(round.claimable[0] ?? 1)

  return (
    <PartyDrawFrame
      trailing={
        <PartyModeSwitcher
          onSwitch={(mode) => {
            useSongPreviewStore.getState().clearPreview()
            setMode(mode)
          }}
        />
      }
    >
      {/* Gives way first on a short window: the strip scrolls, the songs keep their room. */}
      <section className="flex min-h-0 shrink flex-col" style={{ gap: du(12) }} data-testid="party-singers">
        <div className="flex shrink-0 flex-wrap items-center justify-between" style={{ gap: du(16) }}>
          <SectionHeading title={t('party.singers.title')} hint={t('party.singers.hint')} />
          {round.maxSelectable > 1 && (
            <PlayerCountPicker max={round.maxSelectable} value={round.activePlayerCount} onChange={round.changePlayerCount} />
          )}
        </div>
        {/* `relative`: popLayout lifts a leaving card out of the flow at once and
            pins it absolutely, which needs a positioned parent -- without one it
            is pinned against some ancestor and visibly jumps while it fades. A
            stable scrollbar gutter, so a scrollbar appearing on a short window
            cannot narrow the strip, re-wrap the cards and resize the gallery again. */}
        <div
          className="relative flex min-h-0 flex-wrap items-center overflow-y-auto"
          style={{ gap: du(20), scrollbarGutter: 'stable' }}
          data-testid="party-singers-strip"
        >
          <AnimatePresence mode="popLayout">
            {roundState?.assignedPlayerIds.map((playerId, slotIndex) => {
              const player = players.find((p) => p.id === playerId)
              return (
                <SingerSlotCard
                  key={`singer-slot-${slotIndex}-${playerId}`}
                  slotIndex={slotIndex}
                  name={player?.name ?? null}
                  avatarUrl={player?.avatarUrl ?? ''}
                  micNumber={round.claimable[slotIndex] ?? slotIndex + 1}
                  timesSung={round.sessionSingCounts[playerId] ?? 0}
                  canPass={round.canPass(slotIndex)}
                  onPass={() => round.passMic(slotIndex)}
                />
              )
            })}
          </AnimatePresence>
        </div>
      </section>

      {/* Everything left over is the gallery's; see partyDraw/galleryLayout.ts. */}
      <section className="flex flex-1 flex-col" style={{ gap: du(4) }} data-testid="party-songs">
        <SectionHeading title={t('party.songs.title', { count: offered.length })} hint={t('party.songs.hint')} />
        <PartySongGallery
          songs={offered}
          selectedPath={selectedSong?.path ?? null}
          accentColor={accentColor}
          bests={bests}
          holderName={(playerId) => players.find((p) => p.id === playerId)?.name ?? null}
          onSelect={round.selectSong}
          onQuickStart={(song) => round.start(song)}
          onPreview={round.previewSong}
        />
      </section>

      <footer className="flex shrink-0 items-center justify-between" style={{ gap: du(24) }} data-testid="party-footer">
        <p className="truncate" style={{ fontSize: `max(1rem, ${du(20)})`, fontWeight: 700, color: TEXT.secondary }}>
          {selectedSong ? t('party.footer.upNext', { title: selectedSong.title }) : t('party.footer.pick')}
        </p>
        <button
          type="button"
          disabled={!selectedSong}
          onClick={() => round.start()}
          data-testid="party-start-button"
          className={BUTTON_HOVER_CLASS}
          style={primaryButtonStyle(
            undefined,
            selectedSong
              ? { padding: `${du(18)} ${du(48)}` }
              : { padding: `${du(18)} ${du(48)}`, background: SESSION_COLORS.raised, color: TEXT.tertiary, cursor: 'not-allowed' },
          )}
        >
          {t('party.start')}
        </button>
      </footer>
    </PartyDrawFrame>
  )
}
