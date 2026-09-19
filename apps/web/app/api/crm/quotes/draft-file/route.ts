// POST /api/crm/quotes/draft-file — 견적서 파일을 견적 «초안»으로
//
// **저장하지 않는다.** 파일도 남기지 않고 레코드도 만들지 않는다.
// 화면이 이 값을 검수 목록으로 보여 주고, 사람이 체크한 항목만 폼에 들어간다(§5-3).
//
// 응답은 **건 목록**이다(`quotes`). 한 장에 견적이 둘이면 둘로 온다.
// 그 건을 무엇에 쓸지(새 견적·있는 견적에 붙이기·원가)는 **이 창구가 정하지 않는다** —
// 여기는 읽어서 돌려줄 뿐이고, 고르는 일은 화면에서 사람이 한다.
//
// 인증·권한·오류·시스템 로그는 `withCrmApi` 한 곳을 지난다.
// AI 호출 기록·예산·재시도는 `runAi` 한 곳을 지난다. 여기서 다시 구현하지 않는다.

import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { CrmError } from '@/lib/crm/domain/errors'
import { draftQuoteFromFile, MAX_QUOTE_FILE_BYTES } from '@/lib/crm/services/quote-from-file'

export const dynamic = 'force-dynamic'
/*
  스캔 견적서를 그림째 읽는 길은 텍스트보다 오래 걸린다. 붙여넣기 경로(120초)와 같은 한계를
  주면 그림 경로만 늘 시간 초과로 죽는다 — 기다리는 이유가 다르면 한계도 달라야 한다.
*/
export const maxDuration = 180

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    let form: FormData
    try {
      form = await req.formData()
    } catch {
      throw new CrmError('VALIDATION_FAILED', '파일을 읽지 못했습니다. 다시 올려 주세요.', { field: 'file' })
    }

    const file = form.get('file')
    if (!(file instanceof File)) {
      throw new CrmError('VALIDATION_FAILED', '견적서 파일을 골라 주세요.', { field: 'file' })
    }

    /*
      크기는 **바이트를 읽기 전에** 본다. 다 읽고 나서 거절하면 20MB 를 메모리에 올린 뒤
      버리는 셈이고, 사용자는 그 시간을 그냥 기다린 것이다.
      상한 자체는 서비스가 한 번 더 본다 — 여기만 믿으면 다른 호출부가 생길 때 뚫린다.
    */
    if (file.size > MAX_QUOTE_FILE_BYTES) {
      throw new CrmError('VALIDATION_FAILED',
        `파일이 너무 큽니다. ${Math.round(MAX_QUOTE_FILE_BYTES / (1024 * 1024))}MB 이내로 올려 주세요.`,
        { field: 'file' })
    }

    return draftQuoteFromFile(session.workspaceId, {
      fileName: file.name,
      mimeType: file.type || null,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })
  })
}
