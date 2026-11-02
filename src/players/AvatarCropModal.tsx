import { useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { GlassPanel } from '../design/primitives/GlassPanel'
import { GlassButton } from '../design/primitives/GlassButton'
import { cropImageToDataUrl } from './crop'
import { useT } from '../i18n'

const OUTPUT_SIZE = 256

interface AvatarCropModalProps {
  sourceDataUrl: string
  onConfirm: (croppedDataUrl: string) => void
  onCancel: () => void
}

export function AvatarCropModal({ sourceDataUrl, onConfirm, onCancel }: AvatarCropModalProps) {
  const t = useT()
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  // Defaults to a full-frame crop so "Use photo" works before any drag or zoom.
  // Cropper's onCropComplete keeps it current after that (it never fires under
  // jsdom's fake image loads, so a null default would make confirm untestable).
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area>({ x: 0, y: 0, width: OUTPUT_SIZE, height: OUTPUT_SIZE })

  async function handleUsePhoto() {
    const dataUrl = await cropImageToDataUrl(sourceDataUrl, croppedAreaPixels, rotation, OUTPUT_SIZE)
    onConfirm(dataUrl)
  }

  return (
    <GlassPanel data-testid="avatar-crop-modal" className="fixed inset-0 m-auto max-w-md h-96 p-6 flex flex-col gap-4">
      {/* A square crop; the badge rounds its corners afterwards. */}
      <div className="relative flex-1">
        <Cropper
          image={sourceDataUrl}
          crop={crop}
          zoom={zoom}
          rotation={rotation}
          aspect={1}
          cropShape="rect"
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onRotationChange={setRotation}
          onCropComplete={(_croppedArea, areaPixels) => setCroppedAreaPixels(areaPixels)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <GlassButton type="button" onClick={onCancel}>
          {t('players.crop.cancel')}
        </GlassButton>
        <GlassButton type="button" variant="primary" onClick={handleUsePhoto}>
          {t('players.crop.use')}
        </GlassButton>
      </div>
    </GlassPanel>
  )
}
