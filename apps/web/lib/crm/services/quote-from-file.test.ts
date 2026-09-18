/**
 * 견적서 파일 인입 가드
 *
 * **여기가 문이다.** 이 문을 지난 파일만 모델에 닿고, 모델이 읽은 값이 견적 항목이 된다.
 * 그래서 ⓐ 무엇을 받고 ⓑ 어느 길로 읽고 ⓒ 아무것도 저장하지 않는다 를 잠근다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  checkQuoteFile, initialQuoteFileRoute, needsVisionFallback, visionMime,
  MAX_QUOTE_FILE_BYTES, ALLOWED_KINDS, MIN_USEFUL_CHARS,
} from './quote-from-file.ts'

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf-8')
const SERVICE = read('lib/crm/services/quote-from-file.ts')
const ROUTE = read('app/api/crm/quotes/draft-file/route.ts')
const HOST = read('lib/crm/ai/adapters/host.ts')
const NEXT_CONFIG = read('next.config.js')

/** 앞머리 바이트로 종류가 정해진다 — 이름만으로는 안 받는다 */
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ZIP_DOCX = new Uint8Array([
  ...[0x50, 0x4b, 0x03, 0x04],
  ...Buffer.from('x'.repeat(26) + 'word/document.xml' + 'y'.repeat(200), 'latin1'),
])
const TEXT = new Uint8Array(Buffer.from('품목 | 수량 | 단가\nH100 | 2 | 50000000', 'utf8'))

/* ── 무엇을 받나 ─────────────────────────────────── */

test('★ PDF·이미지·오피스·평문을 받는다 — 사용자가 손에 쥔 형식이다', () => {
  assert.equal(checkQuoteFile({ fileName: '견적서.pdf', bytes: PDF }).ok, true)
  assert.equal(checkQuoteFile({ fileName: '견적서.png', bytes: PNG }).ok, true)
  assert.equal(checkQuoteFile({ fileName: '견적서.docx', bytes: ZIP_DOCX }).ok, true)
  assert.equal(checkQuoteFile({ fileName: '견적서.txt', bytes: TEXT }).ok, true)
})

test('★ 한글(hwp·hwpx)도 받는다 — 국내 견적서는 한글로 오는 일이 흔하다', () => {
  assert.ok(ALLOWED_KINDS.includes('hwp'))
  assert.ok(ALLOWED_KINDS.includes('hwpx'))
})

test('★ 압축 파일은 거절한다 — 어느 것이 최종 견적서인지 몰라 옛 판으로 견적을 만든다', () => {
  const zip = new Uint8Array([
    ...[0x50, 0x4b, 0x03, 0x04],
    ...Buffer.from('z'.repeat(300), 'latin1'),
  ])
  const r = checkQuoteFile({ fileName: '견적묶음.zip', bytes: zip })
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.reason, 'bundle_not_allowed')
})

test('★ 빈 파일은 거절한다', () => {
  const r = checkQuoteFile({ fileName: '견적서.pdf', bytes: new Uint8Array(0) })
  assert.equal(r.ok === false && r.reason, 'empty')
})

test('★ 크기 상한이 있다 — 파서를 부르기 전에 본다', () => {
  const big = new Uint8Array(MAX_QUOTE_FILE_BYTES + 1)
  big.set(PDF)
  const r = checkQuoteFile({ fileName: '견적서.pdf', bytes: big })
  assert.equal(r.ok === false && r.reason, 'too_large')
})

test('★ 이름과 내용이 다르면 거절한다 — 확장자를 믿고 파서를 고르면 엉뚱한 파서가 죽는다', () => {
  const r = checkQuoteFile({ fileName: '견적서.pdf', bytes: PNG })
  assert.equal(r.ok === false && r.reason, 'kind_mismatch')
})

/* ── 어느 길로 읽나 ──────────────────────────────── */

test('★ 그림은 그림째 읽는다 — 파서가 읽을 글자가 없다', () => {
  assert.equal(initialQuoteFileRoute('image'), 'vision')
})

test('글자가 있는 문서는 파서로 읽는다', () => {
  for (const kind of ['pdf', 'ooxml', 'hwp', 'text'] as const) {
    assert.equal(initialQuoteFileRoute(kind), 'text')
  }
})

test('★ 글자가 거의 없는 PDF 는 그림째 다시 본다 — 스캔 견적서가 「항목 없음」으로 끝나던 자리다', () => {
  assert.equal(needsVisionFallback('pdf', ''), true)
  assert.equal(needsVisionFallback('pdf', '가'.repeat(MIN_USEFUL_CHARS - 1)), true)
  assert.equal(needsVisionFallback('pdf', '가'.repeat(MIN_USEFUL_CHARS)), false)
})

test('엑셀·워드는 글자가 없으면 정말 빈 문서다 — 그림으로 보낼 것도 없다', () => {
  assert.equal(needsVisionFallback('ooxml', ''), false)
  assert.equal(needsVisionFallback('hwp', ''), false)
})

