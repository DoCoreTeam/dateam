// POST /api/crm/meetings/:id/extract — 전사에서 5축을 뽑아 인박스로 보낸다
//
// 이 라우트가 없어서 **5축이 구조적으로 발동할 수 없었다**(명세가 정한 트리거가 여기다).
// AI 가 읽어낸 것은 전부 제안으로 간다 — 코어 테이블에 직접 쓰지 않는다(절대규칙 1).
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { extractFiveAxis } from '@/lib/crm/services/meeting'
import { resolveSetting } from '@/lib/crm/services/setting'
import { mockAdapter } from '@/lib/crm/ai/adapters/mock'
import { hostAdapter } from '@/lib/crm/ai/adapters/host'
import { createAdminClient } from '@/lib/supabase/server'

type Ctx = { params: Promise<{ id: string }> }

/** 호스트 시스템 설정의 AI 키 — CRM 은 키를 따로 받지 않는다 */
async function readHostMeta(): Promise<Record<string, unknown>> {
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from('org_content').select('value').eq('key', 'META').maybeSingle()
  const value = (data as { value?: unknown } | null)?.value
  return (value && typeof value === 'object') ? value as Record<string, unknown> : {}
}

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    const db = getCrmDb(session.workspaceId)
    const setting = await resolveSetting(db, 'ai.model.extract')
    const name = typeof setting.value === 'string' ? setting.value.trim().toLowerCase() : 'auto'

    const adapter = name === 'mock' ? mockAdapter() : await hostAdapter(readHostMeta, name)
    return extractFiveAxis(session.workspaceId, session.memberId, id, adapter)
  })
}
