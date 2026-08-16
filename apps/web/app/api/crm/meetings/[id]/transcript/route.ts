// POST /api/crm/meetings/:id/transcript — 전사를 넣는다
//
// 지금은 **붙여넣기**가 주 경로다. 녹음 파일 업로드는 STT 업체 연결(Phase 2)이 필요한데,
// 그때까지 미팅 기능 전체를 막아 두면 아무도 못 쓴다.
// 실제로 많은 사람이 다른 도구의 전사나 손으로 적은 회의록을 들고 온다 — 그걸 버리게 하지 않는다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { transcribe } from '@/lib/crm/services/meeting'
import { pastedTranscriptAdapter, sttAdapterFor } from '@/lib/crm/stt/adapter'
import { CrmError } from '@/lib/crm/domain/errors'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    const fileUrl = typeof body.fileUrl === 'string' ? body.fileUrl.trim() : ''

    if (!text && !fileUrl) {
      throw new CrmError('VALIDATION_FAILED', '전사 내용을 붙여넣거나 녹음 파일을 올려 주세요.', { field: 'text' })
    }

    // 붙여넣기가 있으면 그것을 쓴다 — 사람이 직접 준 것이 업체 전사보다 정확하다
    const adapter = text ? pastedTranscriptAdapter(text) : sttAdapterFor(typeof body.vendor === 'string' ? body.vendor : null)
    return transcribe(session.workspaceId, session.memberId, id, adapter, fileUrl || '(붙여넣기)')
  })
}
