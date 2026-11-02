// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')

describe('AetherStar branding', () => {
  it('package.json name is aetherstar', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))
    expect(pkg.name).toBe('aetherstar')
  })

  it('electron-builder.yml appId and productName are aetherstar-branded', () => {
    const builderConfig = readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf-8')
    expect(builderConfig).toMatch(/appId:\s*com\.aetherstar\.app/)
    expect(builderConfig).toMatch(/productName:\s*AetherStar/)
  })

  it('index.html title contains AetherStar', () => {
    const indexHtml = readFileSync(path.join(ROOT, 'index.html'), 'utf-8')
    expect(indexHtml).toMatch(/<title>[^<]*AetherStar[^<]*<\/title>/)
  })
})
