/**
 * 기존 데이터 이관 (dacrm T0-11)
 *
 *   pnpm --filter web exec node --experimental-strip-types scripts/migrate-v04.ts            드라이런(기본)
 *   pnpm --filter web exec node --experimental-strip-types scripts/migrate-v04.ts --apply    실제 이관
 *   ... --out <경로>    리포트를 파일로도 남긴다
 *
 * 원본: 호스트 '프로젝트관리'의 accounts · contacts · deals (Supabase 클라이언트로 읽는다)
 * 대상: crm_company · crm_person · crm_deal (getCrmDb 로 쓴다)
 *
 * 규칙
 *  - **기본이 드라이런이다.** --apply 를 명시하지 않으면 아무것도 쓰지 않는다.
 *  - 원본은 읽기만 한다. 지우지도 표시하지도 않는다 — 이관이 틀렸을 때 되돌릴 근거가 원본이다.
 *  - 이관 대상 판정은 lib/crm/migrate/v04-map.ts(순수)가 한다. 이 파일은 읽고 쓰기만 한다.
 *  - 멱등: 같은 원본 id 는 같은 CRM id 로 들어간다(v04_<uuid>). 두 번 돌려도 늘지 않는다.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { getCrmDb } from '../lib/crm/db/client.ts'
import { WORKSPACE_ID } from '../prisma/seed-data.ts'
import {
  mapAccount, mapContact, mapDeal, findDuplicateKeys, LOSSY_STAGES, TARGET_PIPELINE_ID,
  type MappedCompany, type MappedPerson, type MappedDeal,
} from '../lib/crm/migrate/v04-map.ts'

function loadEnv(): void {
  const path = join(import.meta.dirname, '..', '.env.local')
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadEnv()

const APPLY = process.argv.includes('--apply')
const outIdx = process.argv.indexOf('--out')
const OUT = outIdx >= 0 ? process.argv[outIdx + 1] : null

const host = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)
const db = getCrmDb(WORKSPACE_ID)

/** 원본 uuid 를 그대로 CRM id 로 쓰지 않는다 — 출처를 id 에 남겨 두면 재실행이 멱등해진다 */
const crmId = (kind: string, sourceId: string) => `v04_${kind}_${sourceId}`

const lines: string[] = []
const say = (s = '') => { lines.push(s); console.log(s) }

async function main(): Promise<void> {
  say(`# 이관 리포트 (dacrm T0-11)`)
  say()
  say(`- 모드: **${APPLY ? '실제 이관(--apply)' : '드라이런 — 아무것도 쓰지 않는다'}**`)
  say(`- 대상 워크스페이스: ${WORKSPACE_ID}`)
  say(`- 대상 파이프라인: ${TARGET_PIPELINE_ID}`)
  say()

  const [accRes, conRes, dealRes] = await Promise.all([
    host.from('accounts').select('id,name,website,industry,region,description'),
    host.from('contacts').select('id,name,email,phone,mobile,title,notes,account_id'),
    host.from('deals').select('id,title,stage,value,close_date,fit_score,account_id,description,next_action,lead_type,product'),
  ])
  for (const [label, r] of [['accounts', accRes], ['contacts', conRes], ['deals', dealRes]] as const) {
    if (r.error) throw new Error(`${label} 조회 실패: ${r.error.message}`)
  }

  const companies = (accRes.data ?? []).map(mapAccount as any) as MappedCompany[]
  const people = (conRes.data ?? []).map(mapContact as any) as MappedPerson[]
  const deals = (dealRes.data ?? []).map(mapDeal as any) as MappedDeal[]

  // ---- 원본 집계 (왕복 검증의 왼쪽) ----
  const srcAmountSum = deals.reduce((s, d) => s + (d.amountMinor ?? 0n), 0n)
  say(`## 1. 원본`)
  say()
  say(`| 원본 | 건수 |`)
  say(`|---|---|`)
  say(`| accounts | ${companies.length} |`)
  say(`| contacts | ${people.length} |`)
  say(`| deals | ${deals.length} |`)
  say(`| deals 금액 합 | ${srcAmountSum.toLocaleString()} 원 |`)
  say()

  // ---- 이관 불가·주의 ----
  const blocked = [
    ...companies.filter((c) => c.verdict !== 'ok').map((c) => ['회사', c.name, c.reason!] as const),
    ...people.filter((p) => p.verdict !== 'ok').map((p) => ['인물', p.name, p.reason!] as const),
    ...deals.filter((d) => d.verdict !== 'ok').map((d) => ['딜', d.name, d.reason!] as const),
  ]

  const dupDomain = findDuplicateKeys(companies, (c) => c.domain)
  const dupEmail = findDuplicateKeys(people, (p) => p.email)

  say(`## 2. 사람이 손대야 하는 것`)
  say()
  if (blocked.length === 0 && dupDomain.size === 0 && dupEmail.size === 0) {
    say(`없음 — 전부 그대로 이관 가능하다.`)
  } else {
    if (blocked.length > 0) {
      say(`| 종류 | 이름 | 사유 |`)
      say(`|---|---|---|`)
      for (const [k, n, why] of blocked) say(`| ${k} | ${n} | ${why} |`)
      say()
    }
    for (const [label, dup] of [['도메인', dupDomain], ['이메일', dupEmail]] as const) {
      if (dup.size > 0) {
        say(`**중복 ${label}** — CRM 은 워크스페이스 안에서 유일해야 한다. 먼저 병합이 필요하다.`)
        for (const [k, n] of Array.from(dup.entries())) say(`- \`${k}\` × ${n}건`)
        say()
      }
    }
  }
  say()

  const lossy = deals.filter((d) => LOSSY_STAGES.includes((dealRes.data ?? []).find((r: any) => r.id === d.sourceId)?.stage))
  say(`## 3. 뜻이 좁아지는 매핑 (손실은 아니지만 알고 있어야 한다)`)
  say()
  say(`호스트의 \`검증\`·\`컨택\` 두 스테이지가 CRM 의 \`요구사항 파악\` 하나로 합쳐진다. 해당 딜 ${lossy.length}건.`)
  say(`대응 필드가 없는 값(유형·제품·다음 액션·설명)은 버리지 않고 딜의 메모 활동으로 남긴다.`)
  say()

  // ---- 실제 이관 ----
  const ready = {
    companies: companies.filter((c) => c.verdict === 'ok'),
    people: people.filter((p) => p.verdict === 'ok'),
    deals: deals.filter((d) => d.verdict === 'ok'),
  }

  say(`## 4. 이관 대상`)
  say()
  say(`| 대상 | 이관 | 보류 |`)
  say(`|---|---|---|`)
  say(`| 회사 | ${ready.companies.length} | ${companies.length - ready.companies.length} |`)
  say(`| 인물 | ${ready.people.length} | ${people.length - ready.people.length} |`)
  say(`| 딜 | ${ready.deals.length} | ${deals.length - ready.deals.length} |`)
  say()

  if (!APPLY) {
    say(`> 드라이런이라 여기서 멈춘다. 실제로 옮기려면 \`--apply\` 를 붙인다.`)
  } else {
    await apply(ready, dealRes.data ?? [])
    say(`## 5. 왕복 검증`)
    say()
    const [cn, pn, dn, agg] = await Promise.all([
      db.crmCompany.count({ where: { id: { startsWith: 'v04_' } } }),
      db.crmPerson.count({ where: { id: { startsWith: 'v04_' } } }),
      db.crmDeal.count({ where: { id: { startsWith: 'v04_' } } }),
      db.crmDeal.aggregate({ where: { id: { startsWith: 'v04_' } }, _sum: { amountMinor: true } }),
    ])
    const dstSum = agg._sum.amountMinor ?? 0n
    const expectSum = ready.deals.reduce((s, d) => s + (d.amountMinor ?? 0n), 0n)

    const rows: [string, number | bigint, number | bigint][] = [
      ['회사 건수', ready.companies.length, cn],
      ['인물 건수', ready.people.length, pn],
      ['딜 건수', ready.deals.length, dn],
      ['딜 금액 합', expectSum, dstSum],
    ]
    say(`| 항목 | 기대 | 실제 | |`)
    say(`|---|---|---|---|`)
    let allOk = true
    for (const [label, exp, act] of rows) {
      const ok = String(exp) === String(act)
      if (!ok) allOk = false
      say(`| ${label} | ${exp} | ${act} | ${ok ? '✅' : '❌'} |`)
    }
    say()
    say(allOk ? '**왕복 검증 통과**' : '**왕복 검증 실패 — 이관 결과를 확인할 것**')
    if (!allOk) process.exitCode = 1
  }

  if (OUT) {
    writeFileSync(OUT, lines.join('\n') + '\n')
    console.log(`\n리포트 저장: ${OUT}`)
  }
}

