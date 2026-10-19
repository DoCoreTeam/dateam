// GET  /api/crm/labor-grades — 인건비 등급 목록 (?all=1 이면 숨긴 것까지)
// POST /api/crm/labor-grades — 등급 추가 (관리자)
//
// **원가가 대외비다.** 「중급 소프트웨어 엔지니어 월 800만원」이 새어 나가면 우리 원가 구조가 드러난다.
// 예전에는 그래서 목록 전체를 cost.view 로 막았는데, 그러면 견적을 쓰는 사람이 판매 단가조차 못 받았다.
// 이제 목록은 주되 원가 칸은 cost.view 가 있을 때만 싣는다(가리지 않고 뺀다).
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { viewerOf } from '@/lib/crm/auth/capabilities'
import { hasCapability } from '@/lib/crm/security/sensitivity'
import { listLaborGrades, createLaborGrade, toGradeJson, type LaborGradeInput } from '@/lib/crm/services/labor-grade'

export async function GET(req: NextRequest) {
  return withCrmApi('READONLY', async ({ db, session }) => {
    const all = new URL(req.url).searchParams.get('all') === '1'
    const rows = await listLaborGrades(db, { includeHidden: all })
    const canSeeCost = hasCapability(await viewerOf(db, session), 'cost.view')
    return { items: rows.map((r) => toGradeJson(r, canSeeCost)), canSeeCost }
  })
}

export async function POST(req: NextRequest) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    const row = await createLaborGrade(session.workspaceId, session.memberId, body as LaborGradeInput)
    return toGradeJson(row, true)
  })
}