test('★ 그림째 보낼 MIME 은 첨부 규칙이 받는 것만 — 새 목록을 여기 또 적지 않는다', () => {
  assert.equal(visionMime('pdf', 'application/pdf'), 'application/pdf')
  assert.equal(visionMime('image', 'image/png'), 'image/png')
  assert.equal(visionMime('image', 'image/jpeg'), 'image/jpeg')
  // 첨부 규칙에 없는 그림은 보낼 수 없다
  assert.equal(visionMime('image', 'image/tiff'), null)
  assert.equal(visionMime('ooxml', 'application/octet-stream'), null)
})

test('★ 길을 고르는 자리가 하나다 — 서비스가 스스로 판단을 두 번 하지 않는다', () => {
  const decisions = SERVICE.match(/kind === 'image'/g) ?? []
  assert.equal(decisions.length, 1, `그림 판정이 ${decisions.length}곳이다`)
})

/* ── 아무것도 저장하지 않는다 ────────────────────── */

test('★ 서비스가 DB 에 쓰지 않는다 — 초안만 돌려준다(§5-3 자동 등록 금지)', () => {
  for (const banned of ['\\.create\\(', '\\.update\\(', '\\.upsert\\(', 'withCrmTx', 'insert\\(']) {
    assert.ok(
      !new RegExp(banned).test(SERVICE),
      `쓰기 호출이 들어왔다: ${banned}`,
    )
  }
})

test('★ 올린 파일을 저장하지 않는다 — 같은 파일이 두 곳에 남으면 지울 때 한 곳이 남는다', () => {
  assert.ok(!/storage|upload|putObject/i.test(SERVICE), '파일 보관 호출이 들어왔다')
})

/* ── 창구 ───────────────────────────────────────── */

test('★ 창구는 withCrmApi 를 지난다 — 인증·권한·오류·시스템 로그가 한 곳이다', () => {
  assert.match(ROUTE, /withCrmApi\('MEMBER'/)
})

test('★ 창구가 크기를 먼저 본다 — 다 읽고 거절하면 그 시간은 그냥 기다린 것이다', () => {
  assert.match(ROUTE, /file\.size > MAX_QUOTE_FILE_BYTES/)
  // 바이트를 읽는 줄보다 앞에 있어야 한다
  assert.ok(
    ROUTE.indexOf('file.size > MAX_QUOTE_FILE_BYTES') < ROUTE.indexOf('arrayBuffer()'),
    '크기 검사가 arrayBuffer() 뒤에 있다',
  )
})

test('★ 그림 경로는 시간 한계가 더 길다 — 같은 한계면 그림만 늘 죽는다', () => {
  const m = ROUTE.match(/maxDuration = (\d+)/)
  assert.ok(m, 'maxDuration 이 없다')
  assert.ok(Number(m[1]) > 120, `붙여넣기 경로(120)보다 짧거나 같다(${m[1]})`)
})

/* ── AI 호출은 한 길로 ───────────────────────────── */

test('★ 모든 AI 호출이 runAi 를 지난다 — 기록·예산·재시도가 거기 있다', () => {
  assert.match(SERVICE, /runAi</)
  assert.ok(!/fetch\(/.test(SERVICE), '서비스가 직접 HTTP 를 부른다')
  assert.ok(!/callGemini/.test(SERVICE), '서비스가 벤더를 직접 부른다')
})

test('★ 어댑터 결정을 다시 구현하지 않는다 — 호스트 설정 한 곳에서 온다', () => {
  assert.match(SERVICE, /adapterFromSetting\(/)
  assert.ok(!/hostAdapter\(/.test(SERVICE), '어댑터를 직접 만든다')
})

test('★ 그림을 못 보는 모델로는 안 간다 — 조용히 빼면 「읽었는데 항목이 없다」가 된다', () => {
  // 예전엔 고른 모델이 그림을 못 보면 그 자리에서 실패했다.
  // 지금은 그림을 보는 공급자를 후보로 고르고, 하나도 없을 때만 실패한다
  assert.match(HOST, /vision: attachments\.length > 0/)
  assert.match(HOST, /meetsRequirements\(capabilities\[c\.provider\], requires\)/)
  assert.match(HOST, /그림을 읽을 수 있는 AI 모델이 없습니다/)
})

test('★ 첨부 변환은 호스트 첨부 계층이 한다 — 프로바이더별 변환을 CRM 이 또 짜지 않는다', () => {
  assert.ok(
    !/inline_data|image_url|media_type/.test(SERVICE) && !/inline_data|image_url/.test(HOST),
    '프로바이더 형식을 직접 조립한다',
  )
})

/* ── 배포본 ─────────────────────────────────────── */

test('★ 한글 파서 wasm 을 배포본에 싣는다 — 없으면 hwp 만 프로덕션에서 죽는다(B-2)', () => {
  assert.match(NEXT_CONFIG, /'\/api\/crm\/quotes\/draft-file': RHWP_WASM/)
})

/* ── 파서 재사용 ─────────────────────────────────── */

test('★ 파서를 새로 만들지 않는다 — RFP 인입이 쓰는 그 파서를 그대로 쓴다', () => {
  assert.match(SERVICE, /from '\.\.\/\.\.\/rfp\/parse\/index\.ts'/)
  assert.match(SERVICE, /irToSourceText/)
})
