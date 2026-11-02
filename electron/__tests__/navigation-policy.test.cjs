// @vitest-environment node
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { isSafeExternalUrl, createNavigationGuard } = require('../navigation-policy.cjs')

describe('isSafeExternalUrl', () => {
  it('allows only http and https', () => {
    expect(isSafeExternalUrl('https://usdb.animux.de/')).toBe(true)
    expect(isSafeExternalUrl('http://example.com/a?b#c')).toBe(true)
    for (const url of ['file:///etc/hosts', 'smb://host/share', 'custom-handler:open', 'javascript:void(0)', 'mailto:a@b.c', 'not a url', '']) {
      expect(isSafeExternalUrl(url)).toBe(false)
    }
  })
})

describe('createNavigationGuard', () => {
  const indexHtmlPath = path.resolve('/app/dist/index.html')

  it('in production allows the app index (with query and hash) and nothing else', () => {
    const allowed = createNavigationGuard({ isDev: false, devServerUrl: 'http://localhost:5173', indexHtmlPath })
    const index = pathToFileURL(indexHtmlPath).toString()
    expect(allowed(index)).toBe(true)
    expect(allowed(`${index}?window=audience`)).toBe(true)
    expect(allowed(`${index}#/library`)).toBe(true)
    expect(allowed(pathToFileURL(path.resolve('/app/dist/other.html')).toString())).toBe(false)
    expect(allowed(pathToFileURL(path.resolve('/Users/x/Downloads/page.html')).toString())).toBe(false)
    expect(allowed('https://example.com/')).toBe(false)
    expect(allowed('http://localhost:5173/')).toBe(false)
  })

  it('in dev allows the dev server origin only -- not a look-alike host', () => {
    const allowed = createNavigationGuard({ isDev: true, devServerUrl: 'http://localhost:5173', indexHtmlPath })
    expect(allowed('http://localhost:5173/?window=audience')).toBe(true)
    expect(allowed('http://localhost:5173.example.com/')).toBe(false)
    expect(allowed('http://localhost:5174/')).toBe(false)
    expect(allowed(pathToFileURL(indexHtmlPath).toString())).toBe(false)
  })

  it('rejects garbage', () => {
    const allowed = createNavigationGuard({ isDev: false, devServerUrl: 'http://localhost:5173', indexHtmlPath })
    expect(allowed('::::')).toBe(false)
  })
})
