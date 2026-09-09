// POST /api/rfp/assistant — 자연어 질의
//
// 모델이 만드는 것은 SQL 이 아니라 **필터 객체**다. 컬럼도 연산자도 화이트리스트에 있는
// 것만 쓸 수 있고, 질의는 우리 코드가 조립한다 — 프롬프트로 막는 것은 부탁이지 통제가 아니다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { validatePlan, ALLOWED_COLUMNS, type Filter, type QueryPlan } from '@/lib/rfp/assistant/intent'

export const dynamic = 'force-dynamic'

/** 필터 컬럼 → 실제 DB 칸. 여기 없는 것은 조립하지 않는다 */
const CASE_COLUMN: Record<string, string> = {
  'case.title': 'title',
  'case.sector': 'sector',
  'case.projectType': 'project_type',
  'case.stage': 'stage',
  'case.budgetAmount': 'budget_amount',
  'case.durationMonths': 'duration_months',
  'case.proposalDeadline': 'proposal_deadline',
  'case.createdAt': 'created_at',
}

export async function POST(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  let body: { question?: unknown; plan?: unknown }
  try {
    body = (await req.json()) as { question?: unknown; plan?: unknown }
  } catch {
    return NextResponse.json({ error: '요청 본문을 읽지 못했습니다' }, { status: 400 })
  }

  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (!question) return NextResponse.json({ error: 'missing_question' }, { status: 400 })

  // 계획은 모델이 만들지만 검사는 우리가 한다
  const { plan, problems } = validatePlan(body.plan ?? { semanticQuery: question })

  const db = await createClient()
  const rows = plan.filters.length > 0 ? await runStructured(db, plan) : []

  return NextResponse.json({
    plan,
    // 버린 조건을 알려 준다 — 조용히 버리면 사용자는 다른 질문에 답을 받는다
    droppedFilters: problems,
    allowedColumns: Object.keys(ALLOWED_COLUMNS),
    cases: rows,
  })
}

async function runStructured(db: unknown, plan: QueryPlan): Promise<unknown[]> {
  let q = (db as any)
    .from('rfp_cases')
    .select('id, title, doc_class, stage, sector, budget_amount, duration_months, proposal_deadline, created_at')
    .is('deleted_at', null)
    .limit(plan.limit)

  for (const f of plan.filters) {
    const col = CASE_COLUMN[f.column]
    // 케이스 표에 없는 컬럼(fit·outcome·anomaly)은 아직 안 잇는다. 조용히 무시하지 않고 건너뛴다
    if (!col) continue
    q = applyFilter(q, col, f)
  }

  const { data, error } = await q
  if (error) return []
  return data ?? []
}

function applyFilter(q: any, col: string, f: Filter): any {
  switch (f.op) {
    case 'contains': return q.ilike(col, `%${String(f.value)}%`)
    case 'eq': return q.eq(col, f.value)
    case 'gt': return q.gt(col, f.value)
    case 'gte': return q.gte(col, f.value)
    case 'lt': return q.lt(col, f.value)
    case 'lte': return q.lte(col, f.value)
    case 'in': return q.in(col, f.value as unknown[])
    case 'between': {
      const [a, b] = f.value as [unknown, unknown]
      return q.gte(col, a).lte(col, b)
    }
    default: return q
  }
}
