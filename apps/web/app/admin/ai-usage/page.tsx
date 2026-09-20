import { redirect } from 'next/navigation'
import { createClient, createAdminClient, getRequestUser } from '@/lib/supabase/server'
import { kstRangeToUtc, kstTodayKey } from '@/lib/datetime/kst'
import AiUsageDashboard, { type ProviderModelRow } from './AiUsageDashboard'
import { foldByFeature, totalsOf, type CallRow } from '@/lib/ai/usage-query'
import { toBudgetLimit, type BudgetLimit } from '@/lib/ai/budget'

export default async function AiUsagePage() {
  const supabase = await createClient()
  const user = await getRequestUser()
  if (!user) redirect('/login')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adm = createAdminClient() as any
  const { data: profile } = await adm
    .from('profiles').select('role').eq('id', user.id).single()
  if (!profile || profile.role !== 'admin') redirect('/dashboard')

  /*
    오늘(KST) 원장 — 기능별 호출·거절·남은 횟수.

    예전에는 `ai_token_logs` 를 읽었다. 그 표는 토큰을 적는 자리라 **안 나간 호출이 아예
    없다** — 한도에 걸려 거절된 것도, 저장된 답으로 해결해 안 부른 것도 안 남는다.
    실측 2026-09-20: 사흘 50,243건 중 47,055건이 실패였는데 화면은 성공분의 토큰만 보여 줬고,
    그래서 「왜 이렇게 많이 나갔나」에 답할 수 없었다.
  */
  const today = kstTodayKey()
  const monthKey = today.slice(0, 7) // 'YYYY-MM'
  const monthStart = `${monthKey}-01`
  const { fromIso, toIso } = kstRangeToUtc(monthStart, today)

  const { fromIso: dayFromIso, toIso: dayToIso } = kstRangeToUtc(today, today)
  const [callsRes, budgetRes] = await Promise.all([
    adm.from('ai_llm_calls')
      .select('surface, ok, error, input_tokens, output_tokens, created_at')
      .gte('created_at', dayFromIso).lte('created_at', dayToIso)
      .order('created_at', { ascending: false }).limit(20_000),
    adm.from('ai_call_budget').select('feature, daily_limit, per_minute_limit, enabled'),
  ])

  // supabase-js 는 오류를 던지지 않고 돌려준다. 안 보면 조용히 「오늘 0건」이 된다
  if (callsRes.error) console.error('[ai-usage] 원장 읽기 실패', callsRes.error.message)
  if (budgetRes.error) console.error('[ai-usage] 상한 읽기 실패', budgetRes.error.message)

  const limits = new Map<string, BudgetLimit>()
  for (const row of (budgetRes.data ?? []) as unknown[]) {
    const l = toBudgetLimit(row)
    if (l) limits.set(l.feature, l)
  }
  const features = foldByFeature((callsRes.data ?? []) as CallRow[], limits)
  const totals = totalsOf(features)

  /*
    이번 달 공급자·모델별 토큰도 **같은 원장**에서 센다.

    예전에는 여기만 ai_token_logs 를 읽었다. 한 화면이 두 표를 읽으면 두 숫자가 안 맞는
    날이 오고, 그때 어느 쪽이 맞는지 아무도 모른다. 대신 원장이 생기기 전(마이그 253)
    기록은 이 표에 없으므로 그만큼은 안 보인다 — 화면이 그 사실을 말한다.
  */
  const { data: rawRows } = (await adm
    .from('ai_llm_calls')
    .select('provider_id, model_name, input_tokens, output_tokens')
    .gte('created_at', fromIso)
    .lte('created_at', toIso)
    .limit(50_000)) as {
    data:
      | { provider_id: string | null; model_name: string | null; input_tokens: number | null; output_tokens: number | null }[]
      | null
  }

  // provider·model 그룹 합산 (by-feature 라우트의 reduce 패턴 동일). provider NULL = legacy Gemini.
  const grouped = (rawRows ?? []).reduce<Record<string, ProviderModelRow>>((acc, r) => {
    const provider = r.provider_id ?? null
    const model = r.model_name ?? '(unknown)'
    const key = `${provider ?? 'legacy'}::${model}`
    if (!acc[key]) acc[key] = { provider, model, prompt_tokens: 0, output_tokens: 0, total_tokens: 0, call_count: 0 }
    acc[key].prompt_tokens += r.input_tokens ?? 0
    acc[key].output_tokens += r.output_tokens ?? 0
    acc[key].total_tokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0)
    acc[key].call_count += 1
    return acc
  }, {})

  const providerModelRows = Object.values(grouped).sort((a, b) => b.total_tokens - a.total_tokens)

  return (
    <AiUsageDashboard
      providerModelRows={providerModelRows}
      monthLabel={monthKey}
      todayKey={today}
      ledgerToday={features}
      totals={totals}
    />
  )
}
