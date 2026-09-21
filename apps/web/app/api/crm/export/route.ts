// GET /api/crm/export?kind=deals — CSV 내려받기 (dacrm FR-13)
//
// 파일로 바로 떨어져야 한다. JSON 을 주고 화면에서 만들게 하면
// 큰 목록에서 브라우저가 멈추고, 이스케이프를 화면이 또 구현하게 된다.
import type { NextRequest } from 'next/server'
import { resolveCrmAccess } from '@/lib/crm/auth/requireCrmMember'
import { getCrmDb } from '@/lib/crm/db/client'
import { exportCrm, EXPORT_LABEL, type ExportKind } from '@/lib/crm/services/export'
import { canExport } from '@/lib/access/guard'
import { EXPORT_DENIED } from '@/lib/terms'

export async function GET(req: NextRequest) {
  // 파일 응답이라 공용 핸들러(JSON 봉투)를 쓰지 않는다 — 인증은 같은 SSOT 를 부른다
  const access = await resolveCrmAccess()
  if (!access.ok) {
    return Response.json({ error: { message: '영업 CRM 멤버만 내려받을 수 있습니다' } }, { status: 403 })
  }

  /**
   * 멤버인 것과 **파일로 빼도 되는 것**은 다른 질문이다 (LOOP.md 7절 S2 · I10).
   *
   * 읽으라고 열어 준 사람이 CSV 단추 하나로 고객 전부를 파일로 만들 수 있으면,
   * 열어 준 것은 화면이 아니라 데이터 사본이다. 그래서 멤버 확인 위에 동작 판정을 둔다.
   * 부여가 0건이면 이 판정은 표면 판정과 같은 답이라 지금 쓰던 사람은 그대로 쓴다.
   */
  if (!(await canExport('/crm'))) {
    return Response.json({ error: { message: EXPORT_DENIED } }, { status: 403 })
  }

  const kind = req.nextUrl.searchParams.get('kind') ?? ''
  if (!(kind in EXPORT_LABEL)) {
    return Response.json({ error: { message: '무엇을 내려받을지 알 수 없습니다.' } }, { status: 400 })
  }

  const db = getCrmDb(access.session.workspaceId)
  const out = await exportCrm(db, kind as ExportKind)

  return new Response(out.csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      // 한글 파일명은 그대로 못 싣는다 — RFC5987 로 함께 보낸다
      'Content-Disposition': `attachment; filename="crm_export.csv"; filename*=UTF-8''${encodeURIComponent(out.filename)}`,
      // 잘렸으면 받는 쪽이 알 수 있게 — 조용히 자르면 "이게 전부"로 읽힌다
      'X-Crm-Rows': String(out.rows),
      'X-Crm-Truncated': out.truncated ? '1' : '0',
      'Cache-Control': 'no-store',
    },
  })
}
