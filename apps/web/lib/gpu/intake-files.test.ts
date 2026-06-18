import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyFile, INTAKE_LIMITS, ACCEPT_ALL, formatMB } from './intake-files.ts'

const f = (name: string, type: string, size = 1000) => ({ name, type, size })

test('이미지 → stream/image', () => {
  const d = classifyFile(f('shot.png', 'image/png'))
  assert.equal(d.route, 'stream')
  assert.equal(d.kind, 'image')
  assert.equal(d.tooLarge, false) // 이미지는 다운스케일로 차단 안 함
})

test('이미지 큰 용량 → shouldDownscale true', () => {
  const d = classifyFile(f('big.jpg', 'image/jpeg', INTAKE_LIMITS.IMG_DOWNSCALE_OVER + 1))
  assert.equal(d.shouldDownscale, true)
})

test('확장자만 있고 MIME 빈 이미지도 인식', () => {
  assert.equal(classifyFile(f('a.JPEG', '')).kind, 'image')
})

test('PDF → stream/pdf', () => {
  const d = classifyFile(f('quote.pdf', 'application/pdf'))
  assert.equal(d.route, 'stream')
  assert.equal(d.kind, 'pdf')
})

test('PDF 상한 초과 → tooLarge true', () => {
  const d = classifyFile(f('huge.pdf', 'application/pdf', INTAKE_LIMITS.MAX_STREAM_FILE + 1))
  assert.equal(d.tooLarge, true)
  assert.equal(d.maxBytes, INTAKE_LIMITS.MAX_STREAM_FILE)
})

test('xlsx → catalog/spreadsheet', () => {
  const d = classifyFile(f('list.xlsx', ''))
  assert.equal(d.route, 'catalog')
  assert.equal(d.kind, 'spreadsheet')
})

test('xls(구형) → catalog', () => {
  assert.equal(classifyFile(f('old.xls', 'application/vnd.ms-excel')).route, 'catalog')
})

test('xlsx catalog 상한(5MB) 적용', () => {
  const d = classifyFile(f('big.xlsx', '', INTAKE_LIMITS.MAX_CATALOG_FILE + 1))
  assert.equal(d.tooLarge, true)
  assert.equal(d.maxBytes, INTAKE_LIMITS.MAX_CATALOG_FILE)
})

test('csv → text', () => {
  assert.equal(classifyFile(f('rows.csv', 'text/csv')).route, 'text')
})

test('txt/text/* → text', () => {
  assert.equal(classifyFile(f('memo.txt', 'text/plain')).kind, 'text')
})

test('알 수 없는 확장자 → text 폴백 + kind unknown(무음 실패 방지)', () => {
  const d = classifyFile(f('weird.docx', 'application/octet-stream'))
  assert.equal(d.route, 'text')
  assert.equal(d.kind, 'unknown')
})

test('ACCEPT_ALL에 xlsx 포함', () => {
  assert.ok(ACCEPT_ALL.includes('.xlsx'))
  assert.ok(ACCEPT_ALL.includes('.pdf'))
})

test('formatMB', () => {
  assert.equal(formatMB(4 * 1024 * 1024), '4.0MB')
})
