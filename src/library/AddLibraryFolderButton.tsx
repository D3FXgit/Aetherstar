import { GlassButton } from '../design/primitives/GlassButton'
import { useT } from '../i18n'

interface AddLibraryFolderButtonProps {
  onFolderPicked: (folderPath: string) => void
  /** Size/spacing override for dense rows (Settings). */
  className?: string
}

export function AddLibraryFolderButton({ onFolderPicked, className }: AddLibraryFolderButtonProps) {
  const t = useT()

  async function handleClick() {
    const folderPath = await window.api?.openFile({ directory: true })
    if (folderPath) onFolderPicked(folderPath)
  }

  return (
    <GlassButton type="button" onClick={handleClick} className={className}>
      {t('library.addFolder')}
    </GlassButton>
  )
}
