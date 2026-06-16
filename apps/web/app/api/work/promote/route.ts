import { NextRequest, NextResponse } from 'next/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { promoteDailyToDeptTask } from '@/app/(member)/dept-tasks/actions'

// POST /api/work/promote — 일일업무 → 부서업무 승격(참조, 복제X). 일일 행 클릭 1회로 사용.
//  body: { sourceLogId, departmentId, assigneeUserId?, targetDate?, priority? }
export async function POST(req: NextRequest) {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: '요청 형식 오류' }, { status: 400 }) }
  const sourceLogId = typeof body.sourceLogId === 'string' ? body.sourceLogId : ''
  const departmentId = typeof body.departmentId === 'string' ? body.departmentId : ''
  const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const
  const priority = typeof body.priority === 'string' && (PRIORITIES as readonly string[]).includes(body.priority)
    ? (body.priority as typeof PRIORITIES[number]) : undefined  // 화이트리스트 검증(임의 문자열 차단)
  const result = await promoteDailyToDeptTask(sourceLogId, {
    departmentId,
    assigneeUserId: typeof body.assigneeUserId === 'string' ? body.assigneeUserId : null,
    targetDate: typeof body.targetDate === 'string' ? body.targetDate : null,
    priority,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, id: result.data.id })
}
