/** Library files (covers, previews) served by electron/library/media-protocol.cjs. */
export function toLibraryMediaUrl(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/')
  const pathWithSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  const encoded = encodeURI(pathWithSlash).replace(/#/g, '%23').replace(/\?/g, '%3F')
  return `aetherstar-media://roots${encoded}`
}
