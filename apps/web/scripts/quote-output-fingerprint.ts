// scripts/quote-output-fingerprint.ts — 견적서 출력 지문을 뜨고 기준선과 견준다 (P0132 I01)
//
// **읽기만 한다.** 트랜잭션을 READ ONLY 로 열고 끝나면 되돌린다. 쓰는 것은 지문 파일 하나다.
// 지문 파일에는 견적 id 와 sha256 만 있다 — 고객 이름도 금액도 안 들어간다.
//
// 쓰기:
//   기준선 뜨기  node --experimental-strip-types scripts/quote-output-fingerprint.ts --out <파일>
//   견주기       node --experimental-strip-types scripts/quote-output-fingerprint.ts --compare <기준선 파일>
// DATABASE_URL 이 필요하다 (apps/web/.env.local 의 그 값).

import { readFileSync, writeFileSync } from 'node:fs'
import { getCrmDb } from '../lib/crm/db/client.ts'
import { getQuoteDocument } from '../lib/crm/services/quote-document.ts'
import {
  fingerprintDocument, sha256, compareFingerprints, isOutputUnchanged,
  type FingerprintSet,
} from '../lib/crm/domain/quote-output-fingerprint.ts'

/** 견적서를 종이와 파일로 그리는 코드. 이 글자가 바뀌면 같은 재료라도 출력이 바뀐다 */
const RENDERERS = [
  'lib/crm/domain/quote-document.ts',
  'app/(crm)/crm/quotes/[id]/QuoteSheet.tsx',
  'app/(crm)/crm/quotes/[id]/quote-document.module.css',
  'lib/crm/services/quote-xlsx.ts',
  'lib/crm/api/paper-image.ts',
]

const TX_TIMEOUT_MS = 120_000

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] ?? null : null
}

async function collect(): Promise<FingerprintSet> {
  const renderers: Record<string, string> = {}
  for (const p of RENDERERS) renderers[p] = sha256(readFileSync(p, 'utf8'))

  // 워크스페이스 목록은 확장이 걸리지 않는 원시 질의로 읽는다 (읽기만)
  const probe = getCrmDb('fingerprint-probe')
  const rows = await probe.$queryRawUnsafe<{ id: string; workspaceId: string }[]>(
    'SELECT id, "workspaceId" FROM crm_quote WHERE "deletedAt" IS NULL ORDER BY id',
  )
  const byWs = new Map<string, string[]>()
  for (const r of rows) byWs.set(r.workspaceId, [...(byWs.get(r.workspaceId) ?? []), r.id])

  const quotes: FingerprintSet['quotes'] = []
  for (const [ws, ids] of byWs) {
    const db = getCrmDb(ws)
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY')
      await tx.$executeRawUnsafe(`SELECT set_config('app.workspace_id', $1, true)`, ws)
      for (const id of ids) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await getQuoteDocument(tx as any, id)
        quotes.push({ quoteId: id, hash: fingerprintDocument(result) })
      }
    }, { timeout: TX_TIMEOUT_MS })
  }
  /*
    **휴지통 견적까지 행 그대로도 센다.** 문서 지문은 열 수 있는 견적(살아 있는 것)만 뜬다.
    휴지통 견적은 되돌리면 다시 열리므로, 그 행과 줄이 그대로인지를 행 지문으로 지킨다.
  */
  const rowRows = await probe.$queryRawUnsafe<{ id: string; h: string }[]>(
    `SELECT q.id, md5(row_to_json(q)::text || coalesce((
       SELECT string_agg(row_to_json(l)::text, '|' ORDER BY l.id) FROM crm_quote_line l WHERE l."quoteId" = q.id
     ), '')) AS h
     FROM crm_quote q ORDER BY q.id`,
  )
  for (const r of rowRows) quotes.push({ quoteId: `row:${r.id}`, hash: r.h })
  return { renderers, quotes }
}

async function main(): Promise<void> {
  const out = arg('--out')
  const compare = arg('--compare')
  if (!out && !compare) {
    console.error('--out <파일> 또는 --compare <기준선 파일> 중 하나가 필요합니다')
    process.exit(2)
  }
  const now = await collect()
  if (out) {
    writeFileSync(out, JSON.stringify(now, null, 2))
    console.log(`견적 ${now.quotes.length}건, 그리는 코드 ${Object.keys(now.renderers).length}개 지문을 ${out} 에 남겼습니다`)
  }
  if (compare) {
    const base = JSON.parse(readFileSync(compare, 'utf8')) as FingerprintSet
    const diff = compareFingerprints(base, now)
    console.log(JSON.stringify({ base: base.quotes.length, now: now.quotes.length, ...diff }, null, 2))
    if (!isOutputUnchanged(diff)) {
      console.error('견적서 출력이 기준선과 다릅니다')
      process.exit(1)
    }
    console.log(`견적서 출력 그대로: 기준선 ${base.quotes.length}건 모두 같음`)
  }
  process.exit(0)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
})
