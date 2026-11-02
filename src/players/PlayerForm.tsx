import { useState, type DragEvent } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { tokens } from '../design/tokens'
import { PRESS_CLASS } from '../design/motion'
import { GlassButton } from '../design/primitives/GlassButton'
import { PlayerBadge } from './PlayerBadge'
import { AvatarCropModal } from './AvatarCropModal'
import { PLAYER_ACCENT_COLORS } from './colors'
import * as api from './api'
import type { CreatePlayerInput } from './types'
import { useT } from '../i18n'

interface PlayerFormProps {
  initialName?: string
  initialColor?: string
  onSubmit: (input: CreatePlayerInput) => void
  onCancel?: () => void
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function PlayerForm({ initialName = '', initialColor = PLAYER_ACCENT_COLORS[0], onSubmit, onCancel }: PlayerFormProps) {
  const t = useT()
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState(initialColor)
  const [sourcePhoto, setSourcePhoto] = useState<string | null>(null)
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | undefined>(undefined)
  const reduceMotion = useReducedMotion()

  async function handleChoosePhoto() {
    const filePath = await window.api!.openFile()
    if (!filePath) return
    const dataUrl = await api.readImportedPhoto(filePath)
    setSourcePhoto(dataUrl)
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    const file = event.dataTransfer.files[0]
    if (!file) return
    setSourcePhoto(await readFileAsDataUrl(file))
  }

  function handleSubmit() {
    const input: CreatePlayerInput = avatarDataUrl ? { name, color, avatarDataUrl } : { name, color }
    onSubmit(input)
  }

  return (
    <motion.div
      className="flex flex-col gap-4"
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={tokens.spring.panelEnter}
    >
      <label className="flex flex-col gap-1 text-sm text-ink-secondary">
        {t('players.form.name')}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-lg border border-line bg-surface-raised px-3 py-2 text-base text-ink-primary"
        />
      </label>

      <div className="flex gap-3">
        {PLAYER_ACCENT_COLORS.map((swatch, index) => (
          <button
            key={swatch}
            type="button"
            aria-label={t('players.form.color', { number: index + 1 })}
            aria-pressed={swatch === color}
            onClick={() => setColor(swatch)}
            className={`h-9 w-9 rounded-full border border-line ${PRESS_CLASS}`}
            // The picked swatch gets a ring; the others leave `outline` to the shared focus ring.
            style={{
              background: swatch,
              ...(swatch === color ? { outline: `2px solid ${tokens.palette.text}`, outlineOffset: 2 } : {}),
            }}
          />
        ))}
      </div>

      <div className="flex items-center gap-4">
        <PlayerBadge name={name} color={color} avatarUrl={avatarDataUrl ?? ''} size={72} />
        <div onDrop={handleDrop} onDragOver={(e) => e.preventDefault()} className="flex flex-col gap-2">
          <GlassButton type="button" onClick={handleChoosePhoto}>
            {t('players.form.choosePhoto')}
          </GlassButton>
          <p className="text-sm text-ink-tertiary">{t('players.form.dropHint')}</p>
        </div>
      </div>

      {sourcePhoto && (
        <AvatarCropModal
          sourceDataUrl={sourcePhoto}
          onCancel={() => setSourcePhoto(null)}
          onConfirm={(cropped) => {
            setAvatarDataUrl(cropped)
            setSourcePhoto(null)
          }}
        />
      )}

      <div className="flex justify-end gap-2">
        {onCancel && (
          <GlassButton type="button" onClick={onCancel}>
            {t('players.form.cancel')}
          </GlassButton>
        )}
        <GlassButton type="button" variant="primary" onClick={handleSubmit}>
          {t('players.form.save')}
        </GlassButton>
      </div>
    </motion.div>
  )
}
