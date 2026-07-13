import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  toClaudeContent,
  toGeminiParts,
  toOpenAiContent,
  kindOfMime,
  sniffMagicBytes,
  attachmentFallbackText,
  sanitizeFilenameForDisplay,
  extFromMime,
  maxBytesForMime,
  extractDocumentText,
  MAX_DOCUMENT_TEXT_CHARS,
} from './attachments.ts'

// ChatTurn/AttachmentInput은 provider.ts(세션1) 타입 — 런타임 plain object로 구성.
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

function imgAtt(filename = 'a.png', mime = 'image/png') {
  return { kind: 'image' as const, mime, filename, dataBase64: 'IMGDATA' }
}
function pdfAtt(filename = 'doc.pdf') {
  return { kind: 'pdf' as const, mime: 'application/pdf', filename, dataBase64: 'PDFDATA' }
}
function docAtt(filename = 'notes.txt', text = '문서원문 hello') {
  return { kind: 'document' as const, mime: 'text/plain', filename, dataBase64: b64(text) }
}

// ── ① toClaudeContent ──
test('① toClaudeContent: image→image블록 / pdf→document base64 / document→document text(title=filename) / text 마지막', () => {
  const turn = {
    role: 'user' as const,
    content: '이 파일들 봐줘',
    attachments: [imgAtt(), pdfAtt(), docAtt('notes.txt', '원문텍스트')],
  }
  const out = toClaudeContent(turn)
  assert.deepEqual(out[0], {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'IMGDATA' },
  })
  assert.deepEqual(out[1], {
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data: 'PDFDATA' },
  })
  assert.deepEqual(out[2], {
    type: 'document',
    source: { type: 'text', media_type: 'text/plain', data: '원문텍스트' },
    title: 'notes.txt',
  })
  // text 블록은 항상 마지막
  assert.deepEqual(out[out.length - 1], { type: 'text', text: '이 파일들 봐줘' })
})

test('① toClaudeContent: 첨부 없으면 text 블록만', () => {
  const out = toClaudeContent({ role: 'user', content: 'hi' })
  assert.deepEqual(out, [{ type: 'text', text: 'hi' }])
})

// ── ② toGeminiParts ──
test('② toGeminiParts: image·pdf·document 전부 inline_data + 마지막 text', () => {
  const turn = {
    role: 'user' as const,
    content: '설명해줘',
    attachments: [imgAtt(), pdfAtt(), docAtt()],
  }
  const out = toGeminiParts(turn)
  assert.deepEqual(out[0], { inline_data: { mime_type: 'image/png', data: 'IMGDATA' } })
  assert.deepEqual(out[1], { inline_data: { mime_type: 'application/pdf', data: 'PDFDATA' } })
  assert.deepEqual(out[2], { inline_data: { mime_type: 'text/plain', data: b64('문서원문 hello') } })
  assert.deepEqual(out[3], { text: '설명해줘' })
})

// ── ③ toOpenAiContent ──
test('③ toOpenAiContent: image→data URL / pdf→file 블록 / document→text 병합 프리픽스', () => {
  const turn = {
    role: 'user' as const,
    content: '요약해줘',
    attachments: [imgAtt('pic.png'), pdfAtt('report.pdf'), docAtt('memo.txt', '메모내용')],
  }
  const out = toOpenAiContent(turn)
  assert.deepEqual(out[0], {
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,IMGDATA' },
  })
  assert.deepEqual(out[1], {
    type: 'file',
    file: { filename: 'report.pdf', file_data: 'data:application/pdf;base64,PDFDATA' },
  })
  // document는 별도 블록이 아니라 text 블록에 프리픽스 병합
  const textPart = out[out.length - 1]
  assert.equal(textPart.type, 'text')
  assert.equal((textPart as { text: string }).text, '[첨부 문서: memo.txt]\n메모내용\n\n요약해줘')
  // file/text 2개만 (document 블록 없음: image_url + file + text)
  assert.equal(out.length, 3)
})

test('③ toOpenAiContent: 첨부 없으면 content만 text 블록', () => {
  const out = toOpenAiContent({ role: 'user', content: 'plain' })
  assert.deepEqual(out, [{ type: 'text', text: 'plain' }])
})

// ── 첨부 전용 발화(빈 content) — 빈 text 블록 미방출 (§5-1 첨부전용 허용, Anthropic/OpenAI 400 방지) ──
test('빈 content + 이미지 첨부: toClaudeContent는 빈 text 블록 미포함', () => {
  const out = toClaudeContent({ role: 'user', content: '', attachments: [imgAtt()] })
  assert.equal(out.length, 1)
  assert.equal(out[0].type, 'image')
  assert.ok(!out.some((b) => b.type === 'text'))
})

