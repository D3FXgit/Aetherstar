import type { MixerChannel } from './types'

export interface MixerRow {
  channel: MixerChannel
  /** Language-file key of the row label (languages/*.txt). */
  labelKey: string
  /** Language-file key of the one-sentence description under it. */
  descriptionKey: string
}

/**
 * The volume mixer. Each row is one channel of src/audio/mixer.ts; changes
 * apply while the slider moves. Song loudness is evened out underneath these
 * (src/audio/loudness.ts), so Music sets the level of every song at once.
 */
export const MIXER_ROWS: readonly MixerRow[] = (['master', 'music', 'guideVocals', 'effects', 'menuMusic'] as const).map(
  (channel) => ({
    channel,
    labelKey: `settings.volume.${channel}.label`,
    descriptionKey: `settings.volume.${channel}.description`,
  }),
)
