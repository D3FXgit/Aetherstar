import type { AssetValidationResult } from './validateAssets'

/** Thin window.api.fx.getAssetsDir() wrapper -- the absolute path to the app's assets/ directory. */
export function getAssetsDir(): Promise<string> {
  if (!window.api) return Promise.reject(new Error('window.api is not available (not running inside Electron)'))
  return window.api.fx.getAssetsDir()
}

/** Warns once per missing asset and returns their paths, so the loader can degrade each to a silent/invisible placeholder instead of throwing. */
export function checkMissingAndWarn(results: AssetValidationResult[]): string[] {
  const missing = results.filter((result) => !result.present)
  for (const result of missing) {
    console.warn(`[fx] missing asset: ${result.path} -- degrading to a silent/invisible placeholder`)
  }
  return missing.map((result) => result.path)
}
