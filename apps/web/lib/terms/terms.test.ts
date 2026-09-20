/**
 * 용어집 상수 단위 테스트
 *
 * 조사·조수사가 붙는 자리를 특히 본다 — **손으로 적으면 반드시 틀리는 자리**다.
 * (실측: 화면이 21번 "API이(가)"라고 말했다 · v0.7.595)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ACTION, BANNED_TERMS, MEETING_CAPTURE_LABEL, createLabel, progress,
  settingFieldState, SETTING_SAVE_LABEL, settingSaveDisabled,
} from './action.ts'
import { AI_KEY } from './ai-key.ts'
import { ENTITY, SURFACE_LABEL, count, countOnly, type EntityKey } from './entity.ts'
import { fillFoundLine, fillFoundQuotesLine } from './quote.ts'
import { emptyTitle, failedTo, confirmDelete, notEnough } from './sentence.ts'
import { roundingUnitName, roundingUnitLabel, roundingNote } from './quote.ts'
import { ROUNDING_UNITS } from '../crm/domain/quote-math.ts'
import { readFileSync } from 'node:fs'

test('진행 표기는 공백 + 말줄임표를 둘 다 갖는다', () => {
  assert.equal(progress(ACTION.save), '저장 중…')
  assert.equal(progress(ACTION.delete), '삭제 중…')
  // 실측 위반 모양이 다시 나오지 않는지
  assert.notEqual(progress('삭제'), '삭제중')
})

test('새로 만드는 진입은 「새 {개체}」', () => {
  assert.equal(createLabel(ENTITY.deal.label), '새 딜')
  assert.equal(createLabel(ENTITY.company.label), '새 회사')
})

test('미팅만 「미팅 기록」 — 만드는 게 아니라 받아적는 행위라서', () => {
  assert.equal(MEETING_CAPTURE_LABEL, '미팅 기록')
  assert.notEqual(MEETING_CAPTURE_LABEL, createLabel(ENTITY.meeting.label))
})

test('조수사는 넷뿐이고 개체마다 하나로 고정된다', () => {
  const allowed = new Set(['건', '곳', '명', '개'])
  for (const [key, meta] of Object.entries(ENTITY)) {
    assert.ok(allowed.has(meta.counter), `${key}: 허용되지 않은 조수사 ${meta.counter}`)
  }
  assert.equal(count('deal', 3), '딜 3건')
  assert.equal(count('company', 372), '회사 372곳')
  assert.equal(count('pipeline', 4), '파이프라인 4개')
  assert.equal(countOnly('task', 2), '2건')
})

test('식별자가 겹치지 않는다 — 겹치면 API·URL 이 충돌한다', () => {
  const ids = Object.values(ENTITY).map((e) => e.id)
  assert.equal(new Set(ids).size, ids.length, `중복 식별자: ${ids.join(', ')}`)
})

test('모든 개체가 표면을 갖고, 표면 라벨이 정의돼 있다', () => {
  for (const [key, meta] of Object.entries(ENTITY)) {
    assert.ok(SURFACE_LABEL[meta.surface], `${key}: 표면 라벨 없음`)
  }
})

test('빈 상태 제목이 조사를 맞게 붙인다', () => {
  assert.equal(emptyTitle('deal'), '딜이 아직 없어요')       // 딜 = 받침 ㄹ → 이
  assert.equal(emptyTitle('company'), '회사가 아직 없어요')   // 회사 = 받침 없음 → 가
  assert.equal(emptyTitle('meeting'), '미팅이 아직 없어요')   // 미팅 = 받침 ㅇ → 이
})

test('오류 문장은 사과하지 않고 다음 조치를 준다', () => {
  const msg = failedTo('회의노트', '만들지')
  assert.equal(msg, '회의노트를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.')
  assert.ok(!/죄송|불편/.test(msg), '오류 문장에 사과가 들어가면 안 된다')
})

test('삭제 확인의 조사는 조수사에 붙는다 — 3건을 / 4개를', () => {
  assert.equal(confirmDelete('meeting', 1), '미팅 1건을 삭제할까요?')
  assert.equal(confirmDelete('company', 3), '회사 3곳을 삭제할까요?')
  // '개'는 받침이 없으므로 '를' 이어야 한다 — 손으로 적으면 '개을'이 나온다
  assert.equal(confirmDelete('pipeline', 4), '파이프라인 4개를 삭제할까요?')
})

test('삭제 확인은 사라지는 것과 남는 것을 둘 다 말한다 (R-5)', () => {
  const msg = confirmDelete('meeting', 1, { alsoGone: '참석자 연결', stays: '회의노트 원본' })
  assert.match(msg, /함께 사라지고/)
  assert.match(msg, /남습니다/)
})

test('근거 부족은 숫자를 지어내지 않는다는 말투를 쓴다', () => {
  assert.match(notEnough('배수', '비교할 게시물이 3건뿐'), /어려워요/)
  assert.match(notEnough('근거'), /부족해/)
})

test('금지어 표는 자기모순이 없고 이유가 적혀 있다', () => {
  const bads = new Set(BANNED_TERMS.map((t) => t.bad))
  for (const t of BANNED_TERMS) {
    assert.ok(!bads.has(t.good), `대체어 「${t.good}」 가 다시 금지어다 — 무한 이관`)
    assert.ok(t.why.trim(), `「${t.bad}」 왜 금지하는지 없음`)
  }
})

test('표준 행위 라벨이 금지어 목록에 들어 있지 않다', () => {
  const bads = new Set(BANNED_TERMS.map((t) => t.bad))
  for (const [key, label] of Object.entries(ACTION)) {
    if (key === 'create') continue // '새' 는 단독으로 안 쓴다
    assert.ok(!bads.has(label), `표준어 「${label}」 가 금지어 목록에 있다`)
  }
})

/*
  ── 절사 — 단위 이름과 「무엇에 맞췄나」 ──────────────────────────────────
  사용자 지적(2026-09-08 · v0.7.698): 「백만원 단위 버림」인데 화면이 깎인 금액
  「− 600,000원」만 보여 줘서 **십만원 단위로 읽혔다.**
  숫자는 맞았고 말이 없었다 — 그래서 말을 상수로 만들고 여기서 잠근다.
*/

