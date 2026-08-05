import type { AiChatProviderId } from '@/types/database'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any

export function isAvailabilitySchemaMissing(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42703'
}

export async function getModelSelectionError(
  admin: AdminClient,
  provider: AiChatProviderId,
  model: string,
): Promise<string | null> {
  const { data } = await admin.from('ai_model_catalog')
    .select('is_active, availability, availability_reason')
    .eq('provider', provider).eq('model_id', model).single()
  const row = data as {
    is_active?: boolean
    availability?: string
    availability_reason?: string | null
  } | null
  if (row?.is_active === false) return '더 이상 제공 목록에 없는 모델입니다. 다른 모델을 선택하세요.'
  if (row?.availability === 'limited' || row?.availability === 'unavailable') {
    return row.availability_reason ?? '현재 사용할 수 없는 모델입니다. 모델 상태를 새로고침하세요.'
  }
  return null
}
