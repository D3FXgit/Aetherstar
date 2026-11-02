#!/usr/bin/env node
import { pathToFileURL } from 'node:url'

// Pre-dist warning for macOS signing/notarization. electron-builder silently
// skips both when CSC_LINK/APPLE_* are missing; this says so up front.

const REQUIRED_APPLE_VARS = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']

/**
 * Given an env-like object, returns a warning string naming every missing
 * signing/notarization credential, or null when all are present. Pure and
 * unit-testable without real credentials -- only the warning message is
 * this script's own logic; electron-builder itself still decides whether to
 * actually sign/notarize.
 */
export function resolveMacSigningWarning(env) {
  const missing = []
  if (!env.CSC_LINK) missing.push('CSC_LINK')
  for (const key of REQUIRED_APPLE_VARS) {
    if (!env[key]) missing.push(key)
  }

  if (missing.length === 0) return null
  return `macOS code signing/notarization credentials missing (${missing.join(', ')}) -- proceeding with an unsigned build.`
}

// Only run as a CLI script, not when imported by the test above. Compares
// via pathToFileURL (not a raw string template) so paths with spaces/special
// characters -- which file:// URL-encodes -- still match correctly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const warning = resolveMacSigningWarning(process.env)
  if (warning) console.warn(warning)
}
