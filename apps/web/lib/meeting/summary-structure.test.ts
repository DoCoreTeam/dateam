// lib/meeting/summary-structure.test.ts — 평문 회의록을 구조로 되돌리는 파서 가드
//
// **왜 이 가드가 필요한가** (실측 2026-09-05, 운영 DB 직접 조회):
// AI 는 프롬프트가 요구한 대로 `[안건]⏎- 사실` 형식을 지켜 줬는데(줄바꿈 19개),
// 코드가 그 평문을 파싱하지 않고 `facts[0].text` 하나에 통째로 넣었다.
// 정리본 15건 중 **11건이 안건 1개 · 제목 「회의 내용」** 으로 저장돼 있었다.
//
// 이 파서가 틀리면 두 방향으로 사고가 난다:
//   ① 덜 나누면 — 지금 그대로. 일렬로 흐른다.
//   ② 잘못 나누면 — **사실이 사라진다.** 그건 훨씬 나쁘다.
// 그래서 무손실을 단정으로 박는다: 어떤 입력이 와도 원문의 글자는 결과 어딘가에 있어야 한다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSummaryOutline, parseDecisionLines } from './summary-structure.ts'

/** 원문과 결과에서 공백·글머리표·대괄호를 뺀 «알맹이» — 무손실 비교용 */
function core(s: string): string {
  return s.replace(/[[\]\-•\s]/g, '')
}

/* ── 정상 형식 ──────────────────────────────────────── */

test('안건 대괄호와 글머리표를 안건·사실 구조로 나눈다', () => {
  const outline = parseSummaryOutline([
    '[데이터스테이션 ISP 및 예산 조정]',
    '- ISP 금액을 기존 3,000만 원에서 1.5억 원으로 변경함',
    '- 산업단지공단이 주관기관으로서 현황과 제언을 진행함',
    '',
    '[대표공장 사업 내용 및 설계의 필요성]',
    '- 국비·지방비 집행 근거 마련을 위해 초기 설계는 반드시 필요함',
  ].join('\n'))

  assert.equal(outline.length, 2)
  assert.equal(outline[0].title, '데이터스테이션 ISP 및 예산 조정')
  assert.equal(outline[0].facts.length, 2)
  assert.equal(outline[0].facts[0], 'ISP 금액을 기존 3,000만 원에서 1.5억 원으로 변경함')
  assert.equal(outline[1].title, '대표공장 사업 내용 및 설계의 필요성')
  assert.equal(outline[1].facts.length, 1)
})

test('가운뎃점 글머리표도 사실로 읽는다', () => {
  const outline = parseSummaryOutline('[예산]\n• 3,000만 원에서 1.5억 원으로\n• 60억 원 규모로 편성')
  assert.equal(outline[0].facts.length, 2)
  assert.equal(outline[0].facts[1], '60억 원 규모로 편성')
})

/* ── 형식을 어긴 입력 — 여기서 사실이 사라지면 안 된다 ── */

test('안건 표시가 없으면 안건 하나로 묶되 사실은 줄마다 나눈다', () => {
  const outline = parseSummaryOutline('- 첫째 사실\n- 둘째 사실')
  assert.equal(outline.length, 1)
  assert.equal(outline[0].title, '회의 내용')
  assert.equal(outline[0].facts.length, 2)
})

test('안건도 글머리표도 없는 통짜 문단은 통짜 그대로 — 억지로 자르지 않는다', () => {
  const lump = '회의 전반에 걸쳐 예산과 일정 이야기가 오갔고 결론은 나지 않았다.'
  const outline = parseSummaryOutline(lump)
  assert.equal(outline.length, 1)
  assert.equal(outline[0].title, '회의 내용')
  assert.deepEqual(outline[0].facts, [lump])
})

test('안건 앞에 먼저 나온 머리말을 버리지 않는다', () => {
  const outline = parseSummaryOutline('전체 배경 설명 한 줄\n\n[예산]\n- 1.5억 원으로 변경')
  assert.equal(outline.length, 2)
  assert.equal(outline[0].title, '회의 내용')
  assert.deepEqual(outline[0].facts, ['전체 배경 설명 한 줄'])
  assert.equal(outline[1].title, '예산')
})

test('글머리표 없이 이어지는 줄은 앞 사실에 붙인다 — 새 사실로 쪼개지 않는다', () => {
  const outline = parseSummaryOutline('[예산]\n- 금액을 1.5억 원으로 변경하되\n  후속 협의가 필요함')
  assert.equal(outline[0].facts.length, 1)
  assert.match(outline[0].facts[0], /후속 협의가 필요함$/)
})

test('사실이 하나도 없는 안건은 버린다 — 화면에 빈 제목만 남지 않게', () => {
  const outline = parseSummaryOutline('[제목만 있는 안건]\n\n[예산]\n- 1.5억 원')
  assert.equal(outline.length, 1)
  assert.equal(outline[0].title, '예산')
})

test('빈 입력은 빈 배열 — 화면이 「아직 정리하지 않았어요」를 그린다', () => {
  assert.deepEqual(parseSummaryOutline(''), [])
  assert.deepEqual(parseSummaryOutline('   \n\n  '), [])
})

/* ── 무손실 — 이 가드가 이 파일의 존재 이유다 ────────── */

