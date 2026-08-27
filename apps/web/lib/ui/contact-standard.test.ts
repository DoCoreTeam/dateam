// lib/ui/contact-standard.test.ts — "닿는 길"과 "이어져 있는 것"의 표준 가드
//
// **왜 이 가드가 생겼나**: v0.7.598 에서 인물의 이메일·전화만 `ContactLink` 로 고치고
// **같은 성격의 값과 자리를 그대로 뒀다** — 회사의 도메인 3곳은 평문이었고, 회사·딜 상세는
// 담당자의 `email` 을 서버에서 받아 놓고 화면에서 버려서 **그 화면에서는 연락이 불가능**했다.
// (사용자 지적: "인물만 지적했다고 또 인물만 구현했네? … 연관된거 다 동일한 UX가 되려면
//  UI 셋업도 동일하게 공통컴포넌트 형식으로 이용되야 하는거 아니야? 너 정책을 무시하니?")
//
// 한 번 치우는 것으로는 다시 갈린다. 규칙을 코드로 세운다(§2-5 동종 UI 통일).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { walkFiles, read, stripComments } from './component-scan.ts'

const SCAN_ROOTS = ['app', 'components']

/** 검사에서 빼는 자리 — 값을 "보여 주는" 곳이 아니라 "입력·검색·전송"하는 곳 */
const NOT_A_DISPLAY = /FormModal|Form\.tsx|ContactLink|contact\/format|\.test\.ts|RecordPicker/

function scan(): { file: string; src: string }[] {
  const out: { file: string; src: string }[] = []
  for (const root of SCAN_ROOTS) {
    for (const f of walkFiles(root, ['.tsx'])) {
      if (NOT_A_DISPLAY.test(f)) continue
      out.push({ file: f, src: stripComments(read(f)) })
    }
  }
  return out
}

test('연락 수단은 ContactLink 로만 그린다 — 화면이 tel:·mailto: 를 직접 쓰지 않는다', () => {
  // 왜: 화면이 직접 앵커를 쓰면 클래스를 빠뜨려 "링크인데 평문으로 보이는" 상태가 된다.
  // 실제로 인물 상세의 mailto 가 그 상태였다 — 있는데 누를 수 있는 줄 아무도 몰랐다.
  const bad: string[] = []
  for (const { file, src } of scan()) {
    if (/href=[{"'`]*\s*[`"']?(tel:|mailto:)/.test(src)) bad.push(file)
  }
  assert.deepEqual(bad, [], `ContactLink 를 쓰세요(자작 tel:/mailto: 앵커):\n${bad.join('\n')}`)
})

test('홈페이지·도메인도 같은 부품으로 그린다 — 화면이 target=_blank 앵커를 자작하지 않는다', () => {
  const bad: string[] = []
  for (const { file, src } of scan()) {
    // **값 자체를 앵커의 내용으로 그리는 것**만 잡는다.
    // 저장·취소와 같은 줄에 서는 `[사이트]` 같은 액션 버튼은 성격이 달라 제외한다
    // (그 자리는 값이 아니라 행동이고, ContactLink 를 넣으면 버튼 줄이 깨진다).
    for (const m of src.matchAll(/<a\b[^>]*href=\{([^}]*\.(?:website|domain))\}[\s\S]*?<\/a>/g)) {
      const expr = m[1].trim()
      const inner = m[0].slice(m[0].indexOf('>') + 1)
      if (inner.includes(expr)) { bad.push(file); break }
    }
  }
  assert.deepEqual(bad, [], `ContactLink kind="domain" 을 쓰세요:\n${bad.join('\n')}`)
})

test('상세의 "이어져 있는 것" 목록은 RelatedList 로만 그린다', () => {
  // 왜: RecordLayout 으로 골격은 통일해 놓고 그 안의 목록은 화면마다 다시 짜고 있었다(4곳).
  // 그래서 어떤 화면은 연락처가 보이고 어떤 화면은 안 보였다.
  const bad: string[] = []
  for (const { file, src } of scan()) {
    if (!/RecordPanel/.test(src)) continue
    // **다른 레코드로 가는 목록**만 잡는다 — 링크가 한 줄도 없는 이력 레일
    // (DealDetail 의 '단계 이동 이력')은 성격이 다른 UI 라 RelatedList 로 바꾸면 오히려 어긋난다.
    for (const m of src.matchAll(/<(ul|ol)\s+style=\{\{[^}]*listStyle[\s\S]*?<\/\1>/g)) {
      if (/<Link\s+href=/.test(m[0])) { bad.push(file); break }
    }
  }
  assert.deepEqual(bad, [], `RelatedList 를 쓰세요(RecordPanel 안의 자작 목록):\n${bad.join('\n')}`)
})

test('연락처를 받아 놓고 화면에서 버리지 않는다 — 관련 인물 목록은 닿는 길을 함께 준다', () => {
  // 왜: 회사·딜 상세가 서버에서 email 을 받아 화면에서 안 그렸다. 데이터가 없어서가 아니라
  // 그리지 않아서 연락을 못 했다 — 이건 "표시 누락"이 아니라 기능 결함이다.
  const MUST_WIRE = [
    'app/(crm)/crm/companies/[id]/CompanyDetail.tsx',
    'app/(crm)/crm/deals/[id]/DealContacts.tsx',
  ]
  const bad: string[] = []
  for (const f of MUST_WIRE) {
    const src = stripComments(read(f))
    const takesContact = /\bemail\b/.test(src)
    if (takesContact && !/ContactLink|contacts:\s*\{/.test(src)) bad.push(f)
  }
  assert.deepEqual(bad, [], `받은 연락처를 화면에 연결하세요:\n${bad.join('\n')}`)
})
