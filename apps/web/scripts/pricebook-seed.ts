/**
 * 가격 기준 첫 채움 (P0135 I13) — 사람이 처음부터 치지 않게 있는 자료로 먼저 채운다
 *
 *   ① 인건비 등급 넷 — 공표 노임단가(KOSA SW 기술자 평균임금, RFP R06 기본값과 같은 한 벌)
 *   ② 지난 견적에만 남은 항목 — 품목으로 자동 등록(「정리 전」). 이름과 규격이 둘 다 같아야 하나로 본다.
 *      「기타」처럼 이름이 너무 넓은 줄은 건너뛴다. 지난 견적의 줄은 건드리지 않는다(productId 도 안 잇는다)
 *   ③ gcube edge 는 화면의 「파일로 가져오기」로 넣는다(실제 가격표 파일) — 여기서는 미리 계산만 확인한다
 *
 * 몇 번 돌려도 같다(있으면 건너뜀). 만든 id 를 찍는다 — 되돌릴 때 그 id 로 지운다.
 *
 * 돌리기: cd apps/web && node --experimental-strip-types scripts/pricebook-seed.ts <워크스페이스 id> [제품 id]
 */

import { loadEnv } from '../tests/crm/integrity/_helpers.ts'
import { getCrmDb } from '../lib/crm/db/client.ts'
import { withCrmTx } from '../lib/crm/db/tx.ts'
import { createLaborGradeTx } from '../lib/crm/services/labor-grade.ts'
import { writeItemTx, previewPriceProduct } from '../lib/crm/services/pricebook.ts'
import { PUBLIC_LABOR_RATES_KRW, LABOR_GRADE_NAMES } from '../lib/crm/domain/pricebook/basis-lines.ts'

loadEnv()
const WS = process.argv[2]
const EDGE = process.argv[3] ?? null
if (!WS) throw new Error('워크스페이스 id 를 주세요')
const db = getCrmDb(WS)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const raw = db as any

/** 이름이 너무 넓어 품목으로 올리면 엉뚱한 단가가 따라오는 줄 */
const TOO_BROAD = new Set(['기타', '기타 항목', '항목'])
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toLowerCase()

async function grades(): Promise<string[]> {
  const have = await raw.crmLaborGrade.findMany({ where: {}, select: { name: true } })
  const names = new Set(have.map((g: { name: string }) => g.name))
  const made: string[] = []
  await withCrmTx(WS, async (tx) => {
    for (const [i, name] of LABOR_GRADE_NAMES.entries()) {
      if (names.has(name)) continue
      const row = await createLaborGradeTx(tx, WS, null, {
        name, roleLabel: '소프트웨어 기술자', publicRateMinor: String(PUBLIC_LABOR_RATES_KRW[name]), position: i,
      }, 'SEED', '공표 노임단가 (KOSA SW 기술자 평균임금)')
      made.push(row.id)
    }
  })
  return made
}

interface LineRow { name: string; descriptionMd: string | null; unit: string | null; unitPriceMinor: bigint; taxRate: unknown; createdAt: Date }

async function lines(): Promise<{ made: string[]; skipped: string[] }> {
  const rows: LineRow[] = await raw.$queryRawUnsafe(`
    select l.name, l."descriptionMd", l.unit, l."unitPriceMinor", l."taxRate", q."createdAt"
      from crm_quote_line l join crm_quote q on q.id = l."quoteId"
     where q."workspaceId" = $1 and q."deletedAt" is null and l."productId" is null
     order by q."createdAt" desc, l.position asc`, WS)
  const existing = await raw.crmProduct.findMany({ where: {}, select: { name: true, spec: true } })
  const seen = new Set(existing.map((e: { name: string; spec: string | null }) => `${norm(e.name)}|${norm(e.spec)}`))
  const made: string[] = []
  const skipped: string[] = []
  await withCrmTx(WS, async (tx) => {
    for (const r of rows) {
      const spec = (r.descriptionMd ?? '').split('\n')[0].trim() || null
      if (TOO_BROAD.has(r.name.trim())) { skipped.push(`${r.name} (이름이 너무 넓음)`); continue }
      const key = `${norm(r.name)}|${norm(spec)}`
      if (seen.has(key)) { skipped.push(`${r.name} ${spec ?? ''} (이미 있음)`); continue }
      seen.add(key)
      const id = await writeItemTx(tx, WS, null, null, {
        name: r.name.trim(), section: '기타', listPriceMinor: BigInt(r.unitPriceMinor), basis: 'FIXED', unit: r.unit,
        billing: 'ONCE', discountable: true, taxRate: Number(String(r.taxRate)) || 10, remark: null,
      }, made.length, { sourceKind: 'SEED', sourceName: '지난 견적' })
      await tx.crmProduct.update({ where: { id }, data: { autoRegistered: true, spec } })
      made.push(id)
    }
  })
  return { made, skipped }
}

const g = await grades()
const l = await lines()
console.log(JSON.stringify({ gradesMade: g, itemsMade: l.made, skipped: l.skipped }, null, 2))
if (EDGE) {
  const p = await previewPriceProduct(db, EDGE, null)
  console.log(JSON.stringify({
    edgeExamples: p.examples.map((e) => ({ ok: e.ok, once: String(e.onceMinor), annual: String(e.annualMinor), tco: String(e.tcoMinor), mismatches: e.mismatches })),
  }, null, 2))
}
process.exit(0)
