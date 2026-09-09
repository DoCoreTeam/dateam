/**
 * 리포트 저장 (설계서 3.7.1)
 *
 * ## 왜 두 벌로 저장하나
 *
 * `rfp_report_versions` 에는 **JSON 원본을 통째로 불변 저장**한다 — 나중에 「그때 무엇이 적혀
 * 있었나」를 보여 주려면 그때의 모양 그대로가 있어야 한다.
 *
 * `rfp_report_fields` 에는 **검색과 필터에 쓸 말단 필드만** 편다 — JSON 안을 뒤져
 * 「예산 10억 넘는 케이스」를 찾으면 케이스가 늘수록 느려진다.
 *
 * 두 벌은 같은 트랜잭션에서 만들어져야 한다. 원본만 있고 파생이 없으면 화면 목록이 비고,
 * 파생만 있고 원본이 없으면 근거를 못 보여 준다.
 */

import type { Report, ValueNode } from '../report/schema.ts'

export interface FieldRow {
  fieldPath: string
  /** 원래 값 그대로. 화면이 이걸 그린다 */
  value: unknown
  /** 구간 검색이 인덱스를 타게 하려고 따로 뽑는다 */
  valueNum: number | null
  valueText: string | null
  confidence: number | null
  grounding: string
  verification: string
  evidence: unknown[]
}

/** 검색에 쓸 말단 필드만 편다. 배열과 객체는 펴지 않는다 */
const FLAT_BUCKETS = ['overview', 'schedule', 'budget', 'evaluation'] as const

/**
 * 리포트에서 검색용 행을 만든다.
 *
 * 값이 없는 필드는 행을 만들지 않는다 — 만들면 「예산이 null 인 케이스」가
 * 「예산을 못 찾은 케이스」와 「예산이 없는 사업」을 구분 못 하게 섞인다.
 */
export function toFieldRows(report: Report): FieldRow[] {
  const rows: FieldRow[] = []

  for (const bucket of FLAT_BUCKETS) {
    const entries = report[bucket] as Record<string, ValueNode<unknown>>
    for (const [key, node] of Object.entries(entries)) {
      if (node.value === null || node.value === undefined) continue
      if (Array.isArray(node.value) || typeof node.value === 'object') continue
      rows.push(toRow(`${bucket}.${key}`, node))
    }
  }
  return rows
}

function toRow(fieldPath: string, node: ValueNode<unknown>): FieldRow {
  const v = node.value
  return {
    fieldPath,
    value: v,
    valueNum: typeof v === 'number' ? v : null,
    // 불리언도 글자로 눕혀 둔다 — 「부가세 포함」으로 거를 수 있어야 한다
    valueText: typeof v === 'string' ? v : (typeof v === 'boolean' ? String(v) : null),
    confidence: node.confidence,
    grounding: node.grounding,
    verification: node.verification,
    evidence: node.evidence,
  }
}

export function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}([T ]|$)/.test(s) && !Number.isNaN(Date.parse(s))
}

/** supabase-js 에서 우리가 쓰는 것만 */
export interface PersistClient {
  from(table: string): {
    insert(values: unknown): {
      select(cols: string): { single(): Promise<{ data: unknown; error: unknown }> }
    }
  }
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>
}

export interface PersistInput {
  orgId: string
  caseId: string
  runId: string | null
  report: Report
  /** 이 케이스의 다음 판. 앞 판을 고치지 않는다 */
  version: number
  schemaId: string | null
}

export interface PersistResult {
  reportVersionId: string
  version: number
  fieldCount: number
}

/**
 * 리포트를 저장한다.
 *
 * 원본을 먼저 넣고 파생을 잇는다 — 원본 없이 파생만 남으면 근거를 못 보여 준다.
 */
export async function persistReport(db: PersistClient, input: PersistInput): Promise<PersistResult> {
  const { data, error } = await db
    .from('rfp_report_versions')
    .insert({
      org_id: input.orgId,
      case_id: input.caseId,
      run_id: input.runId,
      schema_version: input.schemaId,
      version: input.version,
      // 통째로 불변 저장 — 고치지 않고 다음 판을 만든다
      report: input.report,
    })
    .select('id, version')
    .single()

  if (error || !data) {
    throw new Error(`리포트를 저장하지 못했다: ${describe(error)}`)
  }
  const row = data as { id: string; version: number }

  const rows = toFieldRows(input.report)
  if (rows.length > 0) {
    const { error: fieldError } = await db
      .from('rfp_report_fields')
      .insert(rows.map((r) => ({
        org_id: input.orgId,
        report_version_id: row.id,
        field_path: r.fieldPath,
        value: r.value,
        value_num: r.valueNum,
        value_text: r.valueText,
        confidence: r.confidence,
        grounding: r.grounding,
        verification: r.verification,
        evidence: r.evidence,
      })))
      .select('id')
      .single()
    // 파생이 실패해도 원본은 남는다. 목록이 비는 것과 근거를 잃는 것 중 앞쪽이 덜 나쁘다
    if (fieldError && !isEmptyResult(fieldError)) {
      throw new Error(`리포트 파생 필드를 저장하지 못했다: ${describe(fieldError)}`)
    }
  }

  return { reportVersionId: row.id, version: row.version, fieldCount: rows.length }
}

/** 여러 행을 넣고 single() 을 부르면 나는 오류 — 실패가 아니다 */
function isEmptyResult(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code
  return code === 'PGRST116'
}

function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

/** 다음 판 번호 — 앞 판을 고치지 않는다 */
export function nextVersion(existing: readonly number[]): number {
  return existing.length === 0 ? 1 : Math.max(...existing) + 1
}
