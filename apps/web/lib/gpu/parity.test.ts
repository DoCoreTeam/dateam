import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// L5 — 정합성 가드 테스트 (docs 05 §2 L5)
// 모든 읽기 라우트가 단일 SSOT(getGpuCatalog)를 거치는지 "구조적으로" 단언한다.
// 누군가 라우트에서 effective 가격을 제각각 재계산하면(=getGpuCatalog 미사용) 빌드/테스트 실패.

const ROOT = process.cwd() // apps/web
const READ_ROUTES = [
  'app/api/pricing/gpu/products/route.ts',
  'app/api/pricing/gpu/market/route.ts',
  'app/api/pricing/gpu/inventory/route.ts',
]

test('읽기 라우트 3종은 모두 getGpuCatalog(SSOT) 경유', () => {
  for (const rel of READ_ROUTES) {
    const src = readFileSync(join(ROOT, rel), 'utf8')
    assert.match(src, /getGpuCatalog/, `${rel} 가 getGpuCatalog를 사용하지 않음 — 메뉴 가격 불일치 위험`)
  }
})

test('읽기 라우트는 v_lowest_quotes를 직접 재조인하지 않음 (전파 누락 방지)', () => {
  for (const rel of READ_ROUTES) {
    const src = readFileSync(join(ROOT, rel), 'utf8')
    assert.doesNotMatch(
      src,
      /from\(['"]v_lowest_quotes['"]\)/,
      `${rel} 가 v_lowest_quotes를 직접 사용 — 1장당 전파 누락 위험. getGpuCatalog만 사용할 것`
    )
  }
})

test('고객 판매가격표는 가격표와 동일 API(/products) 사용', () => {
  const src = readFileSync(join(ROOT, 'app/(member)/pricing/catalog/page.tsx'), 'utf8')
  assert.match(src, /\/api\/pricing\/gpu\/products/, '고객가가 products API를 쓰지 않음 — 가격표와 불일치 위험')
})
