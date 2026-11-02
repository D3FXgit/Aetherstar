import { describe, expect, it } from 'vitest'
import { getInitials } from '../initials'

describe('getInitials', () => {
  it('takes the first letter of the first and last word', () => {
    expect(getInitials('Jane Doe')).toBe('JD')
  })

  it('takes just one letter for a single-word name', () => {
    expect(getInitials('Zephyr')).toBe('Z')
  })

  it('trims and collapses extra whitespace', () => {
    expect(getInitials('  jane   doe  ')).toBe('JD')
  })

  it('returns an empty string for an empty name', () => {
    expect(getInitials('')).toBe('')
  })
})
