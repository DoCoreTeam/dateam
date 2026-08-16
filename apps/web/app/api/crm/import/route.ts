// POST /api/crm/import — 엑셀(CSV)에서 들여오기
//
// **두 단계다**: `preview` 로 무엇이 일어날지 세어 보고, 사람이 확인하면 `apply` 로 넣는다.
// 되돌리기를 만들지 않는 대신 **되돌릴 일 자체를 만들지 않는다**(services/import-csv.ts 참조).
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { withCrmTx } from '@/lib/crm/db/tx'
import { CrmError } from '@/lib/crm/domain/errors'
import {
  parseImportCsv, planImport, applyImport, IMPORT_LABEL, type ImportKind,
} from '@/lib/crm/services/import-csv'

/** 파일 본문 상한 — 넘으면 한 판이 서버리스 시간·메모리를 넘는다 */
const MAX_TEXT = 2_000_000

export async function POST(req: Request) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const body = await readJson(req)
    const kind = String(body.kind ?? '') as ImportKind
    const text = String(body.text ?? '')
    const mode = body.mode === 'apply' ? 'apply' : 'preview'

    if (!(kind in IMPORT_LABEL)) {
      throw new CrmError('VALIDATION_FAILED', '무엇을 들여올지 알 수 없습니다.', { field: 'kind' })
    }
    if (!text.trim()) {
      throw new CrmError('VALIDATION_FAILED', '파일 내용이 비어 있어요.', { field: 'text' })
    }
    if (text.length > MAX_TEXT) {
      throw new CrmError('VALIDATION_FAILED', '파일이 너무 커요. 나눠서 올려 주세요.', { field: 'text' })
    }

    const db = getCrmDb(session.workspaceId)
    const parsed = parseImportCsv(kind, text)
    const preview = await planImport(db, kind, parsed)

    if (mode === 'preview') return { preview }

    // 넣는 것은 관리자만 — 수백 건이 한 번에 생기는 일이다
    if (session.role !== 'OWNER' && session.role !== 'ADMIN') {
      throw new CrmError('FORBIDDEN', '들여오기는 관리자만 할 수 있습니다.')
    }

    const outcome = await withCrmTx(session.workspaceId, (tx) =>
      applyImport(tx, kind, preview, session.memberId))

    return { preview, outcome }
  })
}
