#!/usr/bin/env node
// S1 drift 게이트 — 운영 DB의 CHECK 제약(enum)을 psql로 실측해 schema-contract.ts와 일치하는지 검증.
// 의존성 추가 없이 시스템 psql 사용(pg 패키지 불필요).
// 사용: DATABASE_URL=postgres://... node scripts/gen-schema-contract.mjs [--check]
//   --check: 불일치 시 exit 1 (CI/커밋 훅용). 인자 없으면 enum 출력만.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const url = process.env.DATABASE_URL
if (!url) { console.error('DATABASE_URL 미설정'); process.exit(2) }

let liveDefs = ''
try {
  liveDefs = execFileSync('psql', [url, '-tAc',
    `select pg_get_constraintdef(oid) from pg_constraint
     where contype='c' and conrelid::regclass::text='competitor_product_mapping'
       and pg_get_constraintdef(oid) ~ 'pricing_model'`,
  ], { encoding: 'utf8' })
} catch (e) {
  console.error('[drift] psql 실행 실패(연결 불가):', e.message)
  process.exit(2)
}

const required = ['on_demand', 'reserved_1y', 'reserved_3y', 'spot', 'committed']
const dbMissing = required.filter(v => !liveDefs.includes(v))

const contractPath = join(__dirname, '..', 'lib', 'gpu', 'schema-contract.ts')
const contract = readFileSync(contractPath, 'utf8')
const contractMissing = required.filter(v => !contract.includes(v))

const isCheck = process.argv.includes('--check')
if (dbMissing.length || contractMissing.length) {
  console.error('[drift] DB↔계약서 불일치:')
  if (dbMissing.length) console.error('  DB에 없는 enum:', dbMissing.join(', '))
  if (contractMissing.length) console.error('  계약서에 없는 enum:', contractMissing.join(', '))
  process.exit(isCheck ? 1 : 0)
}
console.log('[drift] OK — pricing_model enum 5종 DB·계약서 일치')
