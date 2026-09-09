/**
 * 정정공고와 차수 diff 가드 (설계서 F11)
 *
 * 여기서 잠그는 것 셋
 * - 같은 공고번호의 차수가 supersedes 로 이어지는가
 * - 앞 차수가 사라지지 않는가
 * - 필드 단위 diff 가 값과 근거를 함께 내는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { linkRevision, latestOf, chainOf, type Revision } from './link.ts'
import {
  diffReports, onlyChanges, criticalChanges, summarize, sameValue, CRITICAL_FIELDS,
} from './diff.ts'
import { emptyReport, makeValue, type Report, type ReportMeta } from '../report/schema.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))

const META: ReportMeta = {
  analysisMode: 'base', baseVendor: 'A', crossVendors: [], fallbackApplied: false,
  costKrw: 0, durationMs: 0, parserQuality: 80, generatedAt: '2026-09-09T00:00:00Z',
  aiNotice: 'AI 생성 결과, 검토 필요', docClass: 'public',
}

const 차수 = (over: Partial<Revision> & { caseId: string; round: number }): Revision => ({
  noticeNo: 'N-1', isLatest: false, createdAt: '2026-03-01', ...over,
})

const 근거 = (quote: string) => [{ documentFileId: 'f', blockId: 'b', pageNo: 1, quote }]

// 차수 잇기

test('앞 차수를 supersedes 로 가리킨다', () => {
  const r = linkRevision({ noticeNo: 'N-1', round: 2, caseId: 'c2' }, [
    차수({ caseId: 'c1', round: 1, isLatest: true }),
  ])
  assert.equal(r.supersedes?.caseId, 'c1')
  assert.deepEqual(r.problems, [])
})

test('앞 차수를 지우지 않고 최신 표시만 뗀다', () => {
  const r = linkRevision({ noticeNo: 'N-1', round: 3, caseId: 'c3' }, [
    차수({ caseId: 'c1', round: 1 }),
    차수({ caseId: 'c2', round: 2, isLatest: true }),
  ])
  // 지우면 「무엇이 바뀌었나」를 영영 말할 수 없다
  assert.deepEqual(r.demote, ['c2'])
  assert.equal(r.supersedes?.caseId, 'c2', '바로 앞 차수를 가리킨다')
})

test('같은 차수를 두 번 넣지 않는다', () => {
  const r = linkRevision({ noticeNo: 'N-1', round: 2, caseId: 'c9' }, [
    차수({ caseId: 'c2', round: 2, isLatest: true }),
  ])
  // 같은 차수가 둘이면 「무엇이 최신인가」에 답할 수 없다
  assert.ok(r.problems.includes('same_round'))
  assert.equal(r.supersedes, null)
  assert.deepEqual(r.demote, [])
})

test('늦게 도착한 옛 차수를 막는다', () => {
  const r = linkRevision({ noticeNo: 'N-1', round: 1, caseId: 'c9' }, [
    차수({ caseId: 'c2', round: 2, isLatest: true }),
  ])
  assert.ok(r.problems.includes('lower_round'))
})

test('첫 차수는 앞이 없다', () => {
  const r = linkRevision({ noticeNo: 'N-1', round: 1, caseId: 'c1' }, [])
  assert.equal(r.supersedes, null)
  assert.deepEqual(r.problems, [])
})

test('다른 공고의 차수는 관계가 없다', () => {
  const r = linkRevision({ noticeNo: 'N-2', round: 1, caseId: 'c9' }, [
    차수({ caseId: 'c1', round: 1, noticeNo: 'N-1', isLatest: true }),
  ])
  assert.equal(r.supersedes, null)
  assert.deepEqual(r.demote, [])
})

test('최신 차수와 사슬을 낸다', () => {
  const revs = [차수({ caseId: 'c1', round: 1 }), 차수({ caseId: 'c3', round: 3 }), 차수({ caseId: 'c2', round: 2 })]
  assert.equal(latestOf(revs, 'N-1')?.caseId, 'c3')
  assert.deepEqual(chainOf(revs, 'N-1').map((r) => r.round), [1, 2, 3])
  assert.equal(latestOf(revs, '없음'), null)
})

test('라우트가 앞 차수를 안 지운다', () => {
  const route = readFileSync(path.join(HERE, '../../../app/api/rfp/cases/[id]/revisions/route.ts'), 'utf8')
  assert.equal(/from\('rfp_case_revisions'\)[\s\S]{0,80}\.delete\(/.test(route), false, '앞 차수를 지운다')
  assert.match(route, /update\(\{ is_latest: false \}\)/)
})

// diff

function 리포트(over: { budget?: number | null; deadline?: string | null; title?: string | null }): Report {
  const r = emptyReport(META)
  if (over.budget !== undefined) {
    r.budget.totalAmount = over.budget === null
      ? makeValue<number>(null as never)
      : makeValue(over.budget, { evidence: 근거(`사업비 ${over.budget}원`) })
  }
  if (over.deadline !== undefined && over.deadline !== null) {
    r.schedule.proposalDeadline = makeValue(over.deadline, { evidence: 근거(`마감 ${over.deadline}`) })
  }
  if (over.title !== undefined && over.title !== null) {
    r.overview.title = makeValue(over.title, { evidence: 근거(over.title) })
  }
  return r
}

test('바뀐 값과 양쪽 근거를 함께 낸다', () => {
  const result = diffReports(
    리포트({ budget: 500_000_000 }),
    리포트({ budget: 600_000_000 }),
  )
  const d = result.diffs.find((x) => x.fieldPath === 'budget.totalAmount')!
  assert.equal(d.kind, 'changed')
  assert.equal(d.before, 500_000_000)
  assert.equal(d.after, 600_000_000)
  // 값만 보여 주면 어느 쪽이 맞는지 모른다. 원문을 보면 1초에 판단된다
  assert.equal(d.beforeEvidence.length, 1)
  assert.equal(d.afterEvidence.length, 1)
  assert.match(d.beforeEvidence[0].quote, /500000000/)
})

test('사라진 값도 변화다', () => {
  const result = diffReports(리포트({ budget: 500_000_000 }), 리포트({ budget: null }))
  const d = result.diffs.find((x) => x.fieldPath === 'budget.totalAmount')!
  // 「없어졌다」와 「우리가 못 찾았다」는 다르지만 둘 다 사람이 봐야 한다
  assert.equal(d.kind, 'removed')
  assert.equal(result.removed, 1)
})

test('새로 생긴 값도 변화다', () => {
  const result = diffReports(리포트({}), 리포트({ budget: 500_000_000 }))
  assert.equal(result.diffs.find((x) => x.fieldPath === 'budget.totalAmount')!.kind, 'added')
  assert.equal(result.added, 1)
})

test('안 바뀐 것도 목록에 남긴다', () => {
  const result = diffReports(리포트({ budget: 500_000_000 }), 리포트({ budget: 500_000_000 }))
  const d = result.diffs.find((x) => x.fieldPath === 'budget.totalAmount')!
  // 화면이 「바뀐 것만 보기」를 켜고 끌 수 있어야 한다
  assert.equal(d.kind, 'unchanged')
  assert.deepEqual(onlyChanges(result), [])
})

test('배열 순서가 달라도 안 바뀐 것이다', () => {
  // 모델이 순서를 흔든다
  assert.equal(sameValue(['가', '나'], ['나', '가']), true)
  assert.equal(sameValue([{ a: 1 }], [{ a: 1 }]), true)
  assert.equal(sameValue(['가'], ['가', '나']), false)
})

test('무거운 변화를 골라낸다', () => {
  const result = diffReports(
    리포트({ budget: 500_000_000, title: '옛 제목' }),
    리포트({ budget: 600_000_000, title: '새 제목' }),
  )
  // 이 필드가 바뀌면 제안 전략이 흔들린다
  assert.deepEqual(criticalChanges(result).map((d) => d.fieldPath), ['budget.totalAmount'])
  assert.ok(CRITICAL_FIELDS.includes('schedule.proposalDeadline'))
})

test('한 줄 요약이 몇 건인지 말한다', () => {
  const result = diffReports(리포트({ budget: 500_000_000 }), 리포트({ budget: 600_000_000, title: '새 제목' }))
  assert.match(summarize(result), /1건 변경/)
  assert.match(summarize(result), /1건 추가/)
  assert.equal(summarize(diffReports(리포트({}), 리포트({}))), '바뀐 값이 없다')
})
