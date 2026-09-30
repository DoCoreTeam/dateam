/**
 * 리포트 저장이 계약 판 번호를 실제로 싣는지 본다
 *
 * **왜**: 판 번호는 값을 **만들 때만** 알 수 있다. 읽을 때 채우면 그때의 규칙이 아니라
 * 지금의 규칙을 적는 것이 되고, 그 값은 영영 못 올린다.
 * 그런데 「싣기로 했다」와 「실렸다」는 다른 명제다 — 칸 이름을 한 글자 틀리면
 * supabase-js 는 던지지 않고 **돌려준다**(→ lib/policy 의 조용한 실패 기록).
 * 그래서 실제로 insert 에 실린 객체를 붙잡아 본다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AI_CONTRACT_VERSION } from '@ax/ai-core'
import { readFileSync } from 'node:fs'
import { persistReport, recordAnalysisRun } from './persist.ts'
import { emptyReport, type Report } from '../report/schema.ts'
import { stripComments } from '../../ui/component-scan.ts'

/**
 * insert 에 넘어간 것을 붙잡는 가짜. 실제 표 이름별로 나눠 담는다
 *
 * `select()` 는 **기다려지기도 하고 single() 도 갖는다** — 실제 supabase-js 가 그렇다.
 * 가짜가 single() 만 갖고 있으면 코드가 single() 을 떼도 시험이 안 깨져서,
 * 바로 그 결함을 이 시험이 못 본다.
 *
 * @param fieldIds 파생 필드 insert 가 돌려줄 행 목록. 넣은 수와 다르게 주면 「일부만 들어감」이 된다
 */
function spyClient(opts: { fieldIds?: (n: number) => { id: string }[] } = {}) {
  const captured: Record<string, unknown[]> = {}
  const client = {
    from(table: string) {
      return {
        insert(rows: unknown) {
          const list = Array.isArray(rows) ? rows : [rows]
          captured[table] = (captured[table] ?? []).concat(list)
          const result =
            table === 'rfp_report_fields'
              ? {
                  data: (opts.fieldIds ?? ((n: number) =>
                    Array.from({ length: n }, (_, i) => ({ id: `f-${i}` }))))(list.length),
                  error: null,
                }
              : { data: { id: 'rv-1', version: 3 }, error: null }
          return {
            select: () => ({
              // PostgREST 를 흉내낸다: 한 행을 달라고 했는데 결과가 한 행이 아니면
              // 거절하면서 **넣던 것까지 되돌린다**. 그래서 data 가 비어 돌아온다
              single: async () =>
                Array.isArray(result.data) && result.data.length !== 1
                  ? { data: null, error: { code: 'PGRST116', message: 'multiple rows returned' } }
                  : { data: Array.isArray(result.data) ? result.data[0] : result.data, error: null },
              then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
            }),
          }
        },
      }
    },
  }
  return { client, captured }
}

const NODE = {
  value: '사업 하나', evidence: [], confidence: 0.9,
  grounding: 'confirmed', vendor: 'v1', verification: 'single',
}

/** 말단 값이 하나라도 있어야 파생 행이 생긴다 */
const REPORT = {
  ...emptyReport({
    analysisMode: 'base', baseVendor: 'v1', crossVendors: [], fallbackApplied: false,
    costKrw: 0, durationMs: 0, parserQuality: 1, generatedAt: '2026-09-14T00:00:00.000Z',
    aiNotice: '',
  } as never),
  overview: { title: NODE },
} as unknown as Report

/** 말단 값 셋 — 버킷을 갈라 두어 편 결과가 셋인지 셀 수 있게 한다 */
const REPORT_3 = {
  ...emptyReport({
    analysisMode: 'base', baseVendor: 'v1', crossVendors: [], fallbackApplied: false,
    costKrw: 0, durationMs: 0, parserQuality: 1, generatedAt: '2026-09-14T00:00:00.000Z',
    aiNotice: '',
  } as never),
  overview: { title: NODE },
  budget: { amountKrw: { ...NODE, value: 1_000_000 } },
  schedule: { dueAt: { ...NODE, value: '2026-10-01' } },
} as unknown as Report

