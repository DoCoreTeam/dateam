// POST /api/rfp/intake/notice-url — 붙여넣은 공고 링크에 **무엇이 들어 있는지 먼저 보여 준다**
//
// 여기서는 아무것도 저장하지 않는다. 케이스를 먼저 만들고 「첨부 0건」을 보여 주면
// 사용자는 지울 수도 없는 빈 케이스를 떠안는다(실측 2026-09-10: 「리포트가 없다」).
//
// 갈래를 고르는 판단은 lib/rfp/intake/notice-preview.ts 에 있다. 여기는 결선만 한다 —
// 라우트 안에 판단을 두면 시험할 방법이 없어진다.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { createAdminClient } from '@/lib/supabase/server'
import { requireMemberApi } from '@/lib/auth/requireMemberApi'
import { previewNotice, isFail } from '@/lib/rfp/intake/notice-preview'
import { realPreviewDeps } from '@/lib/rfp/intake/preview-deps'

export const dynamic = 'force-dynamic'
// 기관 파일 서버는 느리고, 스크립트까지 읽어야 하는 게시판이 있다
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const gate = await requireMemberApi()
  if (gate.error) return gate.error

  let body: { url?: unknown }
  try {
    body = (await req.json()) as { url?: unknown }
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  // 키는 서비스 롤로만 읽는다 — 화면에 흘리지 않는다
  const result = await previewNotice(body.url, realPreviewDeps(createAdminClient()))
  if (isFail(result)) {
    return NextResponse.json(
      { error: result.error, fallback: result.fallback, url: result.url },
      { status: result.status },
    )
  }
  return NextResponse.json({ preview: result }, { status: 200 })
}
