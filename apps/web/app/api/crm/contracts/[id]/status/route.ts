// POST /api/crm/contracts/[id]/status — 보냄 체결 해지 취소, 변경 계약서 만들기
//   {action: 'send'|'conclude'|'terminate'|'cancel', version, signedAttachmentId?}
//   {action: 'amend'} — 체결한 계약서에서 변경 계약서를 새로 만든다
// 체결과 해지는 관리자만 — 서비스가 역할을 보고 거절한다
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { CrmError } from '@/lib/crm/domain/errors'
import { isContractAction } from '@/lib/crm/domain/contract-status'
import { CONTRACT_SIGN } from '@/lib/terms/contract-doc'
import { createAmendment } from '@/lib/crm/services/contract'
import { changeContractStatus, type ContractActionInput } from '@/lib/crm/services/contract-sign'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    const id = (await params).id
    const body = await readJson(req)
    if (body.action === 'amend') return createAmendment(db, session.workspaceId, session.memberId, id)
    if (!isContractAction(body.action)) throw new CrmError('VALIDATION_FAILED', CONTRACT_SIGN.badAction, { field: 'action' })
    const version = requireVersion(body)
    return changeContractStatus(
      session.workspaceId, { memberId: session.memberId, role: session.role }, id, version, body.action, body as ContractActionInput,
    )
  })
}
