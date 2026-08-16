// GET   /api/crm/settings — 설정 목록 (시크릿은 마스킹만)
// PATCH /api/crm/settings — 값 저장·지우기
//
// 설정은 시스템 동작을 바꾼다 — 관리자만.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { listSettings, setSetting } from '@/lib/crm/services/setting'
import { CrmError } from '@/lib/crm/domain/errors'

export async function GET() {
  return withCrmApi('ADMIN', async ({ db }) => ({ items: await listSettings(db, await settingContext()) }))
}

/**
 * 선택지를 만들 재료 — **지금 시스템 설정에 키가 등록된 AI만** 고를 수 있게 한다.
 *
 * 예전에는 텍스트 칸에 `gemini` 라고 직접 적으라고 했다. 무엇을 적어야 하는지도 모르고,
 * 적어도 키가 없으면 그제야 실패를 듣는다. 고를 수 없는 것은 아예 안 보여야 한다.
 */
async function settingContext() {
  try {
    const { createAdminClient } = await import('@/lib/supabase/server')
    const { getAvailableProviders, getDefaultProvider } = await import('@/lib/ai-chat/registry')
    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data } = await (admin as any)
      .from('org_content').select('value').eq('key', 'META').maybeSingle()
    const meta = ((data as { value?: unknown } | null)?.value ?? {}) as Record<string, unknown>

    const LABEL: Record<string, string> = { gemini: 'Gemini', claude: 'Claude', openai: 'OpenAI' }
    return {
      availableProviders: getAvailableProviders(meta).map((p) => ({
        id: p.id, label: LABEL[p.id] ?? p.id, model: p.model,
      })),
      defaultProvider: getDefaultProvider(meta)?.id ?? null,
    }
  } catch {
    // 시스템 설정을 못 읽어도 설정 화면은 떠야 한다 — 선택지만 줄어든다
    return { availableProviders: [], defaultProvider: null }
  }
}

export async function PATCH(req: NextRequest) {
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    const key = typeof body.key === 'string' ? body.key : ''
    if (!key) throw new CrmError('VALIDATION_FAILED', '설정 키가 필요합니다.', { field: 'key' })
    const value = body.value === null || body.value === undefined ? null : String(body.value)
    await setSetting(session.workspaceId, session.memberId, key, value)
    return { ok: true, key }
  })
}