test('리포트 원본에 계약 판 번호가 실린다', async () => {
  const { client, captured } = spyClient()
  await persistReport(client as never, {
    orgId: 'o1', caseId: 'c1', runId: 'r1', schemaId: 's1', version: 3, report: REPORT,
  })
  const row = captured['rfp_report_versions']?.[0] as Record<string, unknown>
  assert.ok(row, 'rfp_report_versions 에 아무것도 안 실렸다')
  assert.equal(row.contract_version, AI_CONTRACT_VERSION)
})

test('파생 필드에도 같은 판 번호가 실린다', async () => {
  const { client, captured } = spyClient()
  await persistReport(client as never, {
    orgId: 'o1', caseId: 'c1', runId: 'r1', schemaId: 's1', version: 3, report: REPORT,
  })
  const rows = (captured['rfp_report_fields'] ?? []) as Record<string, unknown>[]
  assert.ok(rows.length > 0, '파생 필드가 하나도 안 실렸다')
  for (const r of rows) assert.equal(r.contract_version, AI_CONTRACT_VERSION)
})

test('서식 판과 계약 판은 다른 칸이다', async () => {
  const { client, captured } = spyClient()
  await persistReport(client as never, {
    orgId: 'o1', caseId: 'c1', runId: 'r1', schemaId: 'schema-A', version: 3, report: REPORT,
  })
  const row = captured['rfp_report_versions']?.[0] as Record<string, unknown>
  assert.equal(row.schema_version, 'schema-A', '서식 판은 조직마다 다를 수 있다')
  assert.equal(row.contract_version, AI_CONTRACT_VERSION, '계약 판은 시스템에 하나다')
  assert.notEqual(row.schema_version, row.contract_version)
})

test('판 번호를 손으로 적은 숫자로 두지 않는다', () => {
  const src = readFileSync(new URL('./persist.ts', import.meta.url), 'utf8')
  assert.match(src, /AI_CONTRACT_VERSION/, '패키지 상수를 안 읽는다')
  assert.doesNotMatch(src, /contract_version:\s*\d/, '판 번호가 숫자로 박혀 있다 — 계약이 올라도 여기만 옛 판을 적게 된다')
})

test('필드 셋짜리 리포트를 넣으면 세 행이 들어간다', async () => {
  const { client, captured } = spyClient()
  const result = await persistReport(client as never, {
    orgId: 'o1', caseId: 'c1', runId: 'r1', schemaId: 's1', version: 3, report: REPORT_3,
  })
  const rows = (captured['rfp_report_fields'] ?? []) as Record<string, unknown>[]
  assert.equal(rows.length, 3, '펴야 할 말단 값이 셋인데 넣은 행이 셋이 아니다')
  assert.equal(result.fieldCount, 3)
  assert.deepEqual(
    rows.map((r) => r.field_path).sort(),
    ['budget.amountKrw', 'overview.title', 'schedule.dueAt'],
  )
})

test('넣은 행 수가 기대와 다르면 던진다', async () => {
  // 셋을 넣었는데 둘만 돌아온 상황. 오류가 없어도 이것은 실패다
  const { client } = spyClient({ fieldIds: () => [{ id: 'f-0' }, { id: 'f-1' }] })
  await assert.rejects(
    () => persistReport(client as never, {
      orgId: 'o1', caseId: 'c1', runId: 'r1', schemaId: 's1', version: 3, report: REPORT_3,
    }),
    /3행 넣으려 했는데 2행만/,
    '일부만 들어간 것을 다 들어간 것으로 넘겼다',
  )
})

test('한 행도 안 돌아오면 던진다', async () => {
  // single() 이 붙어 있던 시절의 증상 — PostgREST 가 거절하며 넣던 것까지 되돌린다
  const { client } = spyClient({ fieldIds: () => [] })
  await assert.rejects(
    () => persistReport(client as never, {
      orgId: 'o1', caseId: 'c1', runId: 'r1', schemaId: 's1', version: 3, report: REPORT_3,
    }),
    /3행 넣으려 했는데 0행만/,
  )
})