test('빈 content + 이미지 첨부: toGeminiParts는 빈 text part 미포함', () => {
  const out = toGeminiParts({ role: 'user', content: '', attachments: [imgAtt()] })
  assert.equal(out.length, 1)
  assert.ok(!out.some((p) => 'text' in p))
})

test('빈 content + 이미지 첨부: toOpenAiContent는 빈 text 블록 미포함', () => {
  const out = toOpenAiContent({ role: 'user', content: '', attachments: [imgAtt()] })
  assert.equal(out.length, 1)
  assert.equal(out[0].type, 'image_url')
  assert.ok(!out.some((p) => p.type === 'text'))
})

test('빈 content + document 첨부: toOpenAiContent는 문서 프리픽스만(빈 꼬리 없음)', () => {
  const out = toOpenAiContent({ role: 'user', content: '', attachments: [docAtt('m.txt', '본문')] })
  const textPart = out[out.length - 1] as { type: string; text: string }
  assert.equal(textPart.type, 'text')
  assert.equal(textPart.text, '[첨부 문서: m.txt]\n본문') // 꼬리 '\n\n' 없음
})

// ── ④ kindOfMime ──
test('④ kindOfMime: 화이트리스트 외 null + office 3종 mime→document', () => {
  assert.equal(kindOfMime('image/png'), 'image')
  assert.equal(kindOfMime('image/gif'), null) // 미지원
  assert.equal(kindOfMime('application/pdf'), 'pdf')
  assert.equal(kindOfMime('text/plain'), 'document')
  assert.equal(
    kindOfMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    'document',
  )
  assert.equal(
    kindOfMime('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    'document',
  )
  assert.equal(
    kindOfMime('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
    'document',
  )
  assert.equal(kindOfMime('application/octet-stream'), null)
})

// ── ⑤ sniffMagicBytes ──
test('⑤ sniffMagicBytes: png/jpeg/webp/pdf 정상', () => {
  // PNG 정식 8바이트 시그니처 89 50 4E 47 0D 0A 1A 0A
  assert.equal(
    sniffMagicBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'),
    true,
  )
  // 7바이트(불완전 PNG 시그니처) 거부
  assert.equal(
    sniffMagicBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]), 'image/png'),
    false,
  )
  assert.equal(sniffMagicBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'), true)
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])
  assert.equal(sniffMagicBytes(webp, 'image/webp'), true)
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e]) // %PDF-1.
  assert.equal(sniffMagicBytes(pdf, 'application/pdf'), true)
})

test('⑤ sniffMagicBytes: RIFF이지만 WEBP 아님(WAV 위장) 거부', () => {
  // RIFF....WAVE — offset 8이 WEBP가 아니므로 거부
  const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45])
  assert.equal(sniffMagicBytes(wav, 'image/webp'), false)
})

test('⑤ sniffMagicBytes: mime 위장(mime=png, 바이트=pdf) 거부', () => {
  const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])
  assert.equal(sniffMagicBytes(pdfBytes, 'image/png'), false)
  // jpeg 선언 + png 바이트 거부
  assert.equal(sniffMagicBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), 'image/jpeg'), false)
  // 짧은 버퍼 거부
  assert.equal(sniffMagicBytes(new Uint8Array([0x89]), 'image/png'), false)
})

test('⑤ sniffMagicBytes: office 3종 ZIP 시그니처(PK\\x03\\x04)', () => {
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])
  for (const mime of [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ]) {
    assert.equal(sniffMagicBytes(zip, mime), true)
  }
  // office인데 ZIP 아님 → 거부
  assert.equal(
    sniffMagicBytes(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ),
    false,
  )
})

test('⑤ sniffMagicBytes: 텍스트 계열은 UTF-8 디코드+NUL 없음 검사', () => {
  const ok = new TextEncoder().encode('안녕 hello {"a":1}')
  assert.equal(sniffMagicBytes(ok, 'text/plain'), true)
  assert.equal(sniffMagicBytes(ok, 'application/json'), true)
  // NUL 포함 → 거부
  assert.equal(sniffMagicBytes(new Uint8Array([0x61, 0x00, 0x62]), 'text/plain'), false)
})

// ── ⑥ attachmentFallbackText ──
test('⑥ attachmentFallbackText: 개수 + 파일명 나열', () => {
  const atts = [
    { kind: 'image' as const, mime: 'image/png', filename: 'a.png', dataBase64: '' },
    { kind: 'pdf' as const, mime: 'application/pdf', filename: 'b.pdf', dataBase64: '' },
  ]
  assert.equal(
    attachmentFallbackText(atts),
    '[첨부 2개는 현재 모델에서 지원되지 않아 제외됨: a.png, b.pdf]',
  )
})

