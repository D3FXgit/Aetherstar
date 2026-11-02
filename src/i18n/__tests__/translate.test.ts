import { describe, expect, it, vi } from 'vitest'
import { interpolate, translate, type TranslationContext } from '../translate'

const english = {
  greeting: 'Hello, {name}!',
  'songs.one': '{count} song',
  'songs.other': '{count} songs',
  'only.english': 'Only in English',
  score: 'Score: {points}',
}

const german: TranslationContext = {
  language: 'de',
  dictionary: {
    greeting: 'Hallo, {name}!',
    'songs.one': '{count} Song',
    'songs.other': '{count} Songs',
    'songs.zero': 'Noch keine Songs',
    score: 'Punkte: {points}',
  },
  fallback: english,
}

describe('translate', () => {
  it('fills {placeholders}', () => {
    expect(translate('greeting', { name: 'Nova' }, german)).toBe('Hallo, Nova!')
  })

  it('leaves a placeholder with no value exactly as written, and ignores extra params', () => {
    expect(translate('greeting', { other: 'x' }, german)).toBe('Hallo, {name}!')
    expect(translate('greeting', undefined, german)).toBe('Hallo, {name}!')
  })

  it('formats numbers for the active language', () => {
    expect(translate('score', { points: 12345 }, german)).toBe('Punkte: 12.345')
    expect(translate('score', { points: 12345 }, { language: 'en', dictionary: english, fallback: english })).toBe('Score: 12,345')
  })

  it('picks the plural form with the language\'s own rules', () => {
    expect(translate('songs', { count: 1 }, german)).toBe('1 Song')
    expect(translate('songs', { count: 5 }, german)).toBe('5 Songs')
  })

  it('uses a ".zero" form for exactly 0 when the language file has one', () => {
    expect(translate('songs', { count: 0 }, german)).toBe('Noch keine Songs')
    const en: TranslationContext = { language: 'en', dictionary: english, fallback: english }
    expect(translate('songs', { count: 0 }, en)).toBe('0 songs')
  })

  it('handles languages with more plural forms (Polish: one / few / many)', () => {
    const polish: TranslationContext = {
      language: 'pl',
      dictionary: { 'songs.one': '{count} piosenka', 'songs.few': '{count} piosenki', 'songs.many': '{count} piosenek', 'songs.other': '{count} piosenki' },
      fallback: english,
    }
    expect(translate('songs', { count: 1 }, polish)).toBe('1 piosenka')
    expect(translate('songs', { count: 3 }, polish)).toBe('3 piosenki')
    expect(translate('songs', { count: 5 }, polish)).toBe('5 piosenek')
  })

  it('falls back to ".other" when a language lacks the exact form (Japanese has only "other")', () => {
    const japanese: TranslationContext = { language: 'ja', dictionary: { 'songs.other': '{count}曲' }, fallback: english }
    expect(translate('songs', { count: 1 }, japanese)).toBe('1曲')
  })

  it('falls back to English for an untranslated key, then to the key itself', () => {
    expect(translate('only.english', undefined, german)).toBe('Only in English')
    expect(translate('no.such.key', undefined, german)).toBe('no.such.key')
  })

  it('uses the language\'s own plural rules for its text and English rules for an English fallback', () => {
    const partial: TranslationContext = { language: 'de', dictionary: {}, fallback: english }
    expect(translate('songs', { count: 1 }, partial)).toBe('1 song')
    expect(translate('songs', { count: 1000 }, partial)).toBe('1.000 songs')
  })

  it('warns once per missing key in development builds', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      translate('missing.once', undefined, german)
      translate('missing.once', undefined, german)
      translate('only.english', undefined, { ...german, language: 'fr' })
      translate('only.english', undefined, { ...german, language: 'fr' })
      expect(warn).toHaveBeenCalledTimes(2)
      expect(warn.mock.calls[0][0]).toMatch(/unknown key "missing.once"/)
      expect(warn.mock.calls[1][0]).toMatch(/no "fr" text for "only.english"/)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('interpolate', () => {
  it('passes strings through untouched and survives odd input', () => {
    expect(interpolate('{a}{b}{a}', { a: '1', b: 'x' }, 'en')).toBe('1x1')
    expect(interpolate('{ spaced } {a-b}', { a: 1 }, 'en')).toBe('{ spaced } {a-b}')
    expect(interpolate('plain', undefined, 'xx-invalid')).toBe('plain')
  })
})
