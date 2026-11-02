// What the jukebox shows once the queue has run out and there is nothing else
// to play (autoplay off, Repeat off): a gentle stop, with the two ways on.
import { useEffect, useId, useRef } from 'react'
import { useT } from '../i18n'
import { Panel } from '../design/primitives/GlassPanel'
import { Button } from '../design/primitives/GlassButton'
import { useSessionStore } from '../session/sessionStore'
import { useJukeboxUiStore } from './jukeboxUiStore'
import { PlusIcon } from './icons'

export function QueueFinishedCard() {
  const t = useT()
  const titleId = useId()
  const addRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    addRef.current?.focus()
  }, [])

  return (
    <div className="flex h-full min-h-screen w-full items-center justify-center bg-[#08080b] p-8">
      <Panel
        role="region"
        aria-labelledby={titleId}
        data-testid="jukebox-finished"
        className="flex w-full max-w-lg flex-col items-center gap-6 rounded-3xl p-10 text-center"
      >
        <div>
          <h2 id={titleId} className="text-3xl font-bold text-ink-primary">
            {t('jukebox.finished.title')}
          </h2>
          <p className="mt-3 text-lg text-ink-secondary">{t('jukebox.finished.message')}</p>
        </div>
        <div className="flex w-full flex-col gap-3">
          <Button
            ref={addRef}
            type="button"
            variant="primary"
            sfx="confirm"
            className="flex items-center justify-center gap-2 text-xl font-semibold"
            data-testid="jukebox-finished-add"
            onClick={() => useJukeboxUiStore.getState().setAddSongsOpen(true)}
          >
            <PlusIcon />
            {t('jukebox.finished.add')}
          </Button>
          <Button
            type="button"
            sfx="back"
            className="text-xl font-semibold text-ink-primary"
            data-testid="jukebox-finished-back"
            onClick={() => useSessionStore.getState().jukeboxBackToList()}
          >
            {t('jukebox.menu.backToList')}
          </Button>
        </div>
      </Panel>
    </div>
  )
}
