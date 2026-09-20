/**
 * 원본 조각 규칙 가드
 *
 * **여기서 틀리면 틀린 쪽을 오린다.** 틀린 조각은 맞는 것처럼 보이기 때문에
 * 안 오린 것보다 나쁘다 — 사람은 그 그림과 견적을 대조하고 「맞네」 하고 넘어간다.
 *
 * 그리기(`renderPdfPage`)는 캔버스가 있어야 도니 여기서 안 부른다.
 * 대신 **부를지 말지의 규칙**을 전부 밟는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { planSnapshot, snapshotFileName, SNAPSHOT_WIDTH } from './quote-snapshot.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (rel: string) => readFileSync(join(WEB, rel), 'utf8')

const base = { enabled: true, mimeType: 'application/pdf', pageStart: 2 }

test('★ 켜져 있고 PDF 이고 쪽을 알면 오린다', () => {
  assert.deepEqual(planSnapshot(base), { make: true, page: 2 })
})

test('★ 설정에서 끄면 안 오린다 — 켜고 끄는 것이 실제로 먹어야 설정이다', () => {
  assert.deepEqual(planSnapshot({ ...base, enabled: false }), { make: false, reason: 'off' })
})

test('★ 쪽을 모르면 안 오린다 — 틀린 쪽에서 오린 그림이 안 오린 것보다 나쁘다', () => {
  assert.deepEqual(planSnapshot({ ...base, pageStart: null }), { make: false, reason: 'no_page' })
  assert.deepEqual(planSnapshot({ ...base, pageStart: 0 }), { make: false, reason: 'no_page' })
  assert.deepEqual(planSnapshot({ ...base, pageStart: -1 }), { make: false, reason: 'no_page' })
})

test('PDF 가 아니면 안 오린다 — 엑셀·한글은 오릴 쪽이라는 것이 없다', () => {
  assert.deepEqual(planSnapshot({ ...base, mimeType: 'image/png' }), { make: false, reason: 'not_drawable' })
  assert.deepEqual(planSnapshot({ ...base, mimeType: null }), { make: false, reason: 'not_drawable' })
  assert.deepEqual(
    planSnapshot({ ...base, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    { make: false, reason: 'not_drawable' })
})

test('대문자 형식도 받는다 — 브라우저가 주는 값을 우리가 고르지 않는다', () => {
  assert.deepEqual(planSnapshot({ ...base, mimeType: 'APPLICATION/PDF' }), { make: true, page: 2 })
})

test('소수 쪽은 내림한다 — 2.7쪽 같은 것은 없다', () => {
  assert.deepEqual(planSnapshot({ ...base, pageStart: 2.7 }), { make: true, page: 2 })
})

test('★ 조각 이름이 원본 이름으로 시작한다 — 첨부 목록에서 같은 문서로 보여야 한다', () => {
  assert.equal(snapshotFileName('DA견적서_광양분소.pdf', 2), 'DA견적서_광양분소_2쪽.png')
  // 파일명에 못 쓰는 글자는 걷어낸다 — 안 걷으면 업로드가 그 자리에서 죽는다
  assert.equal(snapshotFileName('a/b:c.pdf', 1), 'abc_1쪽.png')
  assert.equal(snapshotFileName('.pdf', 3), '원본_3쪽.png')
})

/* ── 화면이 실제로 그 규칙을 부르나 ───────────────── */

test('★ 파일 가져오기가 규칙을 부르고 결과를 값으로 쓴다 — 선언만으로는 안 붙는다', () => {
  const src = read('components/ui/crm/QuoteFromFileModal.tsx')
  assert.match(src, /planSnapshot\(\{/, '규칙을 안 부른다')
  assert.match(src, /renderPdfPage\(/, '그리지 않는다')
  assert.match(src, /sourceSnapshotId/, '오려 놓고 견적에 안 잇는다')
})

test('★ 조각도 원본과 같은 종류로 올라간다 — 종류가 대외비 등급을 정한다', () => {
  const src = read('components/ui/crm/QuoteFromFileModal.tsx')
  const attach = src.slice(src.indexOf('const attachSource'), src.indexOf('const submit'))
  assert.match(attach, /form\.append\('kind', 'SUPPLY_QUOTE'\)/,
    '조각이 다른 종류로 올라가면 원본은 잠겨 있는데 조각만 열린 상태가 된다')
})

test('★ 그리기 도구는 그 자리에서만 불러온다 — 위에서 물면 견적 화면 전체가 무거워진다', () => {
  const src = read('lib/crm/ui/quote-snapshot.ts')
  const head = src.slice(0, src.indexOf('export function planSnapshot'))
  assert.ok(!/^import .*pdfjs/m.test(head), '맨 위에서 그리기 도구를 물고 있다')
  assert.match(src, /await import\('pdfjs-dist'\)/, '동적으로 안 불러온다')
})

test('그림 크기가 대조 화면에서 글자가 읽히는 선이다', () => {
  assert.ok(SNAPSHOT_WIDTH >= 1200, '작으면 오려 놓고도 글자를 못 읽는다')
})
