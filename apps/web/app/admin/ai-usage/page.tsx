import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { kstRangeToUtc, kstTodayKey } from '@/lib/datetime/kst'
import AiUsageDashboard, { type ProviderModelRow } from './AiUsageDashboard'

export default async function AiUsagePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = createAdminClient() as any
  const { data: profile } = await adm
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') redirect('/dashboard')

  // 이번 달(KST) provider·model 토큰 합계 — 비용 대시보드(세션3 §5-4) 서버 집계.
  // 범위 경계는 kstRangeToUtc로 KST월초~오늘을 UTC 절대시각으로 변환(±9h 사고 방지).
  const today = kstTodayKey()
  const monthKey = today.slice(0, 7) // 'YYYY-MM'
  const monthStart = `${monthKey}-01`
  const { fromIso, toIso } = kstRangeToUtc(monthStart, today)

  const { data: rawRows } = (await adm
    .from('ai_token_logs')
    .select('provider, model, prompt_tokens, output_tokens, total_tokens')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)) as {
    data:
      | { provider: string | null; model: string | null; prompt_tokens: number | null; output_tokens: number | null; total_tokens: number | null }[]
      | null
  }

  // provider·model 그룹 합산 (by-feature 라우트의 reduce 패턴 동일). provider NULL = legacy Gemini.
  const grouped = (rawRows ?? []).reduce<Record<string, ProviderModelRow>>((acc, r) => {
    const provider = r.provider ?? null
    const model = r.model ?? '(unknown)'
    const key = `${provider ?? 'legacy'}::${model}`
    if (!acc[key]) acc[key] = { provider, model, prompt_tokens: 0, output_tokens: 0, total_tokens: 0, call_count: 0 }
    acc[key].prompt_tokens += r.prompt_tokens ?? 0
    acc[key].output_tokens += r.output_tokens ?? 0
    acc[key].total_tokens += r.total_tokens ?? 0
    acc[key].call_count += 1
    return acc
  }, {})

  const providerModelRows = Object.values(grouped).sort((a, b) => b.total_tokens - a.total_tokens)

  return <AiUsageDashboard providerModelRows={providerModelRows} monthLabel={monthKey} />
}
