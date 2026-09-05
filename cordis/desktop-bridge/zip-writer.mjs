// Minimal ZIP writer for desktop session-log export.
//
// The runtime ships no third-party zip library (fflate belongs to the Web
// export package, which the desktop profile does not mount), so this module
// writes the ZIP container itself with node:zlib DEFLATE: one local file
// header + compressed data per entry, then the central directory. Entries use
// STORE-equivalent timestamps (DOS epoch) and UTF-8 names without flags; the
// archive is meant for the native save dialog, not byte-for-byte fidelity.

import { deflateRawSync } from 'node:zlib'

const LOCAL_FILE_HEADER = 0x04034b50
const CENTRAL_DIRECTORY_HEADER = 0x02014b50
const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const VERSION_NEEDED = 20
const VERSION_MADE_BY = 20
const FLAG_UTF8 = 0x0800
const METHOD_DEFLATE = 8

function dosDateTime() {
  // Fixed 1980-01-01 00:00:00 (DOS minimum) keeps the archive reproducible.
  return { date: 0x21, time: 0 }
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function u16(value) {
  return Buffer.from([value & 0xff, (value >>> 8) & 0xff])
}

function u32(value) {
  return Buffer.from([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff])
}

/**
 * Build one ZIP archive from named UTF-8 text entries.
 * @param entries - ordered `{ path, content }` pairs.
 * @returns the complete archive bytes.
 */
export function buildZip(entries) {
  const dos = dosDateTime()
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8')
    const data = Buffer.from(entry.content, 'utf8')
    const compressed = deflateRawSync(data, { level: 6 })
    const checksum = crc32(data)
    const local = Buffer.concat([
      u32(LOCAL_FILE_HEADER),
      u16(VERSION_NEEDED),
      u16(FLAG_UTF8),
      u16(METHOD_DEFLATE),
      u16(dos.time),
      u16(dos.date),
      u32(checksum),
      u32(compressed.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      compressed,
    ])
    localParts.push(local)
    centralParts.push(Buffer.concat([
      u32(CENTRAL_DIRECTORY_HEADER),
      u16(VERSION_MADE_BY),
      u16(VERSION_NEEDED),
      u16(FLAG_UTF8),
      u16(METHOD_DEFLATE),
      u16(dos.time),
      u16(dos.date),
      u32(checksum),
      u32(compressed.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]))
    offset += local.length
  }
  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.concat([
    u32(END_OF_CENTRAL_DIRECTORY),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDirectory.length),
    u32(offset),
    u16(0),
  ])
  return Buffer.concat([...localParts, centralDirectory, end])
}
