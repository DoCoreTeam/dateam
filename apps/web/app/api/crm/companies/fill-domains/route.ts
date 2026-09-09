// GET  /api/crm/companies/fill-domains — 규칙으로 몇 곳이 채워지나 (읽기)
// POST /api/crm/companies/fill-domains — 실제로 채운다 (AI 0회)
//
// **AI 를 부르지 않는다.** 회사에 붙은 사람의 이메일이 `@sookmyung.ac.kr` 이면
// 도메인이 그것이라는 건 모델이 필요 없는 사실이다. 이걸 AI 에 맡겼기 때문에
// 보강 37건이 전부 할당량 초과로 죽었다(마지막 2026-08-24).
// 도메인이 잡히면 기관 종류는 `company-kind.ts` 가 공짜로 판정한다.
import type { NextRequest } from 'next/server'
import { withCrmApi } from '@/lib/crm/api/handler'
import { getCrmDb } from '@/lib/crm/db/client'
import { guessCompanyDomain, countFillable } from '@/lib/crm/domain/domain-guess'
import { kindFromDomain, COMPANY_KIND_LABEL } from '@/lib/crm/domain/company-kind'

/** 한 번에 볼 회사 수 상한 — 넘으면 잘랐다고 말한다 */
const SCAN_LIMIT = 2000

interface Row { id: string; name: string; domain: string | null }

async function scan(db: ReturnType<typeof getCrmDb>) {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const anyDb = db as any
  const [companies, people] = await Promise.all([
    anyDb.crmCompany.findMany({
      where: { domain: null },
      select: { id: true, name: true, domain: true },
      take: SCAN_LIMIT,
    }) as Promise<Row[]>,
    anyDb.crmPerson.findMany({
      where: { email: { not: null }, companyId: { not: null } },
      select: { companyId: true, email: true },
      take: SCAN_LIMIT * 5,
    }) as Promise<{ companyId: string; email: string }[]>,
  ])

  const byCompany = new Map<string, string[]>()
  for (const p of people) {
    const list = byCompany.get(p.companyId)
    if (list) list.push(p.email)
    else byCompany.set(p.companyId, [p.email])
  }
  return { companies, byCompany }
}

export async function GET() {
  return withCrmApi('READONLY', async ({ session }) => {
    const db = getCrmDb(session.workspaceId)
    const { companies, byCompany } = await scan(db)
    const counts = countFillable(
      companies.map((c) => ({ domain: c.domain, emails: byCompany.get(c.id) ?? [] })),
    )
    return { ...counts, scanned: companies.length, truncated: companies.length >= SCAN_LIMIT }
  })
}

export async function POST(req: NextRequest) {
  // 데이터를 바꾼다 — 화면에서만 숨기면 API 로 새어 나간다
  return withCrmApi('ADMIN', async ({ session }) => {
    const body = (await req.json().catch(() => ({}))) as { dryRun?: boolean }
    const db = getCrmDb(session.workspaceId)
    const { companies, byCompany } = await scan(db)

    const plan: { id: string; name: string; domain: string; kind: string | null }[] = []
    for (const c of companies) {
      const g = guessCompanyDomain(byCompany.get(c.id) ?? [])
      // **확신한 것만 쓴다.** 애매한 것을 밀어 넣으면 되돌리려고 사람이 68곳을 다시 봐야 한다
      if (!g?.confident) continue
      const kind = kindFromDomain(g.domain)
      plan.push({
        id: c.id,
        name: c.name,
        domain: g.domain,
        kind: kind ? (COMPANY_KIND_LABEL as Record<string, string>)[kind.kind] ?? null : null,
      })
    }

    if (body.dryRun) return { filled: 0, plan, dryRun: true }

    let filled = 0
    const failed: { name: string; reason: string }[] = []
    for (const p of plan) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any).crmCompany.update({ where: { id: p.id }, data: { domain: p.domain } })
        filled += 1
      } catch (e) {
        // 실패를 성공처럼 말하지 않는다 — 도메인이 겹치면 유니크에 걸린다
        failed.push({ name: p.name, reason: e instanceof Error && /unique|duplicate/i.test(e.message)
          ? '같은 도메인을 쓰는 회사가 이미 있어요'
          : '채우지 못했습니다' })
      }
    }
    return { filled, failed, plan, dryRun: false }
  })
}
