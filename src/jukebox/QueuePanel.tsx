// The "Up next" panel: the queue with cover, title and artist; move up/down,
// remove, clear; "Add songs" (the in-place song browser); and the autoplay
// switch. Glass, because it floats over the video. Toggled with the transport
// bar's queue button, Q or gamepad Y; Back closes it.
import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useT } from '../i18n'
import { Panel } from '../design/primitives/GlassPanel'
import { Button } from '../design/primitives/GlassButton'
import { GlassToggle } from '../design/primitives/GlassToggle'
import { springTransition } from '../design/tokens'
import { useSessionStore } from '../session/sessionStore'
import { useJukeboxUiStore } from './jukeboxUiStore'
import { songByline } from './queueLogic'
import { SongThumb } from './SongThumb'
import { TransportButton } from './TransportButton'
import { ArrowDownIcon, ArrowUpIcon, CloseIcon, PlusIcon } from './icons'

type ItemAction = 'up' | 'down' | 'remove'

export function QueuePanel() {
  const t = useT()
  const reduceMotion = useReducedMotion() ?? false
  const titleId = useId()
  const queue = useSessionStore((state) => state.jukeboxQueue)
  const autoplay = useSessionStore((state) => state.jukeboxAutoplay)
  const repeat = useSessionStore((state) => state.jukeboxRepeat)
  const listRef = useRef<HTMLOListElement>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  /** Where focus goes once the list has re-rendered after a move or a removal. */
  const pendingFocusRef = useRef<{ index: number; action: ItemAction } | null>(null)

  useEffect(() => {
    addRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const pending = pendingFocusRef.current
    if (!pending) return
    pendingFocusRef.current = null
    if (queue.length === 0) {
      addRef.current?.focus()
      return
    }
    const index = Math.min(pending.index, queue.length - 1)
    const row = listRef.current?.querySelector<HTMLElement>(`[data-queue-index="${index}"]`)
    const wanted = row?.querySelector<HTMLButtonElement>(`[data-queue-action="${pending.action}"]:not([disabled])`)
    ;(wanted ?? row?.querySelector<HTMLButtonElement>('[data-queue-action="remove"]') ?? addRef.current)?.focus()
  }, [queue])

  const session = useSessionStore.getState
  const act = (index: number, action: ItemAction) => {
    if (action === 'remove') {
      pendingFocusRef.current = { index, action }
      session().removeFromJukeboxQueue(index)
      return
    }
    const delta = action === 'up' ? -1 : 1
    pendingFocusRef.current = { index: index + delta, action }
    session().moveJukeboxQueueItem(index, delta)
  }

  const emptyHint = repeat === 'all' ? t('jukebox.queue.emptyHintRepeat') : autoplay ? t('jukebox.queue.emptyHintAutoplay') : null

  return (
    <motion.div
      // Ends above the transport bar (which stays up while the panel is open), so its controls stay reachable.
      className="absolute right-0 top-0 bottom-[var(--jukebox-transport-h,0px)] z-30 flex w-[min(38rem,92vw)] px-[clamp(1rem,2.5vw,3rem)] pt-[clamp(1rem,2.5vw,2.5rem)] pb-3"
      initial={reduceMotion ? false : { opacity: 0, x: 48 }}
      animate={{ opacity: 1, x: 0 }}
      transition={springTransition('panelEnter', reduceMotion)}
    >
      <Panel
        variant="glass"
        role="dialog"
        aria-labelledby={titleId}
        data-focus-scope
        data-testid="jukebox-queue-panel"
        className="flex min-h-0 w-full flex-col gap-4 rounded-3xl p-6 shadow-2xl"
      >
        <header className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-2xl font-bold text-ink-primary">
              {t('jukebox.upNext')}
            </h2>
            <div className="text-base text-ink-secondary" data-testid="jukebox-queue-count">
              {t('jukebox.queue.count', { count: queue.length })}
            </div>
          </div>
          <TransportButton
            size="sm"
            sfx="back"
            label={t('jukebox.queue.close')}
            data-testid="jukebox-queue-close"
            onClick={() => useJukeboxUiStore.getState().setQueueOpen(false)}
          >
            <CloseIcon />
          </TransportButton>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            ref={addRef}
            type="button"
            variant="primary"
            sfx="confirm"
            className="flex items-center gap-2 text-lg font-semibold"
            data-testid="jukebox-queue-add"
            onClick={() => useJukeboxUiStore.getState().setAddSongsOpen(true)}
          >
            <PlusIcon />
            {t('jukebox.queue.add')}
          </Button>
          {queue.length > 0 && (
            <Button
              type="button"
              sfx="back"
              className="text-lg font-semibold text-ink-primary"
              data-testid="jukebox-queue-clear"
              onClick={() => {
                pendingFocusRef.current = { index: 0, action: 'remove' }
                session().clearJukeboxQueue()
              }}
            >
              {t('jukebox.queue.clear')}
            </Button>
          )}
        </div>

        <ol
          ref={listRef}
          className="-mx-2 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-1 [scrollbar-width:thin]"
          aria-labelledby={titleId}
        >
          {queue.length === 0 ? (
            <li className="flex flex-col gap-1 py-6 text-center" data-testid="jukebox-queue-empty">
              <span className="text-lg font-semibold text-ink-secondary">{t('jukebox.queue.empty')}</span>
              {emptyHint && <span className="text-base text-ink-tertiary">{emptyHint}</span>}
            </li>
          ) : (
            queue.map((song, index) => (
              <li
                key={`${song.path}#${index}`}
                data-queue-index={index}
                data-testid="jukebox-queue-panel-item"
                className="flex items-center gap-2 rounded-2xl px-2 py-2 hover:bg-white/[0.06]"
              >
                <span className="w-6 shrink-0 text-right text-base font-bold tabular-nums text-accent-gold">{index + 1}</span>
                <SongThumb song={song} className="size-12" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-lg font-semibold text-ink-primary">{song.title}</div>
                  <div className="truncate text-base text-ink-secondary">{songByline(song)}</div>
                </div>
                <TransportButton
                  size="sm"
                  label={t('jukebox.queue.moveUp', { title: song.title })}
                  data-queue-action="up"
                  disabled={index === 0}
                  className="disabled:opacity-30"
                  onClick={() => act(index, 'up')}
                >
                  <ArrowUpIcon />
                </TransportButton>
                <TransportButton
                  size="sm"
                  label={t('jukebox.queue.moveDown', { title: song.title })}
                  data-queue-action="down"
                  disabled={index === queue.length - 1}
                  className="disabled:opacity-30"
                  onClick={() => act(index, 'down')}
                >
                  <ArrowDownIcon />
                </TransportButton>
                <TransportButton
                  size="sm"
                  sfx="back"
                  label={t('jukebox.queue.remove', { title: song.title })}
                  data-queue-action="remove"
                  onClick={() => act(index, 'remove')}
                >
                  <CloseIcon />
                </TransportButton>
              </li>
            ))
          )}
        </ol>

        <div className="flex items-center gap-4 border-t border-white/10 pt-4">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold text-ink-primary">
              {t('jukebox.queue.autoplay')}
            </div>
            <div className="text-base text-ink-tertiary">{t('jukebox.queue.autoplayHint')}</div>
          </div>
          <GlassToggle
            checked={autoplay}
            label={t('jukebox.queue.autoplay')}
            data-testid="jukebox-autoplay"
            onChange={(on) => useSessionStore.getState().setJukeboxAutoplay(on)}
          />
        </div>
      </Panel>
    </motion.div>
  )
}
