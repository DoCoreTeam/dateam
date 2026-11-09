// GET   /api/crm/contracts/[id] — 계약서, 지금 버전, 칸을 채운 본문, 견적 변경 여부, 당사자
// PATCH /api/crm/contracts/[id] — 고친 본문 칸 값 제목으로 다음 버전 {version, body?, manual?, title?, note?}
//                                 {version, refill: true} 이면 지금 견적 값으로 자동 칸을 다시 채운 다음 버전
//                                 {version, direction?, formOwner?, docLayer?, parties?} 이면 계약 정보 고치기 (당사자를 바꾸면 다음 버전)
// DELETE /api/crm/contracts/[id]?mode=trash|purge — 휴지통으로 또는 영구 삭제 (체결 해지한 것은 거절, 되살리기는 ./restore)
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson, requireVersion } from '@/lib/crm/api/handler'
import { deleteContract, getContract, refillContractFromQuote, saveContractVersion, type SaveContractInput } from '@/lib/crm/services/contract'
import { listParties } from '@/lib/crm/services/contract-party'
import { updateContractMeta, type ContractMetaInput } from '@/lib/crm/services/contract-meta'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db }) => {
    const id = (await params).id
    // 계약을 먼저 읽는다 — 등급 거름망에 걸리면 여기서 「찾을 수 없음」이 되고 당사자는 안 읽는다
    const detail = await getContract(db, id)
    return { ...detail, parties: await listParties(db, id) }
  })
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ db, session }) => {
    const body = await readJson(req)
    const version = requireVersion(body)
    const id = (await params).id
    // 계약 정보(방향 양식 종류 당사자)는 버전 본문이 아니라 계약 행과 당사자를 고친다
    const meta = body as ContractMetaInput & { body?: unknown; manual?: unknown }
    if (meta.direction !== undefined || meta.formOwner !== undefined || meta.docLayer !== undefined || meta.parties !== undefined) {
      return updateContractMeta(db, session.workspaceId, { memberId: session.memberId, role: session.role }, id, version, meta)
    }
    if ((body as { refill?: unknown }).refill === true) {
      return refillContractFromQuote(db, session.workspaceId, session.memberId, id, version)
    }
    return saveContractVersion(session.workspaceId, session.memberId, id, version, body as SaveContractInput)
  })
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const mode = req.nextUrl.searchParams.get('mode') === 'purge' ? 'purge' : 'trash'
    await deleteContract(session.workspaceId, session.memberId, (await params).id, mode)
    return { ok: true, mode }
  })
}
