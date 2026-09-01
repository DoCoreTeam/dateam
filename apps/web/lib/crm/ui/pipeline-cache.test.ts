// lib/crm/ui/pipeline-cache.test.ts — 화면 캐시가 **틀린 화면을 만들지 않는지**
//
// 캐시는 빨라지려고 두는 것인데, 잘못 두면 「고쳤는데 안 바뀐다」를 만든다.
// 그래서 속도가 아니라 **안전 조건**을 못 박는다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readCachedPipelines, writeCachedPipelines, clearCachedPipelines } from './pipeline-cache.ts'

/** 브라우저가 없는 곳에서 도는 테스트라 sessionStorage 를 흉내 낸다 */
function installStorage(): Map<string, string> {
  const map = new Map<string, string>()
  const g = globalThis as unknown as { window?: unknown }
  g.window = {
    sessionStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => { map.set(k, v) },
      removeItem: (k: string) => { map.delete(k) },
    },
  }
  return map
}
function removeStorage(): void {
  delete (globalThis as unknown as { window?: unknown }).window
}

test('브라우저가 없으면(서버 렌더) 조용히 빈 값 — 서버에서 터지지 않는다', () => {
  removeStorage()
  assert.deepEqual(readCachedPipelines(), [])
  writeCachedPipelines([{ id: 'p1' }])   // 던지지 않아야 한다
  clearCachedPipelines()
})

test('받아 둔 것을 다음에 그대로 돌려준다', () => {
  installStorage()
  writeCachedPipelines([{ id: 'p1', name: '기본' }])
  assert.deepEqual(readCachedPipelines(), [{ id: 'p1', name: '기본' }])
  removeStorage()
})

test('빈 목록은 저장하지 않는다 — 「파이프라인이 없다」를 캐시하면 화면이 영영 빈다', () => {
  const map = installStorage()
  writeCachedPipelines([])
  assert.equal(map.size, 0)
  removeStorage()
})

test('지우면 다시 안 그려진다 — 단계를 고친 뒤 옛 단계가 남지 않게', () => {
  installStorage()
  writeCachedPipelines([{ id: 'p1' }])
  clearCachedPipelines()
  assert.deepEqual(readCachedPipelines(), [])
  removeStorage()
})

test('오래된 값은 안 쓴다 — 낡은 화면보다 빈 화면이 낫다', () => {
  const map = installStorage()
  const old = Date.now() - 11 * 60 * 1000
  map.set('crm:pipelines:v1', JSON.stringify({ at: old, items: [{ id: 'p1' }] }))
  assert.deepEqual(readCachedPipelines(), [])
  removeStorage()
})

test('깨진 값은 조용히 버린다 — 캐시 때문에 화면이 죽지 않는다', () => {
  const map = installStorage()
  map.set('crm:pipelines:v1', '{이건 JSON 이 아니다')
  assert.deepEqual(readCachedPipelines(), [])
  map.set('crm:pipelines:v1', JSON.stringify({ at: Date.now(), items: '배열이 아님' }))
  assert.deepEqual(readCachedPipelines(), [])
  removeStorage()
})

test('파이프라인을 바꾸는 유일한 통로가 캐시를 지운다 — 배선이 끊기면 실패한다', () => {
  const src = readFileSync('app/(crm)/crm/process/ProcessClient.tsx', 'utf8')
  assert.match(
    src,
    /clearCachedPipelines\(\)/,
    'ProcessClient 의 send() 가 캐시를 지우지 않는다 — 단계를 고쳐도 딜 보드가 옛 단계를 그린다',
  )
})

test('딜 화면은 첫 렌더가 아니라 effect 에서 캐시를 읽는다 — 하이드레이션이 깨지지 않게', () => {
  const src = readFileSync('app/(crm)/crm/deals/DealsClient.tsx', 'utf8')
  assert.match(src, /useEffect\(\(\) => \{[\s\S]{0,200}readCachedPipelines/, 'effect 안에서 읽어야 한다')
  assert.doesNotMatch(
    src,
    // `useState<BoardPipeline[]>(...)` 처럼 **제네릭이 붙은 형태**까지 잡는다 —
    // 처음엔 `useState\(` 만 봐서 실제 위반을 통과시켰다(일부러 깨서 발견)
    /useState\s*(<[^>]*>)?\s*\([^)]*readCachedPipelines/,
    'useState 초기값으로 읽으면 서버가 그린 HTML 과 달라져 하이드레이션이 깨진다',
  )
})
