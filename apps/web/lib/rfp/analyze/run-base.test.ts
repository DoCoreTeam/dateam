/**
 * 기본 모드 분석 실행 가드 (설계서 3.6)
 *
 * 여기서 잠그는 것 넷
 * - 태스크 아홉이 한 리포트로 합쳐지는가
 * - 한 태스크가 죽어도 나머지가 남는가
 * - 모델이 채운 값이 근거 대조를 거치는가
 * - 저장이 원본(불변)과 파생(검색용) 두 벌인가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runBase, assemble, allNodes, verifyRules, type TaskOutcome, type TaskRunner, renderWholeDoc } from './run-base.ts'
import { toFieldRows, persistReport, nextVersion, isIsoDate, type PersistClient } from './persist.ts'
import { makeValue, emptyReport, REPORT_TOP_KEYS, type ReportMeta, type ValueNode } from '../report/schema.ts'
import { EXTRACT_TASKS, TASK_IDS } from '../report/tasks.ts'
import { makeBlock, makeDocument } from '../ir/build.ts'
import type { IrDocument, IrMeta, IrSection, SectionCategory } from '../ir/types.ts'

const IR_META: IrMeta = {
  fileRole: 'main', format: 'hwp', pageCount: 1,
  parser: 'rhwp', parserVersion: '0.8.6', qualityScore: 80, warnings: [],
}

const META: Omit<ReportMeta, 'costKrw' | 'durationMs' | 'generatedAt' | 'fallbackApplied'> = {
  analysisMode: 'base', baseVendor: 'gemini-2.5-pro', crossVendors: [],
  parserQuality: 80, aiNotice: 'AI 생성 결과, 검토 필요', docClass: 'public',
}

const 원문 = '본 사업의 총 사업비는 금 오백만원정(₩500,000,000)이며 부가가치세를 포함한 금액이다'

function 문서(): IrDocument {
  const blocks = [
    makeBlock('f1', 0, { type: 'heading', text: '제1장 사업개요', sectionId: 's0', pageNo: 1, sourceRef: { kind: 'hwp', sectionIdx: 0, paraIdx: 0 } }),
    makeBlock('f1', 1, { type: 'paragraph', text: 원문, sectionId: 's1', pageNo: 1, sourceRef: { kind: 'hwp', sectionIdx: 0, paraIdx: 1 } }),
  ]
  const mk = (id: string, cat: SectionCategory, orderNo: number, blockIdx: number): IrSection => ({
    sectionId: id, level: 1, title: `${cat} 장`, number: `제${orderNo + 1}장`, parentId: null,
    category: cat, pageStart: 1, pageEnd: 1, blockIds: [blocks[blockIdx].blockId], orderNo,
  })
  return makeDocument({
    meta: IR_META, blocks,
    sections: [mk('s0', 'overview', 0, 0), mk('s1', 'budget', 1, 1)],
  })
}

/** 예산 태스크만 값을 내는 실행기 */
const 예산만: TaskRunner = async (task) => {
  if (task.id !== 'budget') return { fields: {}, costKrw: 1 }
  return {
    costKrw: 10,
    fields: {
      totalAmount: makeValue(500_000_000, {
        confidence: 0.9, vendor: 'gemini-2.5-pro',
        evidence: [{ documentFileId: 'f1', blockId: 문서().blocks[1].blockId, pageNo: 1, quote: 원문 }],
      }),
      vatIncluded: makeValue(true, { confidence: 0.8, vendor: 'gemini-2.5-pro' }),
    },
  }
}

// 합치기

test('태스크 아홉이 한 리포트로 합쳐진다', async () => {
  const r = await runBase({ doc: 문서(), contextTokens: 100_000, meta: META }, 예산만)
  assert.equal(r.outcomes.length, 9)
  assert.deepEqual(r.outcomes.map((o) => o.taskId), [...TASK_IDS])
  assert.deepEqual(Object.keys(r.report).sort(), [...REPORT_TOP_KEYS].sort())
  assert.equal(r.report.budget.totalAmount.value, 500_000_000)
})

test('meta 에 비용과 시간과 AI 고지가 남는다', async () => {
  let t = 1000
  const r = await runBase({ doc: 문서(), contextTokens: 100_000, meta: META, now: () => (t += 100) }, 예산만)
  assert.ok(r.report.meta.costKrw > 0)
  assert.ok(r.report.meta.durationMs > 0)
  // AI 기본법 투명성 의무 — 리포트에 반드시 붙는다
  assert.equal(r.report.meta.aiNotice, 'AI 생성 결과, 검토 필요')
  assert.equal(r.report.meta.analysisMode, 'base')
})

test('한 태스크가 죽어도 나머지는 남는다', async () => {
  const 예산죽음: TaskRunner = async (task) => {
    if (task.id === 'budget') throw new Error('429 할당량 초과')
    if (task.id === 'overview') return { fields: { title: makeValue('○○사업') }, costKrw: 1 }
    return { fields: {}, costKrw: 1 }
  }
  const r = await runBase({ doc: 문서(), contextTokens: 100_000, meta: META }, 예산죽음)

  // 예산 태스크가 죽었다고 개요까지 버리면 사용자는 아무것도 못 얻는다
  assert.equal(r.report.overview.title.value, '○○사업')
  const budget = r.outcomes.find((o) => o.taskId === 'budget')!
  assert.equal(budget.ok, false)
  assert.match(budget.error ?? '', /429/)
})

