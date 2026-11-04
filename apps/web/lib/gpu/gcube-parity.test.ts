// 웹=CLI: 연결 창과 입력 창, teamda gpu gcube list|fetch|link 와 gpu entry create 가 같은 창구, 같은 저장 함수를 지난다
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { GPU_DEFS } from '../actions/defs/gpu.ts'

const root = path.resolve(import.meta.dirname, '../..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

const CASES = [
  { name: 'gpu.gcube.list', op: 'GET /api/pricing/gpu/gcube', cli: 'gpu gcube list', scope: 'read', file: 'app/api/pricing/gpu/gcube/route.ts', guard: /await requireMemberApi\(\)/, calls: /listGcubeListings\(supabase\)/ },
  { name: 'gpu.gcube.fetch', op: 'POST /api/pricing/gpu/gcube/fetch', cli: 'gpu gcube fetch', scope: 'admin', file: 'app/api/pricing/gpu/gcube/fetch/route.ts', guard: /await requireAdminApi\(\)/, calls: /fetchGcubeListings\(createAdminClient\(\)/ },
  { name: 'gpu.gcube.link', op: 'PATCH /api/pricing/gpu/gcube/link', cli: 'gpu gcube link', scope: 'admin', file: 'app/api/pricing/gpu/gcube/link/route.ts', guard: /await requireAdminApi\(\)/, calls: /linkGcubeListings\(createAdminClient\(\)/ },
  { name: 'gpu.entry.create', op: 'POST /api/pricing/gpu/entries', cli: 'gpu entry create', scope: 'write', file: 'app/api/pricing/gpu/entries/route.ts', guard: /await requireMemberApi\(\)/, calls: /createEntries\(await createClient\(\), createAdminClient\(\)/ },
] as const

for (const c of CASES) {
  test(`${c.name}: 정의 한 줄이 창구와 CLI 이름과 범위를 잇는다`, () => {
    const def = GPU_DEFS.find((d) => d.name === c.name)
    assert.ok(def)
    assert.deepEqual([def.op, def.cli, def.scope], [c.op, c.cli, c.scope])
  })

  test(`${c.name}: 사람 확인이 저장 함수보다 먼저다`, () => {
    const src = read(c.file)
    const guard = src.search(c.guard)
    const call = src.search(c.calls)
    assert.ok(guard > 0 && call > guard)
  })
}

test('읽기 창구는 서비스롤을 안 쓴다, 사이트는 safe-fetch 로만 받는다', () => {
  assert.doesNotMatch(read('app/api/pricing/gpu/gcube/route.ts'), /createAdminClient/)
  const store = read('lib/gpu/gcube-store.ts')
  assert.match(store, /^import 'server-only'/)
  assert.match(store, /safeFetchText\(GCUBE_PRICE_URL/)
  assert.doesNotMatch(store, /\bfetch\(/)
})

test('입력 창구는 역할을 서버에서 가르고, 저장은 검토 항목과 확정 함수를 지난다 (이전 입력과 같은 길)', () => {
  const route = read('app/api/pricing/gpu/entries/route.ts')
  assert.match(route, /isAdmin: auth\.user\.role === 'admin'/)
  const store = read('lib/gpu/entry-store.ts')
  assert.match(store, /^import 'server-only'/)
  assert.match(store, /from\('review_items'\)\.insert/)
  assert.match(store, /if \(!actor\.isAdmin\)[\s\S]*?status: 'pending'/)
  assert.match(store, /confirmReviewItem\(userDb, adminDb, item/)
  assert.match(store, /validateEntries\(rows/)
})
