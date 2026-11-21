import { MAX_ATTACHMENT_SIZE } from '@gamma/shared'
import { realpathSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { writeBinaryFileAtomic } from './safe-file'

type RasterImageMimeType = 'image/png' | 'image/jpeg' | 'image/webp'

interface DecodedRasterImage {
  buffer: Buffer
  mimeType: RasterImageMimeType
}

function hasExpectedSignature(buffer: Buffer, mimeType: RasterImageMimeType): boolean {
  if (mimeType === 'image/png') return buffer.length >= 8 && buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
  if (mimeType === 'image/jpeg') return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  return buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
}

export function decodeRasterImageDataUrl(dataUrl: string): DecodedRasterImage {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
  if (!match) throw new Error('图片编辑器导出了无法识别的格式')
  const mimeType = match[1] as RasterImageMimeType
  const base64 = match[2]!
  if (base64.length > Math.ceil(MAX_ATTACHMENT_SIZE / 3) * 4 + 4) throw new Error('编辑后的图片超过 100MB 上限')
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length === 0 || buffer.length > MAX_ATTACHMENT_SIZE) throw new Error('编辑后的图片为空或超过 100MB 上限')
  if (buffer.toString('base64').replace(/=+$/, '') !== base64.replace(/=+$/, '') || !hasExpectedSignature(buffer, mimeType)) {
    throw new Error('图片编码与声明格式不一致')
  }
  return { buffer, mimeType }
}

/** 调用方必须先完成会话路径授权；本函数负责格式一致性和原子落盘。 */
export function writeRasterImageFile(filePath: string, dataUrl: string): void {
  const { buffer, mimeType } = decodeRasterImageDataUrl(dataUrl)
  const targetPath = realpathSync(filePath)
  const extension = extname(targetPath).toLowerCase()
  const expectedMime = extension === '.png' ? 'image/png'
    : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg'
      : extension === '.webp' ? 'image/webp' : null
  if (!expectedMime || expectedMime !== mimeType) throw new Error('原图格式与导出格式不一致，无法安全覆盖')
  writeBinaryFileAtomic(targetPath, buffer, statSync(targetPath).mode & 0o777)
}
