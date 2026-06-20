import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'

export const dynamic = 'force-dynamic'

/**
 * GET /api/work/sync/version — 경량 변경 감지 토큰.
 *
 * 클라가 캐시한 이후 바뀐 리소스가 있는지 1회로 확인하기 위한 엔드포인트.
 * 리소스별 버전 토큰 = "<max(updated_at)>|<count>" — 행 갱신(updated_at 상승)과
 * 삭제(count 감소) 모두 토큰을 바꾸므로, 토큰 동일 = 변화 없음으로 판단 가능하다.
 *
 * 비용: 본인 범위(user_id) 한정 집계만 — (user_id, ...) 인덱스 활용, 풀스캔 없음.
 * 조직 스코프(부서업무 전체 가시범위)는 비용·RLS 복잡도가 커서 이번엔 제외한다.
 * (FE가 dept 변경 감지가 필요하면 별도 무거운 경로로 확장)
 */

type VersionRow = { count: number | null }

async function tokenFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  userId: string,
): Promise<string> {
  // 방어: userId 누락 시 즉시 실패. accounts/deals/contacts는 "팀 read" RLS라
  // user_id 필터가 빠지면 타인 활동 시각/건수가 토큰에 섞여 정보 노출 → 회귀 차단.
  if (!userId) throw new Error('tokenFor: userId required')
  // count: 본인 범위 행 수(삭제 반영). max updated_at: 최신 갱신 시각.
  const countPromise = (supabase.from(table) as any)
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
  const maxPromise = (supabase.from(table) as any)
    .select('updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const [{ count }, { data: maxRow }] = (await Promise.all([countPromise, maxPromise])) as [
    VersionRow,
    { data: { updated_at: string } | null },
  ]
  return `${maxRow?.updated_at ?? '0'}|${count ?? 0}`
}

// org 공유 + member-readable 리소스용 토큰 — user_id 스코프 없이 전체 변경 신호.
//   GPU pricing은 조직 공유 데이터(모든 admin이 동일 가격을 봄)라 user-scope가 부적합.
//   supply_quotes엔 updated_at이 없으나 모든 가격 변경(지정/견적/전략가/마진)이 gpu_audit_logs(ts)에
//   append되므로 이 한 테이블의 count|max(ts)가 전 pricing 변경을 잡는 신뢰 신호다.
//   gpu_audit_logs는 member_read RLS라 멤버도 토큰 조회 가능(가격 화면은 admin 전용이나 토큰은 무해).
async function tokenForGlobal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  // 화이트리스트 — 동적 인자 유입 시 컴파일 차단(DC-SEC 권고, 주입 표면 사전 봉쇄).
  table: 'gpu_audit_logs',
  tsCol: 'ts',
): Promise<string> {
  const countPromise = (supabase.from(table) as any).select('*', { count: 'exact', head: true })
  const maxPromise = (supabase.from(table) as any)
    .select(tsCol)
    .order(tsCol, { ascending: false })
    .limit(1)
    .maybeSingle()
  const [{ count }, { data: maxRow }] = (await Promise.all([countPromise, maxPromise])) as [
    VersionRow,
    { data: Record<string, string> | null },
  ]
  return `${maxRow?.[tsCol] ?? '0'}|${count ?? 0}`
}

export async function GET(): Promise<NextResponse> {
  const auth = await requireMemberApi()
  if (auth.error) return auth.error

  const supabase = await createClient()
  const userId = auth.user.id

  const [daily, calendar, weekly, projects, accounts, deals, contacts, pricing] = await Promise.all([
    tokenFor(supabase, 'daily_logs', userId),
    tokenFor(supabase, 'calendar_events', userId),
    tokenFor(supabase, 'weekly_reports', userId),
    tokenFor(supabase, 'projects', userId),
    tokenFor(supabase, 'accounts', userId),
    tokenFor(supabase, 'deals', userId),
    tokenFor(supabase, 'contacts', userId),
    // GPU pricing 변경 감지(org-wide) — 모든 가격 변경이 audit-log되므로 단일 토큰으로 충분.
    tokenForGlobal(supabase, 'gpu_audit_logs', 'ts'),
  ])

  return NextResponse.json(
    {
      versions: { daily, calendar, weekly, projects, accounts, deals, contacts, pricing },
      ts: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
