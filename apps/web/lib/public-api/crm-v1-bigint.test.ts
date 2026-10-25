/**
 * 공개 v1 CRM 조회는 BigInt 금액 칸을 웹과 같은 toXJson 으로 바꿔 내보낸다 (P0170 I04)
 *
 * 실측 2026-10-25: crm deal list-v1, quote list-v1, deal get-v1 이 전부 500
 * Prisma 행을 그대로 넘겨 JSON.stringify 가 BigInt 에서 멈췄다, 내부 라우트는 toDealJson toQuoteJson 을 지나 멀쩡했다
 * 이 가드는 BigInt 칸을 가진 모델의 서비스(딜 견적)를 부르는 v1 라우트가 그 변환을 같이 쓰는지 본다
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const V1_CRM = join(WEB, 'app/api/public/v1/crm')

/** BigInt 금액 칸을 가진 모델의 서비스 모듈과, 그 행을 JSON 으로 바꾸는 함수 */
const CONVERTERS: Record<string, string> = {
  '@/lib/crm/services/deal': 'toDealJson',
  '@/lib/crm/services/quote': 'toQuoteJson',
}
/** 행을 돌려주는 조회 함수 이름 꼴 */
const READS = /\b(get|list)[A-Z]\w*/

function routes(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === 'node_modules' || n.startsWith('.')) return []
    const p = join(dir, n)
    return statSync(p).isDirectory() ? routes(p) : n === 'route.ts' ? [p] : []
  })
}

test('BigInt 칸 모델을 읽는 v1 CRM 라우트는 toXJson 을 부른다', () => {
  const bad: string[] = []
  for (const file of routes(V1_CRM)) {
    const src = readFileSync(file, 'utf8')
    for (const [mod, conv] of Object.entries(CONVERTERS)) {
      const imp = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*'${mod}'`).exec(src)
      if (!imp) continue
      const reads = imp[1].split(',').map((s) => s.trim()).filter((n) => READS.test(n))
      const called = reads.filter((n) => new RegExp(`\\b${n}\\(`).test(src))
      if (called.length && !new RegExp(`\\b${conv}\\b`).test(src.replace(/\/\/.*$/gm, ''))) {
        bad.push(`${relative(WEB, file)}: ${called.join(',')} 를 부르는데 ${conv} 가 없다`)
      }
    }
  }
  assert.deepEqual(bad, [])
})

