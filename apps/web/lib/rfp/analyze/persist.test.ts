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
import { persistReport } from './persist.ts'
import { emptyReport, type Report } from '../report/schema.ts'

/** insert 에 넘어간 것을 붙잡는 가짜. 실제 표 이름별로 나눠 담는다 */
function spyClient() {
  const captured: Record<string, unknown[]> = {}
  const client = {
    from(table: string) {
      return {
        insert(rows: unknown) {
          captured[table] = (captured[table] ?? []).concat(Array.isArray(rows) ? rows : [rows])
          return {
            select: () => ({
              single: async () => ({ data: { id: 'rv-1', version: 3 }, error: null }),
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