// ── ⑦ sanitizeFilenameForDisplay ──
test('⑦ sanitizeFilenameForDisplay: 제어문자·경로구분자 제거·200자 절단', () => {
  assert.equal(sanitizeFilenameForDisplay('report .pdf'), 'report.pdf')
  assert.equal(sanitizeFilenameForDisplay('../../etc/passwd'), '....etcpasswd')
  assert.equal(sanitizeFilenameForDisplay('a\\b/c.txt'), 'abc.txt')
  const long = 'x'.repeat(250) + '.pdf'
  const out = sanitizeFilenameForDisplay(long)
  assert.equal(out.length, 200)
  // 정상 파일명은 무변경
  assert.equal(sanitizeFilenameForDisplay('보고서_2026.docx'), '보고서_2026.docx')
})

// ── ⑧ extFromMime · maxBytesForMime (office 매핑) ──
test('⑧ extFromMime: 이미지/텍스트/office 고정 매핑', () => {
  assert.equal(extFromMime('image/png'), 'png')
  assert.equal(extFromMime('image/jpeg'), 'jpg')
  assert.equal(extFromMime('image/webp'), 'webp')
  assert.equal(extFromMime('application/pdf'), 'pdf')
  assert.equal(extFromMime('text/markdown'), 'md')
  assert.equal(extFromMime('application/json'), 'json')
  assert.equal(
    extFromMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    'docx',
  )
  assert.equal(
    extFromMime('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    'xlsx',
  )
  assert.equal(
    extFromMime('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
    'pptx',
  )
  assert.equal(extFromMime('application/octet-stream'), 'bin') // 미지원 폴백
})

test('⑧ maxBytesForMime: 텍스트 1MB / office 10MB / image 5MB / pdf 20MB', () => {
  assert.equal(maxBytesForMime('text/plain'), 1 * 1024 * 1024)
  assert.equal(maxBytesForMime('application/json'), 1 * 1024 * 1024)
  assert.equal(
    maxBytesForMime('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    10 * 1024 * 1024,
  )
  assert.equal(
    maxBytesForMime('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    10 * 1024 * 1024,
  )
  assert.equal(maxBytesForMime('text/csv'), 1 * 1024 * 1024) // 텍스트 계열
  assert.equal(maxBytesForMime('text/markdown'), 1 * 1024 * 1024)
  assert.equal(
    maxBytesForMime('application/vnd.openxmlformats-officedocument.presentationml.presentation'),
    10 * 1024 * 1024,
  )
  assert.equal(maxBytesForMime('image/png'), 5 * 1024 * 1024)
  assert.equal(maxBytesForMime('application/pdf'), 20 * 1024 * 1024)
  assert.equal(maxBytesForMime('application/octet-stream'), 0) // 미지원
})

// ── extractDocumentText (텍스트 경로만 — office 추출은 officeparser 필요, 수동 검증) ──
test('extractDocumentText: 텍스트 mime UTF-8 디코드', async () => {
  const buf = new TextEncoder().encode('한글 텍스트 content')
  assert.equal(await extractDocumentText(buf, 'text/plain'), '한글 텍스트 content')
  assert.equal(await extractDocumentText(new TextEncoder().encode('{"k":1}'), 'application/json'), '{"k":1}')
})

test('extractDocumentText: MAX_DOCUMENT_TEXT_CHARS 초과 시 절단 + [이하 절단]', async () => {
  const big = 'a'.repeat(MAX_DOCUMENT_TEXT_CHARS + 500)
  const out = await extractDocumentText(new TextEncoder().encode(big), 'text/plain')
  assert.equal(out.length, MAX_DOCUMENT_TEXT_CHARS + '[이하 절단]'.length)
  assert.ok(out.endsWith('[이하 절단]'))
  assert.equal(out.slice(0, MAX_DOCUMENT_TEXT_CHARS), big.slice(0, MAX_DOCUMENT_TEXT_CHARS))
})

test('extractDocumentText: NUL 바이트 포함 시 throw', async () => {
  await assert.rejects(
    () => extractDocumentText(new Uint8Array([0x61, 0x00, 0x62]), 'text/plain'),
    /추출하지 못했습니다/,
  )
})

test('extractDocumentText: 미지원 mime throw', async () => {
  await assert.rejects(
    () => extractDocumentText(new TextEncoder().encode('x'), 'image/png'),
    /추출하지 못했습니다/,
  )
})
