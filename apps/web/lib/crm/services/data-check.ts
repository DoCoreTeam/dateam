/**
 * 데이터 점검 (dacrm — "오류를 줄이는 자리")
 *
 * **구조**: 찾기는 규칙이, 고르기는 AI 가 한다.
 *   · 빈칸을 세는 것은 코드가 훨씬 잘하고, 값이 정확하고, 돈이 안 든다
 *   · 그런데 그 결과는 늘 수십 건이라 **아무도 안 읽는다** — 경고가 죽는 방식이 늘 이것이다
 *   · 그래서 "지금 손봐야 할 셋"을 AI 가 고르고 이유를 댄다
 *
 * **AI 가 없어도 반쪽은 돈다.** 규칙 결과는 그대로 화면에 나온다.
 * AI 가 실패하면 우선순위만 없을 뿐 목록은 살아 있다 — 이게 이 구조를 고른 진짜 이유다.
 *
 * **여기서 아무것도 고치지 않는다.** 무엇이 문제인지 말하고 그 화면으로 보낼 뿐이다.
 * 자동으로 채우면 그 값이 어디서 왔는지 아무도 모르게 된다(절대규칙 1).
 */

import { runAi } from '../ai/runner.ts'
import { adapterFromSetting } from './quick-create.ts'
import {
  dataCheckPrompt, buildDataCheckInput, parseDataCheck,
  type DataIssue, type DataCheckOutput,
} from '../ai/prompts/data-check.v1.ts'
import type { CrmDb } from '../db/client.ts'
import { getCrmDb } from '../db/client.ts'

/** 한 번에 보는 최대 건수 — 넘으면 AI 가 뭉뚱그린다. 화면에는 전부 나온다 */
export const MAX_TO_ASK = 40

/** 이 호출의 예상 비용(센트) */
const ESTIMATE_MINOR_USD = BigInt(1)

export interface DataCheckResult {
  issues: DataIssue[]
  /** 규칙이 찾은 전체 건수 — 화면이 잘렸는지 말할 수 있어야 한다 */
  total: number
  review: DataCheckOutput | null
  /** 왜 우선순위가 없나 */
  reason: string | null
}

/**
 * 규칙으로 찾는다 — 여기에 AI 는 관여하지 않는다.
 *
 * 무엇을 문제로 볼지는 **영업이 실제로 손해를 보는 것**만 골랐다.
 *   · 금액 없는 열린 딜 → 예상 매출에서 통째로 빠진다
 *   · 성사일이 지난 열린 딜 → 리포트의 이번 달 숫자가 거짓이 된다
 *   · 담당자 없는 딜 → 아무도 자기 일로 여기지 않는다
 *   · 연결된 사람이 없는 딜 → 누구에게 연락할지 모른다
 *   · 회사 없는 인물 → 어느 거래처인지 모르는 연락처가 된다
 *
 * "빈칸이니까" 넣은 항목은 하나도 없다. 그건 잔소리지 점검이 아니다.
 */
export async function scanDataIssues(db: CrmDb, now: Date = new Date()): Promise<DataIssue[]> {
  const out: DataIssue[] = []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const deals = await (db as any).crmDeal.findMany({
    where: { status: 'OPEN' },
    select: {
      id: true, name: true, amountMinor: true, expectedCloseDate: true, ownerId: true,
      company: { select: { name: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 300,
  }) as {
    id: string; name: string; amountMinor: bigint | null
    expectedCloseDate: Date | null; ownerId: string | null
    company: { name: string } | null
  }[]

  const dealIds = deals.map((d) => d.id)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contacts = dealIds.length > 0 ? await (db as any).crmDealContact.findMany({
    where: { dealId: { in: dealIds } }, select: { dealId: true },
  }) as { dealId: string }[] : []
  const withContact = new Set(contacts.map((c) => c.dealId))

  for (const d of deals) {
    const label = `${d.name}${d.company ? ` (${d.company.name})` : ''}`
    const href = `/crm/deals/${d.id}`

    if (d.amountMinor === null) {
      out.push({
        key: `deal:${d.id}:amount`, kind: 'deal.amount', label, href,
        detail: '금액을 안 정해 예상 매출 합계에서 빠집니다',
      })
    }
    if (d.expectedCloseDate && d.expectedCloseDate.getTime() < now.getTime()) {
      out.push({
        key: `deal:${d.id}:closeDate`, kind: 'deal.closeDate', label, href,
        detail: '예상 성사일이 지났는데 아직 열려 있습니다',
      })
    }
    if (!d.ownerId) {
      out.push({
        key: `deal:${d.id}:owner`, kind: 'deal.owner', label, href,
        detail: '담당자가 없어 아무도 자기 일로 챙기지 않습니다',
      })
    }
    if (!withContact.has(d.id)) {
      out.push({
        key: `deal:${d.id}:contact`, kind: 'deal.contact', label, href,
        detail: '연결된 사람이 없어 누구에게 연락할지 알 수 없습니다',
      })
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orphans = await (db as any).crmPerson.findMany({
    where: { companyId: null },
    select: { id: true, name: true }, take: 100,
  }) as { id: string; name: string }[]

  for (const p of orphans) {
    out.push({
      key: `person:${p.id}:company`, kind: 'person.company', label: p.name,
      href: `/crm/people/${p.id}`,
      detail: '어느 회사 사람인지 몰라 회사 화면에서 찾을 수 없습니다',
    })
  }

  return out
}

/**
 * 찾은 것 중 무엇부터인지 묻는다.
 *
 * **절대 던지지 않는다.** AI 가 실패해도 규칙 결과는 그대로 돌려준다 —
 * 우선순위가 없는 목록이 아무 목록도 없는 것보다 낫다.
 */
export async function checkData(
  workspaceId: string, now: Date = new Date(),
): Promise<DataCheckResult> {
  const db = getCrmDb(workspaceId)

  let issues: DataIssue[] = []
  try {
    issues = await scanDataIssues(db, now)
  } catch {
    return { issues: [], total: 0, review: null, reason: '데이터를 읽지 못했어요.' }
  }

  if (issues.length === 0) {
    return { issues, total: 0, review: null, reason: '지금 손볼 것이 없어요.' }
  }

  const asked = issues.slice(0, MAX_TO_ASK)
  const keys = asked.map((i) => i.key)

  try {
    const { output } = await runAi<DataCheckOutput>({
      db, workspaceId,
      // 새 종류를 만들지 않는다 — enum 을 늘리면 마이그레이션이 필요하다
      kind: 'ASSISTANT',
      prompt: dataCheckPrompt,
      input: buildDataCheckInput(asked),
      inputRef: { count: asked.length },
      parse: (text) => parseDataCheck(text, keys),
      adapter: await adapterFromSetting(db),
      estimateMinorUsd: ESTIMATE_MINOR_USD,
    })
    return {
      issues, total: issues.length, review: output,
      reason: output.picks.length === 0
        ? `${issues.length}건을 봤는데 지금 급히 손볼 것은 없었어요.`
        : null,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const budget = /BUDGET|예산/i.test(msg)
    return {
      issues, total: issues.length, review: null,
      reason: budget
        ? 'AI 예산 한도에 걸려 우선순위는 못 매겼어요. 아래 목록은 그대로 볼 수 있습니다.'
        : '우선순위는 지금 못 매겼어요. 아래 목록은 그대로 볼 수 있습니다.',
    }
  }
}
