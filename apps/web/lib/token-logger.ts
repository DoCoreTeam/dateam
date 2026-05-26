import { createAdminClient } from '@/lib/supabase/server'
import type { AiFeature } from '@/types/database'

interface LogParams {
  userId: string | null
  feature: AiFeature
  model: string
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

    // 어드민들에게 알림 (notifications 테이블이 없을 수 있으므로 META에만 기록)
    await adminClient.from('org_content')
      .update({ value: { ...meta, ai_token_alert_sent_month: currentMonth } })
      .eq('key', 'META')
  } catch {
    // 무시
  }
}
