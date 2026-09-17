/**
 * 공고 올리기 화면이 링크를 실제로 부르는지 잠근다
 *
 * ## 왜 이 파일이 생겼나
 *
 * 말만 써 놓고 칸을 안 만드는 것이 이 저장소가 반복한 사고다.
 * 실제로 `noticeNoLabel`·`fetchNotice` 는 terms 에 **있었는데 쓰는 곳이 0곳**이었고,
 * 사용자는 「링크 올려도 되게 한다고 했잖아」라고 물었다.
 *
 * 그래서 여기서 본다 — 창구가 있는가, 화면이 그 창구를 부르는가, 말은 terms 를 거치는가.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { RFP_INTAKE, rfpNoticeReasonText, RFP_NOTICE_REASON } from '../terms.ts'

const WEB = join(import.meta.dirname, '..', '..', '..')
const read = (p: string) => readFileSync(join(WEB, p), 'utf8')
const PANEL = 'components/rfp/UploadPanel.tsx'

test('★ 링크 칸과 가져오기 단추가 화면에 있다 — 말만 있고 칸이 없던 것이 이 일의 시작이다', () => {
  const src = read(PANEL)
  assert.match(src, /RFP_INTAKE\.linkLabel/)
  assert.match(src, /RFP_INTAKE\.linkPlaceholder/)
  assert.match(src, /RFP_INTAKE\.fetchNotice/)
  // 표준 입력 클래스를 써야 테마가 먹는다. raw input 은 브라우저 기본으로 그려진다
  assert.match(src, /className="input-field"/)
})

test('★ 가져오면 저장 전에 보여 준다 — 사업명·첨부 건수·공고 열기', () => {
  const src = read(PANEL)
  assert.match(src, /\/api\/rfp\/intake\/notice-url/, '미리보기 창구를 부른다')
  assert.match(src, /notice\.title/)
  assert.match(src, /notice\.attachments\.length/)
  assert.match(src, /RFP_INTAKE\.openNotice/, '우리가 못 찾아도 사람이 열 주소는 준다')
  assert.match(src, /rfpNoticeReasonText\(notice\.reason\)/, '왜 못 찾았는지 말한다')
})

test('★ 링크만으로도 시작할 수 있다 — 파일 0건이 막는 조건이면 안 된다', () => {
  const src = read(PANEL)
  // 예전 조건은 usable > 0 하나였다. 링크가 있으면 첨부는 서버가 받아 온다
  assert.doesNotMatch(src, /canSubmit\s*=\s*Boolean\(docClass\)\s*&&\s*usable\s*>\s*0/)
  assert.match(src, /const hasSource = usable > 0 \|\| \(notice\?\.attachments\.length \?\? 0\) > 0/)
  assert.match(src, /canSubmit = Boolean\(docClass\) && hasSource/)
  assert.match(src, /\/api\/rfp\/cases\/from-url/, '링크로 케이스를 만드는 창구를 부른다')
})

test('★ 파일을 이어 올리면 분석은 다 올린 다음 건다 — 먼저 걸면 그 파일이 빠진다', () => {
  const src = read(PANEL)
  assert.match(src, /analyze: !moreFiles/)
  assert.match(src, /if \(!notice \|\| usable > 0\) \{/)
})

test('★ 화면에 한글을 직접 쓰지 않는다 — 말은 terms 한자리에서 온다', () => {
  const src = read(PANEL)
  const lines = src.split('\n')
  const offenders = lines
    .map((line, i) => ({ line, no: i + 1 }))
    // 주석은 설명이라 대상이 아니다
    .filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .filter(({ line }) => /['"`][^'"`]*[가-힣]/.test(line))
  assert.deepEqual(offenders.map((o) => `${o.no}: ${o.line.trim()}`), [])
})

test('★ 두 창구가 실제로 있다 — 등재가 거짓말이면 화면이 404 를 부른다', () => {
  for (const p of [
    'app/api/rfp/intake/notice-url/route.ts',
    'app/api/rfp/cases/from-url/route.ts',
  ]) {
    assert.equal(existsSync(join(WEB, p)), true, p)
  }
})

test('사유마다 다음 손이 다르다 — 「실패」만 보여 주면 사용자가 할 일이 없다', () => {
  // 목록 주소를 붙여넣은 사람과 첨부가 없는 공고를 붙여넣은 사람은 서로 다른 것을 해야 한다
  assert.notEqual(RFP_NOTICE_REASON.no_notice_no, RFP_NOTICE_REASON.no_attachment_on_page)
  // 쪽이 404·500 으로 답한 것도 말은 해야 한다
  assert.equal(rfpNoticeReasonText('http_404'), RFP_NOTICE_REASON.fetch_failed)
  // 서버가 더 구체적인 안내를 주면 그것이 먼저다
  assert.equal(rfpNoticeReasonText('no_service_key', '키를 넣어 주세요'), '키를 넣어 주세요')
  // 모르는 사유여도 빈 화면은 안 된다
  assert.ok(rfpNoticeReasonText('처음 보는 사유').length > 0)
  assert.ok(RFP_INTAKE.linkHint.length > 0)
})
