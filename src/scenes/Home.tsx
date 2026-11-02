import { useScene } from './useScene'
import { HeroFrame } from './HeroFrame'
import { micStatusLabel } from './micStatusLabel'
import { usePitchStore } from '../audio/pitchStore'
import { useMenuMusicStore } from '../audio/menuMusic'
import { GlassButton } from '../design/primitives/GlassButton'
import { useSessionStore } from '../session/sessionStore'
import { useT } from '../i18n'

const CTA_CLASS = 'px-10 py-4 text-lg font-bold'

/** The title screen: big buttons to start, open the jukebox or settings, or exit. */
export function Home() {
  const t = useT()
  const { navigate } = useScene()
  const startSession = useSessionStore((state) => state.startSession)
  const startJukebox = useSessionStore((state) => state.startJukebox)
  const deviceCount = usePitchStore((state) => state.devices.length)
  // Only a library song is named; the bundled loop has nothing worth saying.
  const nowPlaying = useMenuMusicStore((state) => state.nowPlaying)
  // Only inside Electron; the browser preview has nothing to quit.
  const canQuit = typeof window.api?.quit === 'function'

  return (
    <HeroFrame>
      <div className="flex flex-wrap items-center justify-center gap-5">
        <GlassButton
          type="button"
          variant="primary"
          sfx="confirm"
          onClick={() => void startSession()}
          className={CTA_CLASS}
        >
          {t('home.start')}
        </GlassButton>
        <GlassButton type="button" sfx="confirm" onClick={() => void startJukebox()} className={CTA_CLASS}>
          {t('home.jukebox')}
        </GlassButton>
        <GlassButton type="button" onClick={() => navigate('settings')} className={CTA_CLASS}>
          {t('home.settings')}
        </GlassButton>
        {canQuit && (
          <GlassButton type="button" onClick={() => window.api?.quit?.()} className={CTA_CLASS} data-testid="home-exit">
            {t('home.exit')}
          </GlassButton>
        )}
      </div>
      <p data-testid="home-status" className="text-base text-ink-tertiary">
        {micStatusLabel(deviceCount, t)}
      </p>
      {nowPlaying && (
        <p data-testid="home-now-playing" className="-mt-4 max-w-[40rem] truncate text-sm text-ink-tertiary">
          {t('home.nowPlaying', { title: nowPlaying.title, artist: nowPlaying.artist })}
        </p>
      )}
    </HeroFrame>
  )
}
