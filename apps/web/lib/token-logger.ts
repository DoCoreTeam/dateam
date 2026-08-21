import { createAdminClient } from '@/lib/supabase/server'
import type { AiFeature } from '@/types/database'

interface LogParams {
  userId: string | null
  feature: AiFeature
  model: string
  provider?: string
  promptTokens: number
  outputTokens: number
  totalTokens: number
}

async function logAsync(params: LogParams): Promise<void> {
  try {
    const adminClient = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (adminClient as any).from('ai_token_logs').insert({
      user_id: params.userId,
      feature: params.feature,
      model: params.model,
      provider: params.provider ?? null,
      prompt_tokens: params.promptTokens,
      output_tokens: params.outputTokens,
      total_tokens: params.totalTokens,
      success: true,
    })
    await checkThreshold(adminClient)
  } catch {
    // fire-and-forget: 로깅 실패는 무시
  }
}

export function logTokenUsage(params: LogParams): void {
  logAsync(params).catch(() => {})
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkThreshold(adminClient: any): Promise<void> {
  try {
    const { data: metaRow } = await adminClient
      .from('org_content').select('value').eq('key', 'META').single()
    const meta = (metaRow?.value as Record<string, unknown>) ?? {}
    const threshold = typeof meta.ai_token_alert_threshold === 'number'
      ? meta.ai_token_alert_threshold : 1_000_000
    const currentMonth = new Date().toISOString().slice(0, 7)
    if (meta.ai_token_alert_sent_month === currentMonth) return

    const startOfMonth = `${currentMonth}-01T00:00:00.000Z`
    const { data: rows } = await adminClient
      .from('ai_token_logs')
      .select('total_tokens')
      .gte('created_at', startOfMonth) as { data: { total_tokens: number }[] | null }
    const monthTotal = rows?.reduce((s, r) => s + r.total_tokens, 0) ?? 0
    if (monthTotal < threshold) return

    /**
     * **관리자가 보는 곳에 남긴다.**
     *
     * 예전엔 META 에 `ai_token_alert_sent_month` 만 적고 끝났다. 주석에도
     * "notifications 테이블이 없을 수 있으므로"라고 적혀 있었는데, 그래서 이 코드는
     * **아무에게도 아무 말도 안 하는 상태로** 계속 돌았다. 플래그는 자기 자신만 막았다.
     * 이제 시스템 로그(v0.7.583)가 있으니 거기에 남긴다 — 화면에서 실제로 읽힌다.
     *
     * 한 달에 한 번이다(아래 플래그가 그 역할을 그대로 한다) — 매 호출마다 남기면
     * 임계치를 넘긴 날 로그가 수천 줄이 된다.
     */
    const { recordSystemEvent } = await import('./system-log/record.ts')
    await recordSystemEvent({
      source: 'host_ai',
      error: new Error(`이번 달 AI 토큰 사용량이 임계치를 넘었습니다 (${monthTotal.toLocaleString()} / ${threshold.toLocaleString()})`),
      reason: 'quota',
      feature: 'ai-budget',
      // 아직 막힌 건 아니다 — 예산 경고지 장애가 아니라서 warn 으로 둔다
      blocksUser: false,
      context: { monthTotal, threshold, month: currentMonth },
    })

    await adminClient.from('org_content')
      .update({ value: { ...meta, ai_token_alert_sent_month: currentMonth } })
      .eq('key', 'META')
  } catch {
    // 무시
  }
}
