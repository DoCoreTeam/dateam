// GET   /api/crm/budget — 이번 달 예산 상태 (화면 배지·배너가 읽는다)
// PATCH /api/crm/budget — 상한 조정. 올리면 차단이 즉시 풀린다(명세 3.6-4)
//
// BigInt 는 JSON 으로 못 나가므로 문자열로 내보낸다 — 금액을 number 로 접으면
// 큰 값에서 조용히 틀어진다(딜 금액과 같은 이유).
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { getBudget, setBudgetLimit, isAiDisabled } from '@/lib/crm/services/budget'
import { CrmError } from '@/lib/crm/domain/errors'

export async function GET() {
  return withCrmApi('READONLY', async ({ session }) => {
    const b = await getBudget(session.workspaceId)
    return {
      month: b.month,
      limitMinorUsd: b.limitMinorUsd.toString(),
      spentMinorUsd: b.spentMinorUsd.toString(),
      level: b.verdict.level,
      ratio: b.verdict.ratio,
      // 상한 0 은 "AI 끄기" — 산술로는 아직 안 넘었지만 첫 호출부터 막힌다
      aiDisabled: isAiDisabled(b.limitMinorUsd),
    }
  })
}

export async function PATCH(req: NextRequest) {
  // 상한 조정은 돈에 관한 결정이다 — 관리자만
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = await readJson(req)
    const raw = body.limitMinorUsd
    if (raw === null || raw === undefined || raw === '') {
      throw new CrmError('VALIDATION_FAILED', '상한을 입력해 주세요.', { field: 'limitMinorUsd' })
    }
    let limit: bigint
    try {
      limit = BigInt(typeof raw === 'number' ? Math.round(raw) : String(raw).trim())
    } catch {
      throw new CrmError('VALIDATION_FAILED', '상한은 정수여야 합니다.', { field: 'limitMinorUsd' })
    }
    const b = await setBudgetLimit(session.workspaceId, session.memberId, limit)
    return {
      month: b.month,
      limitMinorUsd: b.limitMinorUsd.toString(),
      spentMinorUsd: b.spentMinorUsd.toString(),
      blocked: Boolean(b.blockedAt),
    }
  })
}
