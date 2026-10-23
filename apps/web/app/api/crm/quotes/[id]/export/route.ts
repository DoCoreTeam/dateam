// GET /api/crm/quotes/[id]/export?format=pdf          견적서 전체를 PDF 로
// GET /api/crm/quotes/[id]/export?format=png&page=n   견적서 n 쪽(1부터, 기본 1)을 이미지로
//
// 화면 미리보기를 서버에서 그대로 열어 굽는다(lib/quote-export). 새 배치를 짓지 않는다.
// 읽기 권한(withCrmApi READONLY)과 내보내기 판정(canExport) 둘 다 지나야 한다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { CrmError } from '@/lib/crm/domain/errors'
import { getQuoteDocument } from '@/lib/crm/services/quote-document'
import { canExport } from '@/lib/access/guard'
import { EXPORT_DENIED } from '@/lib/terms'
import { QUOTE_EXPORT } from '@/lib/terms/quote'
import { exportQuote, parseQuoteExportRequest, resolveExportOrigin } from '@/lib/quote-export/quote-export'
import { currentActing } from '@/lib/actions/acting-session'
import { exportCookiesFor } from '@/lib/actions/acting-cookies'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
// 브라우저를 띄우고 견적 화면을 한 번 연다, 회의록 내보내기(30초)보다 길게 잡는다
export const maxDuration = 60

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  return withCrmApi('READONLY', async ({ db }) => {
    // 파일은 한 번 나가면 회수할 수 없다, 단추를 숨기는 것으로는 못 막는다
    if (!(await canExport('/crm'))) throw new CrmError('FORBIDDEN', EXPORT_DENIED)

    const request = parseQuoteExportRequest(new URL(req.url).searchParams)
    const id = (await params).id
    // 화면이 읽는 그 문서. 없는 견적이면 여기서 NOT_FOUND 로 끝난다
    const { document, violations } = await getQuoteDocument(db, id)

    // 머리 없는 브라우저가 그 화면을 누구로 열지. 공개 API 관문이 부르면 쿠키가 없다,
    // 관문이 연 키 주인 문맥이면 그 사람 세션을 심는다 (P0159, lib/actions/acting-cookies)
    const acting = currentActing()
    const auth = exportCookiesFor({
      requestCookies: req.cookies.getAll().map((c) => ({ name: c.name, value: c.value })),
      acting,
      verifiedFactors: acting ? await verifiedFactorCount() : 0,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
      nowSec: Math.floor(Date.now() / 1000),
    })
    if (!auth.ok) throw new CrmError('FORBIDDEN', QUOTE_EXPORT.keyOwnerSecondFactor)

    const file = await exportQuote({
      quoteId: id,
      head: document,
      violations,
      origin: resolveExportOrigin(req.nextUrl.origin, {
        VERCEL: process.env.VERCEL,
        VERCEL_URL: process.env.VERCEL_URL,
        VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
        VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
      }),
      cookies: auth.cookies,
      request,
    })

    return new Response(new Uint8Array(file.body), {
      headers: {
        'Content-Type': file.contentType,
        // 한글 파일명은 그대로 못 싣는다, RFC5987 로 함께 보낸다
        'Content-Disposition': `attachment; filename="${encodeURIComponent(document.meta.quoteNo)}.${request.format}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        'Cache-Control': 'no-store',
      },
    })
  })
}

/** 키 주인의 확인된 2단계 장치 수. 키로 만든 세션은 aal1 이라 장치가 있으면 화면이 /mfa 로 보낸다 */
async function verifiedFactorCount(): Promise<number> {
  const { data } = await (await createClient()).auth.getUser()
  return (data.user?.factors ?? []).filter((f) => f.status === 'verified').length
}