test('요구사항 태스크는 범위 칸에 붙는다', async () => {
  const runner: TaskRunner = async (task) =>
    task.id === 'requirements'
      ? { fields: { requirements: makeValue([{ code: 'SFR-001' }]) }, costKrw: 1 }
      : { fields: {}, costKrw: 0 }
  const r = await runBase({ doc: 문서(), contextTokens: 100_000, meta: META }, runner)
  // 태스크는 아홉이고 칸은 열하나다
  assert.ok(Array.isArray(r.report.scope.requirements.value))
})

test('이상 조항 태스크는 배열 칸으로 간다', async () => {
  const runner: TaskRunner = async (task) =>
    task.id === 'anomalies'
      ? { fields: { candidates: makeValue([{ title: 'ㄱ' }, { title: 'ㄴ' }]) }, costKrw: 1 }
      : { fields: {}, costKrw: 0 }
  const r = await runBase({ doc: 문서(), contextTokens: 100_000, meta: META }, runner)
  assert.equal(r.report.anomalies.length, 2)
})

// 근거 대조

test('모델이 채운 값이 근거 대조를 거친다', async () => {
  const r = await runBase({ doc: 문서(), contextTokens: 100_000, meta: META }, 예산만)
  // 인용이 원문에 있으므로 확인
  assert.equal(r.report.budget.totalAmount.grounding, 'confirmed')
  // 근거를 안 댄 값은 미확인이고 신뢰도가 깎인다
  assert.equal(r.report.budget.vatIncluded.grounding, 'unconfirmed')
  assert.ok((r.report.budget.vatIncluded.confidence ?? 1) <= 0.5)
})

test('지어낸 인용은 확인으로 안 넘어간다', async () => {
  const 지어냄: TaskRunner = async (task) =>
    task.id === 'budget'
      ? {
          costKrw: 1,
          fields: {
            totalAmount: makeValue(800_000_000, {
              grounding: 'confirmed', confidence: 0.99,
              evidence: [{ documentFileId: 'f1', blockId: 'b-없음', pageNo: 1, quote: '총 사업비는 금 팔억원정이며 부가세 별도이다' }],
            }),
          },
        }
      : { fields: {}, costKrw: 0 }
  const r = await runBase({ doc: 문서(), contextTokens: 100_000, meta: META }, 지어냄)
  // 모델이 채운 그대로 저장하면 화면의 확인 배지가 아무 뜻도 없어진다
  assert.equal(r.report.budget.totalAmount.grounding, 'unconfirmed')
})

test('근거 확인 비율을 낸다', async () => {
  const r = await runBase({ doc: 문서(), contextTokens: 100_000, meta: META }, 예산만)
  assert.equal(r.groundingRate, 0.5)
})

// 규칙 검증

test('산술 규칙이 리포트 위에서 돈다', async () => {
  const 어긋남: TaskRunner = async (task) =>
    task.id === 'schedule'
      ? {
          costKrw: 1,
          fields: {
            start: makeValue('2026-03-01'),
            end: makeValue('2026-09-30'),
            durationMonths: makeValue(12),
          },
        }
      : { fields: {}, costKrw: 0 }
  const r = await runBase({ doc: 문서(), contextTokens: 100_000, meta: META }, 어긋남)
  assert.ok(r.ruleFindings.some((f) => f.ruleId === 'schedule.duration_mismatch'))
})

test('나라장터 값과 다르면 짚는다', async () => {
  const r = await runBase({
    doc: 문서(), contextTokens: 100_000, meta: META,
    g2b: { noticeNo: '1', title: null, agency: null, budgetAmount: 300_000_000, proposalDeadline: null },
  }, 예산만)
  assert.ok(r.ruleFindings.some((f) => f.ruleId === 'g2b.budget_mismatch'))
})

test('나라장터 값이 없으면 대조를 건너뛴다', () => {
  const report = emptyReport({ ...META, costKrw: 0, durationMs: 0, generatedAt: '', fallbackApplied: false })
  assert.deepEqual(verifyRules(report, null).filter((f) => f.ruleId.startsWith('g2b')), [])
})

// 합치기 함수

test('assemble 이 빈 결과에서도 열한 칸을 만든다', () => {
  const outcomes: TaskOutcome[] = EXTRACT_TASKS.map((t) => ({
    taskId: t.id, ok: true, fields: {}, error: null, batches: 1, costKrw: 0,
  }))
  const report = assemble(outcomes, { ...META, costKrw: 0, durationMs: 0, generatedAt: '', fallbackApplied: false })
  assert.deepEqual(Object.keys(report).sort(), [...REPORT_TOP_KEYS].sort())
  assert.deepEqual(allNodes(report), [])
})

