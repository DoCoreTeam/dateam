// GET /api/crm/quotes/[id]/document         — 표준 견적서 문서(JSON)
// GET /api/crm/quotes/[id]/document?format=xlsx — 같은 문서를 엑셀 파일로
//
// **화면·인쇄·엑셀이 같은 경로를 쓴다.** 내보내기를 따로 만들면
// 「화면에는 있는데 파일에는 없는」 항목이 생기고, 그걸 발견하는 것은 고객이다.
//
// **CSV 는 없앴다.** 견적서는 고객이 읽고 결재하는 문서인데 CSV 엔 서식이 없어
// 배치·금액 정렬·한글 금액이 전부 사라진다(사용자 지적: 「csv 쓰는 회사 없어」).
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { resolveCrmAccess } from '@/lib/crm/auth/requireCrmMember'
import { getCrmDb } from '@/lib/crm/db/client'
import { getQuoteDocument } from '@/lib/crm/services/quote-document'
import { quoteDocumentToXlsx } from '@/lib/crm/services/quote-xlsx'

type Ctx = { params: { id: string } }

export async function GET(req: NextRequest, { params }: Ctx) {
  const format = new URL(req.url).searchParams.get('format')

  if (format !== 'xlsx') {
    return withCrmApi('READONLY', async ({ db }) => getQuoteDocument(db, params.id))
  }

  // 파일 응답이라 공용 핸들러(JSON 봉투)를 쓰지 않는다 — 인증은 같은 SSOT 를 부른다
  const access = await resolveCrmAccess()
  if (!access.ok) {
    return Response.json({ error: { message: '영업 CRM 멤버만 내려받을 수 있습니다.' } }, { status: 403 })
  }

  const db = getCrmDb(access.session.workspaceId)
  const { document, violations, images } = await getQuoteDocument(db, params.id)

  // **어긋난 문서는 파일로 내보내지 않는다.** 화면은 경고를 띄우고 지나칠 수 있지만,
  // 파일은 그대로 고객에게 전달된다 — 되돌릴 방법이 없다.
  if (violations.length > 0) {
    return Response.json({
      error: { message: `금액이 서로 맞지 않아 내보낼 수 없습니다.\n${violations.map((v) => v.message).join('\n')}` },
    }, { status: 409 })
  }

  const out = await quoteDocumentToXlsx({ document, logo: images.logo })

  return new Response(new Uint8Array(out.buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      // 한글 파일명은 그대로 못 싣는다 — RFC5987 로 함께 보낸다
      'Content-Disposition': `attachment; filename="${document.meta.quoteNo}.xlsx"; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
      'Cache-Control': 'no-store',
    },
  })
}
