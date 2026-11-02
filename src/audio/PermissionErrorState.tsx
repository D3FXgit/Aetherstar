import { GlassButton } from '../design/primitives/GlassButton'
import { GlassPanel } from '../design/primitives/GlassPanel'
import { usePitchStore } from './pitchStore'
import { useT } from '../i18n'

export function PermissionErrorState() {
  const requestPermission = usePitchStore((state) => state.requestPermission)
  const t = useT()

  return (
    <GlassPanel className="p-8 m-auto max-w-md text-center flex flex-col gap-4" data-testid="permission-error-state">
      <h2 className="text-2xl font-bold text-ink-primary">{t('audio.permission.title')}</h2>
      <p className="text-base text-ink-secondary">{t('audio.permission.message')}</p>
      <GlassButton
        type="button"
        variant="primary"
        onClick={() => requestPermission()}
        className="self-center px-6 font-semibold"
      >
        {t('audio.permission.retry')}
      </GlassButton>
    </GlassPanel>
  )
}
