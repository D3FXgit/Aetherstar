import type { AssetSpec } from './manifest'

export interface AssetValidationResult {
  path: string
  present: boolean
  required: boolean
}

/** Checks every spec's existence via the injected checker -- keeps this pure/testable without real fs/IPC access. */
export async function validateAssets(
  specs: AssetSpec[],
  checkExists: (path: string) => Promise<boolean>,
): Promise<AssetValidationResult[]> {
  return Promise.all(
    specs.map(async (spec) => ({
      path: spec.path,
      present: await checkExists(spec.path),
      required: spec.required,
    })),
  )
}
