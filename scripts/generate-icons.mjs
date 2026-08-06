// アプリアイコン（青地に白い虫めがねマーク）を生成する。
// 依存ライブラリなし：Node標準の zlib だけでPNGをエンコードする。
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dirname, '..', 'public')
mkdirSync(outDir, { recursive: true })

// CRC32
const crcTable = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([len, body, crc])
}

// 線分への距離
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx, cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

function makePng(S) {
  const bg = [37, 99, 235] // #2563eb
  const bgTop = [59, 130, 246] // #3b82f6
  const white = [255, 255, 255]
  // 虫めがねの寸法
  const cx = S * 0.44, cy = S * 0.42, R = S * 0.22, ring = S * 0.07
  const hAx = cx + R * Math.cos(Math.PI / 4)
  const hAy = cy + R * Math.sin(Math.PI / 4)
  const hBx = S * 0.74, hBy = S * 0.74
  const handleW = S * 0.09

  const raw = Buffer.alloc((S * 4 + 1) * S)
  let p = 0
  for (let y = 0; y < S; y++) {
    raw[p++] = 0 // filter type 0
    for (let x = 0; x < S; x++) {
      // 背景（上→下でわずかにグラデーション）
      const f = y / S
      let r = Math.round(bgTop[0] + (bg[0] - bgTop[0]) * f)
      let g = Math.round(bgTop[1] + (bg[1] - bgTop[1]) * f)
      let b = Math.round(bgTop[2] + (bg[2] - bgTop[2]) * f)
      // 虫めがねリング
      const d = Math.hypot(x - cx, y - cy)
      const onRing = Math.abs(d - R) <= ring / 2
      const onHandle = distSeg(x, y, hAx, hAy, hBx, hBy) <= handleW / 2
      if (onRing || onHandle) {
        r = white[0]; g = white[1]; b = white[2]
      }
      raw[p++] = r; raw[p++] = g; raw[p++] = b; raw[p++] = 255
    }
  }

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(S, 0)
  ihdr.writeUInt32BE(S, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]) {
  writeFileSync(join(outDir, name), makePng(size))
  console.log('wrote', name, size + 'px')
}
console.log('done')
