// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { resolveMacSigningWarning } from '../check-mac-signing.mjs'

const FULL_ENV = {
  CSC_LINK: '/path/to/cert.p12',
  APPLE_ID: 'dev@example.com',
  APPLE_APP_SPECIFIC_PASSWORD: 'app-specific-password',
  APPLE_TEAM_ID: 'TEAMID1234',
}

describe('resolveMacSigningWarning', () => {
  it('returns null when every required credential is present', () => {
    expect(resolveMacSigningWarning(FULL_ENV)).toBeNull()
  })

  it('returns a warning naming CSC_LINK when it is missing', () => {
    const { CSC_LINK, ...rest } = FULL_ENV
    const warning = resolveMacSigningWarning(rest)
    expect(warning).toMatch(/CSC_LINK/)
  })

  it('returns a warning naming every missing Apple credential when all are absent', () => {
    const warning = resolveMacSigningWarning({})
    expect(warning).toMatch(/CSC_LINK/)
    expect(warning).toMatch(/APPLE_ID/)
    expect(warning).toMatch(/APPLE_APP_SPECIFIC_PASSWORD/)
    expect(warning).toMatch(/APPLE_TEAM_ID/)
  })
})
