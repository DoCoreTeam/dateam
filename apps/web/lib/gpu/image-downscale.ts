// 클라이언트 이미지 다운스케일 — 업로드 전 canvas 재인코딩으로 용량 축소.
// 브라우저 전용(canvas/Image). SSR 안전을 위해 document 가드. QuoteRegisterTab만 사용.

import { INTAKE_LIMITS } from './intake-files.ts'

const MAX_EDGE = 2000      // 최대 변(px) — OCR 가독 유지하면서 용량 축소
const JPEG_QUALITY = 0.85

/**
 * 이미지 File을 최대변 MAX_EDGE·JPEG q0.85로 재인코딩한다.
 * - 비이미지/SSR/실패 시 원본을 그대로 반환(무음 실패 방지: 항상 File 반환).
 * - PNG 투명 등은 흰 배경 합성(JPEG는 알파 없음).
 */
export async function downscaleImage(file: File): Promise<File> {
  if (typeof document === 'undefined') return file
  if (!file.type.startsWith('image/')) return file

  try {
    const dataUrl = await readAsDataURL(file)
    const img = await loadImage(dataUrl)
    const { width, height } = img
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
    // 이미 작고(스케일 1) 용량도 작으면 원본 유지(불필요한 재인코딩 회피)
    if (scale === 1 && file.size <= 1.2 * 1024 * 1024) return file

    const w = Math.round(width * scale)
    const h = Math.round(height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY),
    )
    if (!blob) return file
    // 재인코딩이 외려 더 크면 원본 유지
    if (blob.size >= file.size) return file
    const newName = file.name.replace(/\.(png|jpe?g|webp|gif)$/i, '') + '.jpg'
    return new File([blob], newName, { type: 'image/jpeg' })
  } catch {
    return file
  }
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('read fail'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load fail'))
    img.src = src
  })
}
