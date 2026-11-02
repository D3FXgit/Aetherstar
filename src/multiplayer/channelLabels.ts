import { t } from '../i18n'

/**
 * Human names for the channels of one input device, in the terms written on
 * the hardware: a stereo pair is Left and Right, a multi-channel interface has
 * numbered inputs (IN 1, IN 2 ...). A mono mic says "Mono" so its empty picker
 * reads as "one input", not as a loading failure.
 */
export function channelLabels(channelCount: number): string[] {
  if (!Number.isFinite(channelCount) || channelCount <= 0) return []
  if (channelCount === 1) return [t('mic.channel.mono')]
  if (channelCount === 2) return [t('mic.channel.left'), t('mic.channel.right')]
  return Array.from({ length: Math.floor(channelCount) }, (_, index) => inputLabel(index))
}

/** The label for one channel, or a bare input number if the device has fewer channels than that. */
export function channelLabel(channelCount: number, channelIndex: number): string {
  return channelLabels(channelCount)[channelIndex] ?? inputLabel(channelIndex)
}

function inputLabel(channelIndex: number): string {
  return t('mic.channel.input', { number: String(channelIndex + 1) })
}
