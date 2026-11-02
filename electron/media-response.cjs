'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { Readable } = require('node:stream')

// Media elements seek by asking for byte ranges. Answering every request with
// the whole file (200) makes Chromium restart long videos from frame 0 after a
// far seek, so local files are served with proper 206 partial responses.
const MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.txt': 'text/plain; charset=utf-8',
}

function mimeTypeFor(filePath) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Parses a single `bytes=start-end` range against a file size.
 * Returns null for a missing header, 'invalid' for an unsatisfiable one.
 * @param {string | null | undefined} header
 * @param {number} size
 * @returns {{ start: number, end: number } | null | 'invalid'}
 */
function parseRange(header, size) {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null // multi-range or unknown unit: fall back to the whole file
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return 'invalid'
  let start
  let end
  if (rawStart === '') {
    // Suffix range: the last N bytes.
    const suffix = Number(rawEnd)
    if (suffix === 0) return 'invalid'
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return 'invalid'
  return { start, end }
}

/**
 * Builds a Response for a local file, honouring the request's Range header.
 * @param {string} filePath
 * @param {{ headers?: { get(name: string): string | null } } | undefined} request
 * @param {Record<string, string>} [extraHeaders]
 * @returns {Promise<Response>}
 */
async function fileResponse(filePath, request, extraHeaders = {}) {
  const stat = await fs.promises.stat(filePath)
  if (!stat.isFile()) return new Response(null, { status: 404, statusText: 'Not Found' })
  const size = stat.size
  const baseHeaders = {
    'content-type': mimeTypeFor(filePath),
    'accept-ranges': 'bytes',
    ...extraHeaders,
  }
  const range = parseRange(request?.headers?.get?.('range'), size)
  if (range === 'invalid') {
    return new Response(null, {
      status: 416,
      statusText: 'Range Not Satisfiable',
      headers: { ...baseHeaders, 'content-range': `bytes */${size}` },
    })
  }
  if (range) {
    const body = Readable.toWeb(fs.createReadStream(filePath, { start: range.start, end: range.end }))
    return new Response(body, {
      status: 206,
      statusText: 'Partial Content',
      headers: {
        ...baseHeaders,
        'content-length': String(range.end - range.start + 1),
        'content-range': `bytes ${range.start}-${range.end}/${size}`,
      },
    })
  }
  const body = size === 0 ? null : Readable.toWeb(fs.createReadStream(filePath))
  return new Response(body, {
    status: 200,
    headers: { ...baseHeaders, 'content-length': String(size) },
  })
}

module.exports = { fileResponse, parseRange, mimeTypeFor }