test('절사 설명은 «무엇에 맞췄는지»를 말한다 — 깎인 금액의 자릿수로 역산하지 않게', () => {
  assert.equal(roundingNote(1_000_000, 'DOWN'), '백만원 미만을 버려서 합계가 백만원 단위로 떨어져요.')
  assert.equal(roundingNote(100_000, 'DOWN'), '십만원 미만을 버려서 합계가 십만원 단위로 떨어져요.')
  assert.equal(roundingNote(1_000_000, 'UP'), '백만원 단위가 되도록 모자란 만큼 올렸어요.')
  assert.equal(roundingNote(1_000_000, 'NEAREST'), '합계를 백만원 단위로 반올림했어요.')
  // 절사를 안 하면 할 말이 없다 — 빈 문장을 만들지 않는다
  assert.equal(roundingNote(0, 'DOWN'), null)
  assert.equal(roundingUnitName(0), null)
  assert.equal(roundingUnitName(1_000_000), '백만원')
})

test('고를 수 있는 단위에는 **전부** 이름이 있다 — 목록만 늘리면 라벨이 빈칸이 된다', () => {
  for (const u of ROUNDING_UNITS) {
    if (u === 0) { assert.equal(roundingUnitLabel(0), '안 함'); continue }
    assert.ok(roundingUnitName(u), `${u} 원 단위에 이름이 없다`)
    assert.equal(roundingUnitLabel(u), `${roundingUnitName(u)} 단위`)
  }
})

test('화면이 절사 단위 목록을 다시 만들지 않는다 — 값은 quote-math 한 곳이다', () => {
  const screens = [
    '../../components/ui/crm/QuoteEditorModal.tsx',
    '../../components/ui/crm/QuoteTotals.tsx',
    '../../app/(crm)/crm/quotes/[id]/QuoteSheet.tsx',
  ]
  for (const rel of screens) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8')
    assert.ok(
      !/label:\s*'(천원|만원|십만원|백만원) 단위'/.test(src),
      `${rel} 이 절사 단위 목록을 자기 안에 또 만들었다 — @/lib/terms 를 쓴다`,
    )
  }
})

/*
  합계·절사는 편집 모달에서 **옆 파일(QuoteTotals)로 옮겼다.** 모달이 1,157줄이 되면서
  「얼마인가」를 고치러 온 사람이 항목 스무 줄을 지나쳐 내려가야 했다.
  가드는 코드를 따라간다 — 자리를 안 옮기면 옮긴 코드가 검사 밖으로 나간다.
*/
const TOTALS_FILE = '../../components/ui/crm/QuoteTotals.tsx'