// 무손실 계약의 **정확한 범위** — 넓게도 좁게도 쓰지 않는다.
//
//   지킨다  · 사실 줄은 하나도 버리지 않는다. 이것이 사용자가 읽는 내용 전부다.
//   지킨다  · 사실이 딸린 안건의 제목은 그대로 남는다.
//   안 지킨다 · 사실이 하나도 없는 안건 제목은 버린다.
//
// 마지막 항목을 예외로 두는 이유: 제목만 있는 안건은 **사용자에게 아무것도 알려 주지 않는다.**
// 「[대표공장]」 만 떠 있으면 무슨 이야기가 있었는지 알 수 없고, 화면에는 빈 칸으로 보인다.
// 기존 `parseDigestResult`·`parseStoredDigest` 도 같은 규칙이라 여기만 다르면 같은 정리본이
// 저장 경로에 따라 다르게 보인다. 위 「사실이 하나도 없는 안건은 버린다」 테스트가 짝이다.
test('무손실: 사실 줄은 하나도 사라지지 않는다', () => {
  const inputs = [
    '[예산]\n- 3,000만 원 → 1.5억 원\n- 60억 원 규모\n\n[협의]\n- GERI·공단·구미시와 협의함',
    '머리말\n[예산]\n- 1.5억 원',
    '- 글머리표만 있는 줄\n- 또 하나',
    '통짜 한 문단, 형식 없음',
    '[안건]\n- 사실\n이어지는 줄',
    '[빈 안건]\n\n[내용 있는 안건]\n- 사실',
  ]
  for (const raw of inputs) {
    // 사실 줄만 추린다 — 안건 제목 줄(`[…]`)은 이 검사의 대상이 아니다
    const factSource = raw
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !/^\[.*\]$/.test(l))
      .join('')
    const got = parseSummaryOutline(raw).map((a) => a.facts.join('')).join('')

    const missing = [...core(factSource)].filter((ch) => !core(got).includes(ch))
    assert.deepEqual(missing, [], `사라진 글자: ${missing.join('')} (입력: ${raw.slice(0, 30)})`)
    assert.ok(core(got).length >= core(factSource).length, `알맹이가 줄었다 (입력: ${raw.slice(0, 30)})`)
  }
})

test('무손실: 사실이 딸린 안건의 제목은 그대로 남는다', () => {
  const outline = parseSummaryOutline('[데이터스테이션 ISP 및 예산 조정]\n- 1.5억 원\n\n[기관 협의]\n- 산업부 협조')
  assert.deepEqual(outline.map((a) => a.title), ['데이터스테이션 ISP 및 예산 조정', '기관 협의'])
})

/* ── 결정사항 — 두 파일에 복붙돼 있던 것을 하나로 ────── */

test('결정사항은 줄마다 나누고 글머리표를 뗀다', () => {
  const lines = parseDecisionLines('- 금액을 1.5억 원으로 함\n• 제안 문서를 전달하기로 함\n\n')
  assert.deepEqual(lines, ['금액을 1.5억 원으로 함', '제안 문서를 전달하기로 함'])
})

test('결정사항이 비면 빈 배열', () => {
  assert.deepEqual(parseDecisionLines(''), [])
  assert.deepEqual(parseDecisionLines('  \n '), [])
})

/* ── 앵커: 실제로 화면에서 통짜로 보이던 그 값 ──────── */

// 완료 조건 E-6: 화면에서 못 밟는 상태는 계산으로 밟되, **계산이 화면과 같다는 증거**를 함께 박는다.
// 아래 입력은 운영 DB 에서 그대로 꺼낸 값이다 —
//   note ffb69fc9-5b56-4b4f-9729-bd62a8fbe2a5 · seq 1 · agenda_json.agenda[0].facts[0].text
// 화면(v0.7.688)에서는 이것이 **한 줄로 흘렀고**, 파서를 거치면 안건 3개로 선다.
test('앵커: 운영 DB 의 통짜 정리본이 안건 3개로 복원된다', () => {
  const stored = [
    '[데이터스테이션 ISP 및 예산 조정]',
    '- 데이터스테이션 ISP 금액을 기존 3,000만 원에서 1.5억 원으로 변경함',
    '- 해당 ISP만 진행하는 것은 부적절하다고 판단하여 산업단지공단이 주관기관으로서 현황과 제언을 진행함',
    '',
    '[대표공장 사업 내용 및 설계의 필요성]',
    '- 대표공장의 사업 내용에 대해 공단에서 관리하는 것에 대한 부담이 있음',
    '',
    '[기관 협의 및 후속 조치]',
    '- 작성한 제안 문서는 전달하기로 함',
  ].join('\n')

  const outline = parseSummaryOutline(stored)
  assert.equal(outline.length, 3, '화면에서는 이것이 안건 1개(「회의 내용」)로 보였다')
  assert.deepEqual(outline.map((a) => a.facts.length), [2, 1, 1])
  assert.equal(outline[0].title, '데이터스테이션 ISP 및 예산 조정')
  // 숫자·고유명사가 살아 있는지 — 정제 계약이 지키라고 한 것들
  const all = outline.flatMap((a) => a.facts).join(' ')
  for (const token of ['3,000만 원', '1.5억 원', '산업단지공단', '대표공장']) {
    assert.ok(all.includes(token), `실측 원문의 「${token}」이 사라졌다`)
  }
})