async function apply(
  ready: { companies: MappedCompany[]; people: MappedPerson[]; deals: MappedDeal[] },
  rawDeals: any[],
): Promise<void> {
  for (const c of ready.companies) {
    await db.crmCompany.upsert({
      where: { id: crmId('co', c.sourceId) },
      create: {
        id: crmId('co', c.sourceId), workspaceId: WORKSPACE_ID, name: c.name,
        domain: c.domain, industry: c.industry, region: c.region,
        descriptionMd: c.descriptionMd, source: 'IMPORT',
      },
      update: { name: c.name, industry: c.industry, region: c.region },
    })
  }

  for (const p of ready.people) {
    await db.crmPerson.upsert({
      where: { id: crmId('pe', p.sourceId) },
      create: {
        id: crmId('pe', p.sourceId), workspaceId: WORKSPACE_ID, name: p.name,
        email: p.email, phone: p.phone, title: p.title, memo: p.memo,
        companyId: p.accountId ? crmId('co', p.accountId) : null,
        source: 'IMPORT',
      },
      update: { name: p.name, title: p.title },
    })
  }

  for (const d of ready.deals) {
    const src = rawDeals.find((r) => r.id === d.sourceId)
    if (!src?.account_id) continue // 회사가 없는 딜은 CRM 에서 만들 수 없다(companyId 필수)
    await db.crmDeal.upsert({
      where: { id: crmId('dl', d.sourceId) },
      create: {
        id: crmId('dl', d.sourceId), workspaceId: WORKSPACE_ID,
        companyId: crmId('co', src.account_id),
        pipelineId: TARGET_PIPELINE_ID, stageId: d.stageId,
        name: d.name, status: d.status,
        amountMinor: d.amountMinor, currency: d.currency,
        expectedCloseDate: d.expectedCloseDate, healthScore: d.healthScore,
        source: 'IMPORT',
      },
      update: { name: d.name, stageId: d.stageId },
    })

    // 대응 필드가 없는 값은 버리지 않고 메모 활동으로 남긴다
    if (d.carriedNote) {
      await db.crmActivity.upsert({
        where: { id: crmId('ac', d.sourceId) },
        create: {
          id: crmId('ac', d.sourceId), workspaceId: WORKSPACE_ID,
          type: 'NOTE', occurredAt: new Date(), title: '이관 보존 메모',
          body: d.carriedNote, dealId: crmId('dl', d.sourceId),
          companyId: crmId('co', src.account_id), source: 'IMPORT',
        },
        update: { body: d.carriedNote },
      })
    }
  }
}

main().catch((e) => {
  console.error('❌ 이관 실패:', e)
  process.exit(1)
})