test('여러 행을 넣는 자리에 single() 이 붙어 있지 않다', () => {
  const src = readFileSync(new URL('./persist.ts', import.meta.url), 'utf8')
  const at = src.indexOf("from('rfp_report_fields')")
  assert.ok(at > 0, '파생 필드를 넣는 자리를 못 찾았다')
  // 그 insert 사슬이 끝나는 곳까지만 본다 — 다음 문장 전까지
  const chain = src.slice(at, src.indexOf('if (fieldError)', at))
  assert.doesNotMatch(
    chain,
    /\.single\(\)/,
    '여러 행을 넣고 single() 을 부르면 PostgREST 가 넣던 것까지 되돌린다',
  )
})

// 실행 이력 — rfp_analysis_runs 는 읽히기만 하고 한 번도 안 쓰였다

test('분석 한 판이 실행 이력에 적힌다', async () => {
  const { client, captured } = spyClient()
  const id = await recordAnalysisRun(client as never, {
    orgId: 'o1', caseId: 'c1', mode: 'base',
    baseModelId: '11111111-2222-4333-8444-555555555555',
    crossModelIds: [], costKrw: 1234, durationMs: 5678,
    status: 'succeeded', startedAt: '2026-09-30T00:00:00.000Z', fallbackApplied: [],
  })
  assert.equal(id, 'rv-1')
  const row = captured['rfp_analysis_runs']?.[0] as Record<string, unknown>
  assert.ok(row, 'rfp_analysis_runs 에 아무것도 안 실렸다')
  assert.equal(row.mode, 'base')
  assert.equal(row.cost_krw, 1234, '비용을 안 실으면 원장과 대조할 것이 없다')
  assert.equal(row.duration_ms, 5678)
  assert.equal(row.status, 'succeeded')
  assert.equal(row.base_model_id, '11111111-2222-4333-8444-555555555555')
  assert.ok(row.finished_at, '끝난 시각이 없으면 running 에 멈춘 줄과 구분이 안 된다')
})

test('uuid 가 아닌 모델 id 는 안 싣는다', async () => {
  const { client, captured } = spyClient()
  await recordAnalysisRun(client as never, {
    orgId: 'o1', caseId: 'c1', mode: 'base',
    baseModelId: 'gemini-2.5-flash', crossModelIds: ['also-not-uuid'],
    costKrw: 0, durationMs: 1, status: 'succeeded',
    startedAt: '2026-09-30T00:00:00.000Z', fallbackApplied: [],
  })
  const row = captured['rfp_analysis_runs']?.[0] as Record<string, unknown>
  // 칸이 uuid 라 아무 글자나 넣으면 줄 전체가 죽는다. 이력 한 줄 때문에 분석을 버리지 않는다
  assert.equal(row.base_model_id, null)
  assert.deepEqual(row.cross_model_ids, [])
})

test('이력을 못 적어도 분석을 세우지 않는다', async () => {
  const failing = {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => ({ data: null, error: { message: '권한 없음' } }),
          then: (r: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: '권한 없음' } }).then(r),
        }),
      }),
    }),
  }
  // 리포트는 이미 저장됐다. 이력 한 줄 때문에 그것을 버리면 사용자가 잃는 것이 훨씬 크다
  assert.equal(await recordAnalysisRun(failing as never, {
    orgId: 'o1', caseId: 'c1', mode: 'base', baseModelId: null, crossModelIds: [],
    costKrw: 0, durationMs: 1, status: 'failed',
    startedAt: '2026-09-30T00:00:00.000Z', fallbackApplied: [],
  }), null)
})

test('분석 경로가 이력을 적고 그 id 를 리포트에 싣는다', () => {
  const src = stripComments(readFileSync(new URL('./run-analyze.ts', import.meta.url), 'utf8'))
  assert.equal((src.match(/\brecordAnalysisRun\s*\(/g) ?? []).length, 1, '이력을 적는 자리가 하나가 아니다')
  assert.match(src, /runId,/, '적은 이력 id 를 리포트에 안 싣는다 — run_id 가 계속 null 이 된다')
  assert.doesNotMatch(src, /runId:\s*null/, 'runId 를 고정값 null 로 넘기고 있다')
})