test('견적 편집이 절사 결과를 말한다 — 숫자만 두면 오해가 다시 생긴다', () => {
  const src = readFileSync(new URL(TOTALS_FILE, import.meta.url), 'utf8')
  assert.ok(src.includes('roundingNote('), '절사 설명 줄이 사라졌다')
  // 올림이면 절사액이 음수라 «> 0» 으로 걸면 줄이 통째로 사라진다
  assert.ok(!src.includes('totals.roundingMinor > BigInt(0)\n'), '절사 줄이 양수일 때만 뜨면 올림에서 사라진다')
})

test('절사 선택지가 결과 금액을 함께 보여준다 — 이름만으로는 어느 쪽인지 못 고른다', () => {
  const src = readFileSync(new URL(TOTALS_FILE, import.meta.url), 'utf8')
  // 라벨 옆에 그 단위로 맞췄을 때의 합계를 계산해 붙인다
  assert.ok(src.includes('roundAmount(totals.netTotalMinor'), '선택지가 결과 금액을 안 보여준다')
  assert.ok(src.includes('roundingUnitLabel('), '라벨을 용어집에서 안 가져온다')
})

/*
  ── 단위 목록은 한 벌이다 ──────────────────────────────────────────────────
  실측(v0.7.700): 같은 목록이 **네 곳**에 있었다 —
  ① `quote-math.ts`(값·DB CHECK 와 짝) ② 편집 화면 선택지 ③ 서버 검증 오류 문구
  ④ AI 「말로 채우기」 스키마. 천만원을 하나 더할 때 ①만 고쳤다면
  화면에는 뜨는데 AI 가 그 값을 버리고, 오류 문구는 옛 목록을 말했을 것이다.
*/
test('절사 단위 목록을 다시 적은 곳이 없다 — 늘릴 때 한 곳만 고치면 된다', () => {
  const files = [
    '../crm/ai/schemas/quote-draft.ts',
    '../crm/services/quote.ts',
    '../../components/ui/crm/QuoteEditorModal.tsx',
  ]
  for (const rel of files) {
    const src = readFileSync(new URL(rel, import.meta.url), 'utf8')
    assert.ok(
      !/\[\s*0,\s*1000,\s*10000\b/.test(src) && !/1000,\s*10000,\s*100000,\s*1000000/.test(src),
      `${rel} 이 단위 목록을 또 적었다 — quote-math 의 ROUNDING_UNITS 를 쓴다`,
    )
  }
})

test('DB 가 받는 단위와 코드가 아는 단위가 같다 — 마이그 244 와 짝이다', () => {
  const sql = readFileSync(
    new URL('../../../../supabase/migrations/244_crm_quote_rounding_ten_million.sql', import.meta.url), 'utf8')
  for (const u of ROUNDING_UNITS) {
    assert.ok(new RegExp(`\\b${u}\\b`).test(sql), `${u} 가 DB CHECK 에 없다 — 저장하면 거부당한다`)
  }
})

test('★ RFP 개체 여덟이 용어집에 있고 세는 말이 붙어 있다', () => {
  const rfp: { key: EntityKey; label: string; counter: string }[] = [
    { key: 'bid', label: '공고', counter: '건' },
    { key: 'project', label: '사업', counter: '건' },
    { key: 'doc', label: '문서', counter: '건' },
    { key: 'requirement', label: '요구사항', counter: '건' },
    { key: 'anomaly', label: '이상 조항', counter: '건' },
    { key: 'report', label: '리포트', counter: '건' },
    { key: 'companyProfile', label: '회사 프로필', counter: '개' },
    { key: 'source', label: '수집처', counter: '곳' },
  ]
  for (const r of rfp) {
    const e = ENTITY[r.key]
    assert.ok(e, `${r.key} 가 용어집에 없다`)
    assert.equal(e.label, r.label)
    assert.equal(e.counter, r.counter)
    assert.equal(e.surface, 'rfp', `${r.key} 가 어느 서비스 것인지 안 말한다`)
  }
})

test('★ RFP 개체도 화면이 조수사를 직접 안 고른다', () => {
  assert.equal(count('bid', 3), '공고 3건')
  assert.equal(count('source', 2), '수집처 2곳')
  assert.equal(count('companyProfile', 1), '회사 프로필 1개')
})

test('★ 함수 이름이 화면에 새는 말이 금지어로 등재돼 있다', () => {
  const bad = BANNED_TERMS.map((b) => b.bad)
  for (const w of ['훑기', '어디를 뒤질까', '독소조항']) {
    assert.ok(bad.includes(w), `${w} 가 금지어에 없다`)
  }
  // 사유 없이 넣으면 목록이 왜 있는지 아무도 모른다.
  // 길이를 요구하지는 않는다 — 「공백 없음」은 짧지만 그 자체로 충분한 사유다
  for (const b of BANNED_TERMS) {
    assert.ok(b.why.trim().length > 0, `${b.bad} 에 사유가 없다`)
    assert.ok(b.good.length > 0, `${b.bad} 의 대신 쓸 말이 없다`)
  }
})

test('★ 건이 둘이면 건수를 먼저 말한다 — 항목 수만 말하면 두 건이 한 건으로 읽힌다', () => {
  /*
    실측 v0.10.179: 견적 두 건이 든 파일을 올렸더니 머리말이 「4개를 읽었어요」라고만 했다.
    카드는 둘인데 숫자는 넷이라, 항목 넷짜리 견적 하나로 읽힌다.
  */
  const two = fillFoundQuotesLine(2, 4, '견적서.md')
  assert.match(two, /견적 2건/, '몇 건인지 안 말한다')
  assert.match(two, /품목 4개/, '항목이 몇 개인지 안 말한다')
  assert.ok(two.indexOf('견적 2건') < two.indexOf('품목 4개'), '건수가 뒤에 오면 항목 수를 먼저 읽는다')

  // 조수사는 개체표가 정한다 — 화면도 이 함수도 「건」·「개」를 손으로 적지 않는다
  assert.ok(two.includes(count('quote', 2)))
  assert.ok(two.includes(count('product', 4)))
})

test('건이 하나면 군말을 안 붙인다 — 「견적 1건」은 아무것도 안 알려 준다', () => {
  assert.equal(fillFoundQuotesLine(1, 3, 'a.md'), fillFoundLine(3, 'a.md'))
  assert.equal(fillFoundQuotesLine(0, 0, 'a.md'), fillFoundLine(0, 'a.md'))
})

test('★ AI 키를 더하는 단추는 「추가」다 — 「새 키」는 새 칸을 여는 단추로 읽힌다', () => {
  /*
    실측 2026-09-20: 관리자가 키 이름과 키를 다 적어 놓고 「새 키」 단추 앞에서 멈췄다.
    그 단추는 적은 값을 표에 더하는 단추인데, 이름은 빈 칸을 하나 더 여는 단추라고 말한다.

    맨 「추가」는 용어집이 막는 말이다(무엇을 추가하는지 안 밝힘). 여기는 예외로 쓴다 —
    카드 제목이 「Gemini API 키」이고 폼 라벨이 「키 이름」·「API 키」라 대상이 이미 세 번 적혀 있다.
    **예외는 이유와 함께 적는다**(MEETING_CAPTURE_LABEL 과 같은 방식). 사유가 사라지면
    다음 사람이 「용어집 위반」이라며 되돌리고, 사용자가 같은 지적을 다시 한다.
  */
  assert.equal(AI_KEY.create, '추가')
  assert.notEqual(AI_KEY.create, '새 키')

  const src = readFileSync(new URL('./ai-key.ts', import.meta.url), 'utf8')
  assert.match(src, /예외/, '맨 「추가」를 쓰는 사유가 파일에 없다')
})

// ------------------------------------------------------------
// 설정 칸의 단추 (사용자 지적 2026-09-20)
// ------------------------------------------------------------

test('★ 빈 칸은 「저장」, 있던 값을 고치는 중이면 「수정」', () => {
  assert.equal(SETTING_SAVE_LABEL[settingFieldState(false, false)], ACTION.save)
  assert.equal(SETTING_SAVE_LABEL[settingFieldState(false, true)], ACTION.save)
  assert.equal(SETTING_SAVE_LABEL[settingFieldState(true, true)], ACTION.edit)
})

test('★ 저장돼 있고 바뀐 것이 없으면 「저장됨」이고 누를 것이 없다', () => {
  const st = settingFieldState(true, false)
  assert.equal(SETTING_SAVE_LABEL[st], '저장됨')
  assert.equal(settingSaveDisabled(st), true, '누를 것이 없는데 눌리면 또 「먹었나」를 묻게 된다')
})

test('누를 일이 남은 상태는 잠그지 않는다', () => {
  assert.equal(settingSaveDisabled(settingFieldState(false, false)), false)
  assert.equal(settingSaveDisabled(settingFieldState(true, true)), false)
})

test('★ 단추 말이 셋 다 다르다 — 같으면 상태를 말하지 못한다', () => {
  const said = new Set(Object.values(SETTING_SAVE_LABEL))
  assert.equal(said.size, 3, `단추 말이 ${said.size}가지뿐이다`)
})
