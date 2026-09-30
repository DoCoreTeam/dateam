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
 *
 * ## 판 번호를 여기서 박는 이유
 *
 * 값이 어떤 규칙으로 만들어졌는지는 **만들 때만 안다.** 읽을 때 채우면 그때의 규칙이 아니라
 * 지금의 규칙을 적는 것이 되고, 그 값은 영영 못 올린다. 그래서 저장하는 이 자리에서 박는다.
 *
 * 숫자를 손으로 적지 않고 패키지 상수를 읽는다. 손으로 적으면 계약이 올라도 이 파일만 옛 판을
 * 계속 적고, 그 사실은 데이터가 섞인 뒤에야 드러난다.
 */

import { AI_CONTRACT_VERSION } from '@ax/ai-core'
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

/** 결과 하나 */
export interface PgResult {
  data: unknown
  error: unknown
}

/**
 * `insert().select()` 의 결과.
 *
 * 그대로 기다리면 **넣은 행 전부**가 오고, `single()` 을 붙이면 한 행만 온다.
 * 여러 행을 넣고 `single()` 을 붙이면 PostgREST 가 거절하면서 **넣던 것까지 되돌린다** —
 * 그래서 여러 행 자리에서는 이 형이 `single()` 없이 쓰이는지가 중요하다.
 */
export interface SelectResult extends PromiseLike<PgResult> {
  single(): Promise<PgResult>
}

/** supabase-js 에서 우리가 쓰는 것만 */
export interface PersistClient {
  from(table: string): {
    insert(values: unknown): { select(cols: string): SelectResult }
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
      // 리포트 서식의 판(schema_version)과 다른 것이다. 이쪽은 값이 어떤 계약으로 만들어졌나
      contract_version: AI_CONTRACT_VERSION,
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
    // single() 을 붙이지 않는다. 여러 행을 넣고 한 행을 달라고 하면 PostgREST 가 거절하면서
    // 넣던 것까지 되돌린다 — 그러면 근거 필드가 한 행도 안 남는다
    const { data: fieldData, error: fieldError } = await db
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
        contract_version: AI_CONTRACT_VERSION,
      })))
      .select('id')

    if (fieldError) {
      throw new Error(`리포트 파생 필드를 저장하지 못했다: ${describe(fieldError)}`)
    }
    // 오류가 없어도 행 수를 센다. 일부만 들어간 것은 다 들어간 것처럼 보이고,
    // 그 사실은 화면에서 근거가 비었을 때에야 드러난다
    const inserted = Array.isArray(fieldData) ? fieldData.length : 0
    if (inserted !== rows.length) {
      throw new Error(
        `리포트 파생 필드를 ${rows.length}행 넣으려 했는데 ${inserted}행만 들어갔다`,
      )
    }
  }

  return { reportVersionId: row.id, version: row.version, fieldCount: rows.length }
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

/**
 * 분석 한 판을 실행 이력에 적는다.
 *
 * ## 왜 필요한가
 *
 * `rfp_analysis_runs` 는 **읽히기만 하고 한 번도 안 쓰였다.** 분석을 거는 창구가 그 표의
 * 행 수로 판 번호를 세는데, 늘 0건이라 판 번호가 언제나 1이었다. 그래서 같은 dedupeKey 가
 * 나오고 다시 분석을 걸면 새 잡 대신 있던 잡이 돌아왔다. 실측 2026-09-30: 표 0행.
 *
 * ## 왜 끝나고 적나
 *
 * 비용과 소요 시간은 **끝나야 안다.** 걸 때 적으면 status 가 running 에 멈춘 채
 * cost_krw 가 영영 null 인 반쪽 줄이 남는다 — 그것은 이 플랜이 고치려는 바로 그 모양이다.
 *
 * ## 못 적어도 분석을 세우지 않는다
 *
 * 이력은 분석 결과가 아니다. 리포트는 이미 저장됐고, 이력 한 줄 때문에 그것을 버리면
 * 사용자가 잃는 것이 훨씬 크다. 그래서 실패하면 null 을 돌려주고 판 번호만 못 오른다.
 */
export interface RunInput {
  orgId: string
  caseId: string
  mode: 'base' | 'cross_pre' | 'cross_post'
  baseModelId: string | null
  crossModelIds: string[]
  costKrw: number
  durationMs: number
  status: 'succeeded' | 'failed'
  startedAt: string
  fallbackApplied: unknown[]
}

/** uuid 로 안 생긴 값은 안 넣는다. 칸이 uuid 라 아무 글자나 넣으면 줄 전체가 죽는다 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function recordAnalysisRun(db: PersistClient, input: RunInput): Promise<string | null> {
  try {
    const { data, error } = await db
      .from('rfp_analysis_runs')
      .insert({
        org_id: input.orgId,
        case_id: input.caseId,
        mode: input.mode,
        base_model_id: input.baseModelId && UUID.test(input.baseModelId) ? input.baseModelId : null,
        cross_model_ids: input.crossModelIds.filter((id) => UUID.test(id)),
        target_fields: [],
        fallback_applied: input.fallbackApplied,
        cost_krw: input.costKrw,
        duration_ms: input.durationMs,
        status: input.status,
        started_at: input.startedAt,
        finished_at: new Date().toISOString(),
      })
      .select('id')
      .single()
    if (error || !data) return null
    return String((data as { id: unknown }).id)
  } catch {
    return null
  }
}