// 저장

test('검색용 행은 말단 값만 편다', () => {
  const report = emptyReport({ ...META, costKrw: 0, durationMs: 0, generatedAt: '', fallbackApplied: false })
  report.budget.totalAmount = makeValue(500_000_000, { confidence: 0.9 })
  report.budget.vatIncluded = makeValue(true)
  report.budget.mentions = makeValue([1, 2, 3])          // 배열은 안 편다
  report.schedule.proposalDeadline = makeValue('2026-04-10')
  report.overview.title = makeValue('○○사업')

  const rows = toFieldRows(report)
  const paths = rows.map((r) => r.fieldPath).sort()
  assert.deepEqual(paths, ['budget.totalAmount', 'budget.vatIncluded', 'overview.title', 'schedule.proposalDeadline'])

  const amount = rows.find((r) => r.fieldPath === 'budget.totalAmount')!
  assert.equal(amount.valueNum, 500_000_000)
  assert.equal(amount.valueText, null)
  // 불리언도 글자로 눕혀 둔다 — 「부가세 포함」으로 거를 수 있어야 한다
  assert.equal(rows.find((r) => r.fieldPath === 'budget.vatIncluded')!.valueText, 'true')
})

test('값이 없는 필드는 행을 만들지 않는다', () => {
  const report = emptyReport({ ...META, costKrw: 0, durationMs: 0, generatedAt: '', fallbackApplied: false })
  report.budget.totalAmount = makeValue<number>(null as never)
  // 만들면 「못 찾은 케이스」와 「없는 사업」이 섞인다
  assert.deepEqual(toFieldRows(report), [])
})

test('원본을 넣고 파생을 잇는다', async () => {
  const inserted: { table: string; values: unknown }[] = []
  const db: PersistClient = {
    from(table) {
      return {
        insert(values) {
          inserted.push({ table, values })
          return {
            select() {
              return {
                async single() {
                  return table === 'rfp_report_versions'
                    ? { data: { id: 'rv1', version: 1 }, error: null }
                    : { data: null, error: { code: 'PGRST116' } }
                },
              }
            },
          }
        },
      }
    },
    async rpc() { return { data: null, error: null } },
  }

  const report = emptyReport({ ...META, costKrw: 0, durationMs: 0, generatedAt: '', fallbackApplied: false })
  report.budget.totalAmount = makeValue(500_000_000)

  const r = await persistReport(db, {
    orgId: 'o1', caseId: 'c1', runId: null, report, version: 1, schemaId: 'v1.0',
  })

  assert.equal(r.reportVersionId, 'rv1')
  assert.equal(r.fieldCount, 1)
  // 원본 없이 파생만 남으면 근거를 못 보여 준다
  assert.equal(inserted[0].table, 'rfp_report_versions')
  assert.equal(inserted[1].table, 'rfp_report_fields')
  assert.equal((inserted[0].values as Record<string, unknown>).version, 1)
})

test('원본 저장이 실패하면 파생을 안 만든다', async () => {
  const db: PersistClient = {
    from() {
      return {
        insert() {
          return { select() { return { async single() { return { data: null, error: { message: '권한 없음' } } } } } }
        },
      }
    },
    async rpc() { return { data: null, error: null } },
  }
  const report = emptyReport({ ...META, costKrw: 0, durationMs: 0, generatedAt: '', fallbackApplied: false })
  await assert.rejects(
    () => persistReport(db, { orgId: 'o1', caseId: 'c1', runId: null, report, version: 1, schemaId: null }),
    /리포트를 저장하지 못했다/,
  )
})

test('다음 판 번호는 앞 판을 고치지 않는다', () => {
  assert.equal(nextVersion([]), 1)
  assert.equal(nextVersion([1, 2]), 3)
  assert.equal(nextVersion([3, 1]), 4)
})

test('ISO 날짜를 알아본다', () => {
  assert.equal(isIsoDate('2026-04-10'), true)
  assert.equal(isIsoDate('2026-04-10T09:00:00Z'), true)
  assert.equal(isIsoDate('○○사업'), false)
})

test('문서 전체 폴백도 예산을 지킨다 — 안 지키면 라우팅이 빗나간 태스크만 413 으로 죽는다', () => {
  const doc = {
    blocks: Array.from({ length: 200 }, (_, i) => ({ blockId: `b${i}`, text: '가'.repeat(200) })),
  } as never
  const big = renderWholeDoc(doc)
  const small = renderWholeDoc(doc, 500)
  assert.ok(small.length < big.length)
  assert.ok(small.includes('b0'), '앞쪽부터 담는다 — 공고문은 개요·예산을 앞에 둔다')
})

test('예산이 한 블록도 못 담을 만큼 작아도 빈 프롬프트는 안 보낸다', () => {
  const doc = { blocks: [{ blockId: 'b0', text: '가'.repeat(5000) }] } as never
  assert.ok(renderWholeDoc(doc, 5).length > 0)
})

test('블록이 없으면 빈 글', () => {
  assert.equal(renderWholeDoc({ blocks: [] } as never, 100), '')
})
