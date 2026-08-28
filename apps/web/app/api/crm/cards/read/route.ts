// POST /api/crm/cards/read — 명함 이미지 n장을 읽어 «텍스트»로 돌려준다
//
// **레코드를 여기서 만들지 않는다.** 읽은 글자를 화면에 보여 주고,
// 사용자가 확인한 뒤 기존 붙여넣기 경로(`/api/crm/quick-create`)로 넘긴다.
// 그래야 명함·엑셀·서명 복붙이 **같은 규칙**으로 등록된다.
//
// **한 장이라도 읽히면 그것만 돌려준다.** 다섯 장 중 하나가 흐려서 전부 실패하면
// 사용자는 다시 다섯 장을 올려야 한다 — 실패한 장만 말해 준다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { CrmError } from '@/lib/crm/domain/errors'
import { getProviderConfig } from '@/lib/ai-chat/registry'
import { resolveGeminiModelChain } from '@/lib/ai/gemini-model'
import {
  readBusinessCard, assertCardFile, CARD_MAX_COUNT,
} from '@/lib/crm/services/card-read'

/** 장당 수십 초가 걸릴 수 있다 — 기본 10초로는 두 장도 못 읽는다 */
export const maxDuration = 300

async function readHostMeta(): Promise<Record<string, unknown>> {
  const { createAdminClient } = await import('@/lib/supabase/server')
  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (admin as any)
    .from('org_content').select('value').eq('key', 'META').maybeSingle()
  const value = (data as { value?: unknown } | null)?.value
  return (value && typeof value === 'object') ? value as Record<string, unknown> : {}
}

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async () => {
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      throw new CrmError('VALIDATION_FAILED', '파일 형식이 아닙니다.')
    }

    const files = form.getAll('files').filter((f): f is File => f instanceof File)
    if (files.length === 0) throw new CrmError('VALIDATION_FAILED', '명함 사진을 골라 주세요.', { field: 'files' })
    if (files.length > CARD_MAX_COUNT) {
      throw new CrmError('VALIDATION_FAILED',
        `한 번에 ${CARD_MAX_COUNT}장까지 읽을 수 있어요. 나눠서 올려 주세요.`, { field: 'files' })
    }
    for (const f of files) assertCardFile(f.size, f.type, f.name)

    // 키는 **호스트 것**을 쓴다 — CRM 이 키를 따로 갖지 않는다(재사용·단일구현 정책)
    const meta = await readHostMeta()
    const gemini = getProviderConfig(meta, 'gemini')
    if (!gemini) {
      throw new CrmError('CONFLICT',
        '명함을 읽으려면 시스템 설정에서 Gemini 키를 먼저 등록해 주세요.')
    }
    // 이미지 입력이라 JSON 모드가 필요 없다 — 사슬을 넓게 잡아 한도에 덜 걸린다
    const models = resolveGeminiModelChain(gemini.model, { requireJson: false })

    const items: { fileName: string; text: string }[] = []
    const failed: { fileName: string; reason: string }[] = []

    for (const f of files) {
      try {
        const base64 = Buffer.from(await f.arrayBuffer()).toString('base64')
        const r = await readBusinessCard(base64, f.type, f.name, { apiKey: gemini.apiKey, models })
        items.push({ fileName: r.fileName, text: r.text })
      } catch (e) {
        // **한 장이 실패해도 나머지는 살린다** — 전부 다시 올리게 하지 않는다
        failed.push({ fileName: f.name, reason: e instanceof CrmError ? e.message : '읽지 못했습니다.' })
      }
    }

    if (items.length === 0) {
      throw new CrmError('CONFLICT',
        failed[0]?.reason ?? '명함에서 글자를 읽지 못했습니다.')
    }
    return { items, failed }
  })
}
