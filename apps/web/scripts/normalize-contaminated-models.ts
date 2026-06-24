// 기존 오염 모델명 일괄 정규화 — review_items / review_iterations 의 model_name 앞 공급사명 제거.
//   stripSupplierPrefix(SSOT) 재사용(결정론: 공급사명이 leading일 때만). 기본 dry-run, --apply 시 실제 UPDATE.
//   사용: PGPASSWORD=... node --experimental-strip-types scripts/normalize-contaminated-models.ts [--apply]
import pg from 'pg'
import { stripSupplierPrefix } from '../lib/gpu/canonical-model.ts'

const APPLY = process.argv.includes('--apply')

const client = new pg.Client({
  host: 'aws-1-ap-northeast-2.pooler.supabase.com',
  port: 6543,
  user: 'postgres.tsnlplkslfcwtchzdaai',
  password: process.env.PGPASSWORD ?? '',
  database: 'postgres',
})

function supplierOf(ex: Record<string, unknown>): string {
  for (const k of ['supplier', 'competitor_name']) {
    const v = ex[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

async function normalizeTable(table: string, jsonCol: string) {
  const { rows } = await client.query(
    `select id, ${jsonCol} as ex from ${table} where ${jsonCol} ? 'model_name'`,
  )
  let changed = 0
  for (const r of rows) {
    const ex = (r.ex ?? {}) as Record<string, unknown>
    const name = ex.model_name
    if (typeof name !== 'string' || !name) continue
    const sup = supplierOf(ex)
    const cleaned = stripSupplierPrefix(name, sup)
    if (cleaned !== name) {
      changed++
      console.log(`  [${table}] ${r.id}: "${name}" → "${cleaned}" (supplier="${sup}")`)
      if (APPLY) {
        await client.query(
          `update ${table} set ${jsonCol} = jsonb_set(${jsonCol}, '{model_name}', to_jsonb($1::text)) where id = $2`,
          [cleaned, r.id],
        )
      }
    }
  }
  console.log(`[${table}.${jsonCol}] 변경 대상 ${changed} / 전체 ${rows.length}`)
  return changed
}

async function main() {
  await client.connect()
  console.log(APPLY ? '=== APPLY (실제 UPDATE) ===' : '=== DRY-RUN (변경 안 함) ===')
  let total = 0
  total += await normalizeTable('review_items', 'current_extracted')
  total += await normalizeTable('review_iterations', 'extracted')
  console.log(`\n총 변경 ${APPLY ? '적용' : '예정'}: ${total}건`)
  await client.end()
}

main().catch((e) => { console.error(e); process.exit(1) })
