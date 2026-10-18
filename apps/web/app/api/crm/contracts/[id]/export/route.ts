// GET /api/crm/contracts/[id]/export?format=pdf|docx|html&version=N — 계약서 버전 하나를 파일로 (P0132 I12)
//
// 버전을 안 주면 지금 버전이다. 보낸 종이를 다시 받으려면 그 번호를 준다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { CrmError } from '@/lib/crm/domain/errors'
import { canExport } from '@/lib/access/guard'
import { EXPORT_DENIED } from '@/lib/terms'
import { CONTRACT_PAPER } from '@/lib/terms/contract-doc'
import { recordSystemEventAsync } from '@/lib/system-log/record'
import { exportContract, parseExportFormat, parseVersionNo } from '@/lib/crm/services/contract-export'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db }) => {
    // 멤버인 것과 파일로 빼도 되는 것은 다른 질문이다 (LOOP.md 7절 S2)
    if (!(await canExport('/crm'))) throw new CrmError('FORBIDDEN', EXPORT_DENIED)

    const id = (await params).id
    const q = req.nextUrl.searchParams
    const format = parseExportFormat(q.get('format'))
    const versionNo = parseVersionNo(q.get('version'))

    let file
    try {
      file = await exportContract(db, id, { format, versionNo })
    } catch (e) {
      if (e instanceof CrmError) throw e
      // 굽기 실패는 사용자 입력 문제가 아니다 — 다른 형식으로 받을 길을 같이 말한다
      await recordSystemEventAsync({
        source: 'crm_api', error: e, blocksUser: true,
        feature: 'crm-contract-export', context: { format },
      })
      return Response.json({ error: { message: CONTRACT_PAPER.renderFailed } }, { status: 502 })
    }

    const body = typeof file.body === 'string' ? file.body : Buffer.from(file.body)
    const disposition = format === 'html' ? 'inline' : 'attachment'
    return new Response(body, {
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': `${disposition}; filename="contract.${format}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        'X-Contract-Version': String(file.versionNo),
        'Cache-Control': 'no-store',
      },
    })
  })
}
