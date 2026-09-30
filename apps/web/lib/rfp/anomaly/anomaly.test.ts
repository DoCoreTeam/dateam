/**
 * 이상 조항 규칙 층 가드 (설계서 3.8.1)
 *
 * 여기서 잠그는 것 셋
 * - R01~R12 열두 규칙이 다 있고 각각 양성 1건 음성 1건이 확인되는가
 * - 규칙 값이 코드가 아니라 인자에서 오는가 (DB 가 진실이어야 한다)
 * - 판정 문장이 관측된 사실만 적는가 (「특정 업체에 유리」는 명예훼손 위험이다)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_RULES, RULE_IDS, mergeRules, toRule, type AnomalyRule, type RuleId,
  toRow,
} from './rules.ts'
import {
  runRule, runAll, emptyFacts, sentences, dedupe, type DocBlock, type AnomalyFacts,
} from './engine.ts'
import { mergeAnomalies, factsFromReport, applyRuleLayer } from './merge.ts'
import { readFileSync } from 'node:fs'
import { stripComments } from '../../ui/component-scan.ts'

const 규칙 = (id: RuleId): AnomalyRule => {
  const r = DEFAULT_RULES.find((x) => x.id === id)
  if (!r) throw new Error(`규칙 ${id} 가 없다`)
  return r
}

const 블록 = (text: string, blockId = 'b1'): DocBlock => ({ blockId, text, pageNo: 1 })

function 사실(over: Partial<AnomalyFacts> = {}): AnomalyFacts {
  return { ...emptyFacts(), ...over }
}

// 규칙 정의

test('규칙이 열두 개다', () => {
  assert.equal(DEFAULT_RULES.length, 12)
  assert.deepEqual([...RULE_IDS], ['R01','R02','R03','R04','R05','R06','R07','R08','R09','R10','R11','R12'])
  assert.equal(new Set(RULE_IDS).size, 12, '규칙 ID 가 겹친다')
})

test('규칙마다 등급과 심각도와 값이 있다', () => {
  for (const r of DEFAULT_RULES) {
    assert.ok(r.title, `${r.id} 에 제목이 없다`)
    assert.ok(['confirmed', 'suspected'].includes(r.grade))
    assert.ok(['blocking', 'margin', 'contract', 'competition'].includes(r.severity))
    assert.ok(Object.keys(r.params).length > 0, `${r.id} 에 조정할 값이 없다`)
  }
})

test('DB 규칙이 기본값을 이긴다', () => {
  // 관리자가 고친 값을 코드 배포가 덮으면 아무도 규칙을 안 고치게 된다
  // 표가 가진 칸 이름 그대로 넣는다 — 코드 이름(rule_id·title·params)으로 적으면
  // 통과하는데 실제 DB 에서는 아무것도 안 읽힌다(실측 2026-09-20, 그래서 이 줄을 고쳤다)
  const fromDb = [toRule(toRow({
    id: 'R03', title: '법정 공고 기간', method: 'numeric',
    grade: 'confirmed', severity: 'blocking', params: { negotiated: 20 }, enabled: true,
  }, '00000000-0000-4000-8000-000000000001'))]
  const merged = mergeRules(fromDb)
  assert.equal(merged.length, 12)
  assert.equal(merged.find((r) => r.id === 'R03')!.params.negotiated, 20)
  assert.equal(merged.find((r) => r.id === 'R01')!.params.windowSentences, 2, 'DB 에 없는 규칙은 기본값')
})

test('규칙 값이 인자에서 온다', () => {
  // 코드에 박으면 관리자가 못 고치고, 못 고치면 규칙이 곧 낡는다
  const 느슨 = { ...규칙('R04'), params: { maxRecordCount: 99, maxSingleRecordRatio: 99 } }
  const facts = 사실({ requiredRecordCount: 10, budgetAmount: 1_000_000_000, requiredRecordAmount: 2_000_000_000 })
  assert.equal(runRule(규칙('R04'), [], facts).length > 0, true)
  assert.deepEqual(runRule(느슨, [], facts), [])
})

test('꺼진 규칙은 안 돈다', () => {
  const off = { ...규칙('R11'), enabled: false }
  assert.deepEqual(runRule(off, [블록('참가 자격은 CSAP 인증 보유 업체로 한다')], 사실()), [])
})

// R01

test('R01 양성: 상표가 있고 동등 이상이 없다', () => {
  const a = runRule(규칙('R01'), [블록('데이터베이스는 Oracle 19c 를 사용한다.')], 사실())
  assert.equal(a.length, 1)
  assert.match(a[0].rationale, /Oracle/)
  assert.equal(a[0].evidence.length, 1)
})

test('R01 음성: 동등 이상이 함께 있다', () => {
  assert.deepEqual(
    runRule(규칙('R01'), [블록('데이터베이스는 Oracle 19c 또는 동등 이상 제품을 사용한다.')], 사실()),
    [],
  )
})

// R02

test('R02 양성: 한 문장에 규격 수치가 몰려 있다', () => {
  const a = runRule(규칙('R02'), [블록('GPU 는 80GB 메모리와 NVLink 및 PCIe 5 를 지원해야 한다.')], 사실())
  assert.equal(a.length, 1)
  assert.equal(a[0].grade, 'suspected')
})

test('R02 음성: 수치가 적으면 안 걸린다', () => {
  assert.deepEqual(runRule(규칙('R02'), [블록('GPU 는 80GB 메모리를 지원해야 한다.')], 사실()), [])
})

// R03

test('R03 양성: 협상계약인데 공고 기간이 20일이다', () => {
  const a = runRule(규칙('R03'), [], 사실({
    noticeDate: '2026-03-01', proposalDeadline: '2026-03-21', noticeKind: 'negotiated',
  }))
  assert.equal(a.length, 1)
  // 「위법」이라 쓰지 않는다. 숫자만 적는다
  assert.match(a[0].rationale, /20일/)
  assert.equal(/위법|불법|위반/.test(a[0].rationale), false)
})

test('R03 음성: 40일을 채웠다', () => {
  assert.deepEqual(runRule(규칙('R03'), [], 사실({
    noticeDate: '2026-03-01', proposalDeadline: '2026-05-01', noticeKind: 'negotiated',
  })), [])
})

// R04

test('R04 양성: 실적을 5건 요구한다', () => {
  const a = runRule(규칙('R04'), [], 사실({ requiredRecordCount: 5 }))
  assert.equal(a.length, 1)
  assert.match(a[0].rationale, /5건/)
})

test('R04 음성: 2건이면 안 걸린다', () => {
  assert.deepEqual(runRule(규칙('R04'), [], 사실({ requiredRecordCount: 2 })), [])
})

// R05

test('R05 양성: 요구 자본금이 예산의 80%다', () => {
  const a = runRule(규칙('R05'), [], 사실({ budgetAmount: 1_000_000_000, requiredCapital: 800_000_000 }))
  assert.equal(a.length, 1)
  assert.match(a[0].rationale, /80%/)
})

test('R05 음성: 예산의 30%면 안 걸린다', () => {
  assert.deepEqual(runRule(규칙('R05'), [], 사실({ budgetAmount: 1_000_000_000, requiredCapital: 300_000_000 })), [])
})

// R06

test('R06 양성: 인건비 환산이 예산을 넘는다', () => {
  const a = runRule(규칙('R06'), [], 사실({
    budgetAmount: 500_000_000, manMonths: { 특급: 24, 고급: 48 },
  }))
  assert.equal(a.length, 1)
  // 계산 근거를 문장에 적는다. 숫자만 보여 주면 아무도 못 따라온다
  assert.match(a[0].rationale, /노임단가로 환산하면/)
  assert.equal(a[0].severity, 'margin')
})

test('R06 음성: 예산이 넉넉하면 안 걸린다', () => {
  assert.deepEqual(runRule(규칙('R06'), [], 사실({
    budgetAmount: 5_000_000_000, manMonths: { 중급: 12 },
  })), [])
})

// R07

test('R07 양성: 12개월에 요구사항 400건이다', () => {
  const a = runRule(규칙('R07'), [], 사실({ requirementCount: 400, durationMonths: 12 }))
  assert.equal(a.length, 1)
  assert.match(a[0].rationale, /월 33.3건/)
})

test('R07 음성: 12개월에 100건이면 안 걸린다', () => {
  assert.deepEqual(runRule(규칙('R07'), [], 사실({ requirementCount: 100, durationMonths: 12 })), [])
})

// R08

test('R08 양성: 저작권 전부 귀속 문구가 있다', () => {
  const a = runRule(규칙('R08'), [블록('모든 산출물의 저작권은 전부 발주기관에 귀속된다.')], 사실())
  assert.equal(a.length, 1)
  assert.equal(a[0].severity, 'contract')
})

test('R08 음성: 공동 소유 문구는 안 걸린다', () => {
  assert.deepEqual(runRule(규칙('R08'), [블록('산출물의 저작권은 발주기관과 수급인이 공동으로 소유한다.')], 사실()), [])
})

// R09

test('R09 양성: 지체상금률이 기준을 넘는다', () => {
  const a = runRule(규칙('R09'), [블록('지체상금률은 1% 로 한다.')], 사실())
  assert.ok(a.some((x) => x.rationale.includes('지체상금률이 1.00%')))
})

test('R09 음성: 천분의 2.5 는 기준 안이다', () => {
  assert.deepEqual(runRule(규칙('R09'), [블록('지체상금은 천분의 2 로 한다.')], 사실()), [])
})

// R10

test('R10 양성: 총액과 다른 금액이 문서에 있다', () => {
  const a = runRule(규칙('R10'), [], 사실({
    budgetAmount: 500_000_000,
    amountMentions: [{ amount: 500_000_000, blockId: 'b1' }, { amount: 300_000_000, blockId: 'b2' }],
  }))
  assert.equal(a.length, 1)
  assert.equal(a[0].grade, 'confirmed')
  assert.equal(a[0].evidence.length, 1)
})

test('R10 음성: 같은 금액만 있으면 안 걸린다', () => {
  assert.deepEqual(runRule(규칙('R10'), [], 사실({
    budgetAmount: 500_000_000, amountMentions: [{ amount: 500_000_000, blockId: 'b1' }],
  })), [])
})

// R11

test('R11 양성: 특정 인증을 자격으로 건다', () => {
  const a = runRule(규칙('R11'), [블록('참가 자격은 CSAP 인증을 보유한 업체로 한다.')], 사실())
  assert.equal(a.length, 1)
  assert.match(a[0].rationale, /CSAP/)
})

test('R11 음성: 일반 자격 문구는 안 걸린다', () => {
  assert.deepEqual(runRule(규칙('R11'), [블록('참가 자격은 소프트웨어사업자 신고를 마친 업체로 한다.')], 사실()), [])
})

// R12

test('R12 양성: 공동수급 금지 문구가 있다', () => {
  const a = runRule(규칙('R12'), [블록('본 사업은 공동수급을 금지한다.')], 사실())
  assert.equal(a.length, 1)
})

test('R12 음성: 공동수급 허용은 안 걸린다', () => {
  assert.deepEqual(runRule(규칙('R12'), [블록('공동수급체 구성을 허용한다.')], 사실()), [])
})

// 전체

test('전부 돌려도 서로 방해하지 않는다', () => {
  const blocks = [
    블록('데이터베이스는 Oracle 19c 를 사용한다.', 'b1'),
    블록('참가 자격은 CSAP 인증을 보유한 업체로 한다.', 'b2'),
  ]
  const facts = 사실({ noticeDate: '2026-03-01', proposalDeadline: '2026-03-21', noticeKind: 'negotiated' })
  const all = runAll(DEFAULT_RULES, blocks, facts)
  const ids = new Set(all.map((a) => a.ruleId))
  assert.ok(ids.has('R01') && ids.has('R11') && ids.has('R03'))
})

test('판정 문장에 단정하는 말이 없다', () => {
  const blocks = [블록('데이터베이스는 Oracle 19c 를 사용한다.')]
  const all = runAll(DEFAULT_RULES, blocks, 사실({
    noticeDate: '2026-03-01', proposalDeadline: '2026-03-10', noticeKind: 'negotiated',
    budgetAmount: 100_000_000, requiredCapital: 900_000_000,
  }))
  assert.ok(all.length > 0)
  for (const a of all) {
    // 명예훼손 위험이 실제로 있다. 우리가 쓸 수 있는 말은 관측된 사실이다
    assert.equal(/유리|특혜|밀어주|위법|불법/.test(a.rationale), false, `단정 문장: ${a.rationale}`)
  }
})

test('같은 규칙이 같은 자리를 두 번 잡으면 접는다', () => {
  const a = runRule(규칙('R01'), [블록('Oracle 을 쓴다.', 'b1'), 블록('Oracle 을 쓴다.', 'b2')], 사실())
  assert.equal(a.length, 2, '블록이 다르면 둘이다')
  // 같은 결과를 두 번 넣어도 자리가 같으면 하나다
  assert.equal(dedupe([...a, ...a]).length, 2)
})

test('문장 자르기가 줄바꿈과 마침표를 둘 다 본다', () => {
  assert.deepEqual(sentences('가나. 다라\n마바'), ['가나.', '다라', '마바'])
})

// 배선 — 규칙 층이 분석 경로에서 실제로 도는가

test('규칙이 잡은 것은 확정, AI 만 잡은 것은 의심', () => {
  const blocks = [블록('데이터베이스는 Oracle 19c 를 사용한다.', 'b1')]
  const hits = runAll(DEFAULT_RULES, blocks, 사실())
  assert.ok(hits.some((a) => a.ruleId === 'R01'), '규칙이 상표를 안 잡았다')

  const merged = mergeAnomalies(hits, [{
    title: '하자보수 기간이 길다',
    rationale: '하자보수 기간이 36개월로 적혀 있다',
    severity: 'contract',
    blockIds: ['b9'],
    quote: '하자보수 36개월',
    modelId: 'm1',
  }], [])

  const byRule = merged.find((m) => m.ruleIds.includes('R01'))
  assert.ok(byRule, '규칙이 낸 것이 병합 결과에 없다')
  assert.equal(byRule.grade, 'confirmed', '규칙이 확정한 것은 확정이어야 한다')

  const byAi = merged.find((m) => m.modelIds.includes('m1'))
  assert.ok(byAi, 'AI 가 낸 것이 병합 결과에 없다')
  assert.equal(byAi.grade, 'suspected', 'AI 단독은 의심이어야 한다')
  assert.deepEqual(byAi.ruleIds, [], 'AI 단독인데 규칙 출처가 붙었다')
})

test('리포트 칸 이름과 실행기 사실이 이어져 있다', () => {
  const facts = factsFromReport({
    budget: { totalAmount: { value: 100_000_000 }, mentions: { value: [{ amount: 200_000_000, blockId: 'b2' }] } },
    schedule: { durationMonths: { value: 6 }, proposalDeadline: { value: '2026-03-21' } },
    scope: { requirements: { value: [1, 2, 3] } },
  })
  assert.equal(facts.budgetAmount, 100_000_000)
  assert.equal(facts.durationMonths, 6)
  assert.equal(facts.proposalDeadline, '2026-03-21')
  assert.equal(facts.requirementCount, 3)
  assert.deepEqual(facts.amountMentions, [{ amount: 200_000_000, blockId: 'b2' }])
  // 숫자로 뽑는 태스크가 없는 값은 지어내지 않는다 — 지어내면 R04·R05 가 없는 근거로 잡는다
  assert.equal(facts.requiredCapital, null)
  assert.equal(facts.requiredRecordCount, null)
})

test('빈 리포트를 줘도 실행기가 안 죽는다', () => {
  const facts = factsFromReport({})
  assert.equal(facts.budgetAmount, null)
  assert.deepEqual(facts.amountMentions, [])
  assert.deepEqual(runAll(DEFAULT_RULES, [], facts), [], '근거가 없는데 무엇인가를 잡았다')
})

test('분석 경로가 규칙 층을 실제로 부른다', () => {
  // 시험만 부르고 제품 코드가 안 부르면 규칙 층은 있으나 마나다.
  // 실측 2026-09-30: runAll 을 부르는 곳이 자기 시험 하나뿐이었다.
  //
  // **주석을 먼저 지운다.** 이름만 찾는 가드는 배선을 주석 처리해도 통과한다 —
  // 이 가드를 처음 썼을 때 실제로 그랬다(배선을 주석으로 만들었는데 37개가 다 초록이었다).
  const src = stripComments(readFileSync(new URL('../analyze/run-analyze.ts', import.meta.url), 'utf8'))

  const calls = src.match(/\bapplyRuleLayer\s*\(/g) ?? []
  assert.equal(calls.length, 1, '분석 경로가 규칙 층을 부르는 자리가 하나가 아니다')
  assert.match(src, /report\.anomalies\s*=\s*applyRuleLayer/, '합친 결과를 리포트에 안 돌려놓는다')
  // 규칙을 DB 에서 읽어 넘기는가. 기본값만 쓰면 관리자가 고친 값이 안 먹는다
  assert.match(src, /applyRuleLayer\s*\(\s*\n?\s*mergeRules\s*\(/, 'DB 규칙을 안 합쳐서 넘긴다')
})


test('규칙 층이 AI 후보를 지우지 않고 합친다', () => {
  const merged = applyRuleLayer(DEFAULT_RULES, {
    blocks: [{ blockId: 'b1', text: '데이터베이스는 Oracle 19c 를 사용한다.', pageNo: 1 }],
  }, {
    budget: {}, schedule: {}, scope: {},
    anomalies: [{
      title: '하자보수 기간이 길다', rationale: '36개월로 적혀 있다',
      severity: 'contract', blockIds: ['b9'], quote: '하자보수 36개월', modelId: 'm1',
    }],
  })
  assert.ok(merged.some((m) => m.ruleIds.includes('R01') && m.grade === 'confirmed'), '규칙이 낸 확정이 없다')
  assert.ok(merged.some((m) => m.modelIds.includes('m1') && m.grade === 'suspected'), 'AI 후보가 사라졌다')
})

test('AI 후보가 엉뚱한 모양이어도 규칙 결과는 산다', () => {
  const merged = applyRuleLayer(DEFAULT_RULES, {
    blocks: [{ blockId: 'b1', text: '데이터베이스는 Oracle 19c 를 사용한다.', pageNo: 1 }],
  }, { anomalies: [null, 'candidate', { nope: 1 }] as unknown[] })
  assert.ok(merged.some((m) => m.ruleIds.includes('R01')), 'AI 쪽이 깨졌다고 규칙 결과까지 죽었다')
})
