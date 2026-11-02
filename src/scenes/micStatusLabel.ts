import type { TFunction } from '../i18n'

/**
 * The one-line mic readout under the title-screen buttons. Says nothing about
 * the audio driver: "WASAPI" means nothing to someone holding a microphone.
 */
export function micStatusLabel(deviceCount: number, t: TFunction): string {
  if (deviceCount <= 0) return t('home.mics.none')
  return t('home.mics.ready', { count: deviceCount })
}

/** Boot's readout while the first device scan is still running. */
export function micStatusPending(t: TFunction): string {
  return t('home.mics.looking')
}
