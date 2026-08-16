import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const web = join(here, '..', '..')

// 이 저장소가 세 번 반복한 실패를 구조로 막는다:
//   "변경 API를 만들고 화면에 안 꽂아서, 있는데 없는 기능이 된다."
//   (CLAUDE.md §2-5 · docs/2026-08-16-ci-crud-audit/AUDIT.md)
//
// ⚠️ 스캐너 자체가 두 번 틀렸다. 그 교훈을 여기에 박아 둔다:
//   ① `grep`은 경로에 `(ci)` 괄호가 있으면 셸 글롭으로 죽어 **조용히 0건**을 낸다 → node로 센다
//   ② `.tsx`만 훑으면 `lib/ci/use-delete.ts` 같은 **훅에 있는 호출을 못 본다** → `.ts`도 훑는다
//   지표가 틀리면 없는 위반을 쫓거나 있는 위반을 놓친다. 그래서 이 파일은 자기 검증부터 한다.

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** 화면·훅이 실제로 부르는 (주소, 메서드) 집합 */
function collectCalls(): Set<string> {
  const calls = new Set<string>()
  for (const root of ['app', 'components', 'lib']) {
    for (const p of walk(join(web, root))) {
      const rel = relative(web, p)
      if (rel.includes(`${sep}api${sep}`)) continue
      if (!/\.(tsx|ts)$/.test(rel) || rel.endsWith('.test.ts')) continue
      const s = readFileSync(p, 'utf8')
      for (const m of s.matchAll(/fetch\(/g)) {
        const seg = s.slice(m.index ?? 0, (m.index ?? 0) + 330)
        const u = seg.match(/fetch\(\s*[`'"]([^`'"]+)/)
        if (!u || !u[1].includes('/api/ci')) continue
        const meth = seg.match(/method:\s*'(GET|POST|PATCH|PUT|DELETE)'/)
        calls.add(`${u[1].split('?')[0].replace(/\$\{[^}]+\}/g, '[id]').replace(/\/$/, '')} ${meth ? meth[1] : 'GET'}`)
      }
      // 주소만 돌려주는 헬퍼(use-delete의 endpointOf) — 메서드는 같은 파일의 fetch에 있다
      if (s.includes("method: 'DELETE'")) {
        for (const u of s.matchAll(/return\s+`(\/api\/ci\/[^`]+)`/g)) {
          calls.add(`${u[1].split('?')[0].replace(/\$\{[^}]+\}/g, '[id]').replace(/\/$/, '')} DELETE`)
        }
      }
    }
  }
  return calls
}

/** API 라우트가 노출하는 (주소, 메서드) */
function collectEndpoints(): { path: string; method: string }[] {
  const out: { path: string; method: string }[] = []
  const apiRoot = join(web, 'app', 'api', 'ci')
  for (const p of walk(apiRoot)) {
    if (!p.endsWith(`${sep}route.ts`)) continue
    const s = readFileSync(p, 'utf8')
    const path = `/api/ci/${relative(apiRoot, dirname(p)).split(sep).join('/')}`.replace(/\/$/, '')
    for (const m of s.matchAll(/export async function (GET|POST|PATCH|PUT|DELETE)/g)) {
      out.push({ path, method: m[1] })
    }
  }
  return out
}

/**
 * 화면이 부르지 않아도 되는 것 — **서버가 부르는 경로**다.
 * 여기에 넣을 때는 이유를 함께 적는다. 이유 없이 늘어나면 이 가드가 무력해진다.
 */
const SERVER_ONLY: Record<string, string> = {
  '/api/ci/internal/worker/tick POST': '서비스 토큰 전용(CI_WORKER_TOKEN). 화면이 부르면 안 된다',
  '/api/ci/alerts/sweep POST': '알림 평가는 잡 파이프라인(handlers.ts)이 돌린다. 이 라우트는 수동 트리거',
}

test('★ 스캐너가 실제로 동작한다 — 지표가 틀리면 이 가드 전체가 거짓말이 된다', () => {
  const calls = collectCalls()
  const eps = collectEndpoints()
  assert.ok(eps.length > 40, `엔드포인트를 ${eps.length}개밖에 못 찾았다 — 스캔 경로가 깨졌다`)
  assert.ok(calls.size > 25, `화면 호출을 ${calls.size}건밖에 못 찾았다 — .ts 누락이나 글롭 실패다`)
  // `.ts` 훅에 있는 호출을 실제로 잡는지 (예전 스캐너가 놓쳤던 자리)
  assert.ok(calls.has('/api/ci/contents/[id] DELETE'),
    'use-delete.ts(훅)의 호출을 못 봤다 — .tsx만 훑고 있다')
})

test('★ 변경 API는 화면에 배선돼 있다 — 만들고 안 꽂으면 없는 기능이다', () => {
  const calls = collectCalls()
  const missing: string[] = []
  for (const { path, method } of collectEndpoints()) {
    if (method === 'GET') continue          // 조회는 서버 컴포넌트가 직접 부른다
    const key = `${path} ${method}`
    const norm = `${path.replace(/\[[^\]]+\]/g, '[id]')} ${method}`
    if (SERVER_ONLY[key]) continue
    if (!calls.has(norm)) missing.push(key)
  }
  assert.deepEqual(missing, [],
    '이 변경 API를 부르는 화면이 없다. 화면에 꽂거나, 서버 전용이면 SERVER_ONLY에 이유와 함께 등록할 것')
})

test('서버 전용 예외에는 이유가 적혀 있다 — 이유 없이 늘면 가드가 무력해진다', () => {
  for (const [key, why] of Object.entries(SERVER_ONLY)) {
    assert.ok(why.length > 10, `${key} 의 예외 사유가 비어 있다`)
  }
})

test('★ 보드에 담긴 것을 볼 화면이 있다 — 담기만 되고 못 보면 뺄 수도 없다', () => {
  const p = join(web, 'app/(ci)/ci/boards/[id]/page.tsx')
  assert.ok(readFileSync(p, 'utf8').includes('getBoard'), '보드 상세가 담긴 항목을 읽지 않는다')
  const list = readFileSync(join(web, 'app/(ci)/ci/boards/BoardsView.tsx'), 'utf8')
  assert.match(list, /rowHref=/, '보드 목록의 행이 상세로 열리지 않는다(§2-3-1)')
})

test('★ 클라이언트 화면이 서버 전용 모듈에서 **값**을 가져오지 않는다 — 빌드가 깨진다', () => {
  // tsc는 이걸 못 잡는다. 실제로 화면을 열어야 "next/headers를 쓰는 컴포넌트를 import했다"가 뜬다.
  // (v0.7.492 · v0.7.503에서 두 번 밟았다)
  //
  // 서버 전용 = `@/lib/supabase/server`를 import하는 모듈.
  const serverOnly = new Set<string>()
  for (const p of walk(join(web, 'lib'))) {
    if (!p.endsWith('.ts') || p.endsWith('.test.ts')) continue
    if (readFileSync(p, 'utf8').includes("from '@/lib/supabase/server'")) {
      serverOnly.add('@/' + relative(web, p).split(sep).join('/').replace(/\.ts$/, ''))
    }
  }
  assert.ok(serverOnly.size > 5, `서버 전용 모듈을 ${serverOnly.size}개밖에 못 찾았다 — 스캔이 깨졌다`)

  const bad: string[] = []
  for (const root of ['app', 'components']) {
    for (const p of walk(join(web, root))) {
      if (!p.endsWith('.tsx')) continue
      const s = readFileSync(p, 'utf8')
      if (!s.startsWith("'use client'")) continue
      for (const m of s.matchAll(/^import\s+(?!type\s)([^;]+?)\s+from\s+'([^']+)'/gm)) {
        // `import type {...}`은 컴파일에서 지워지므로 안전하다. 값 import만 본다.
        if (m[1].trim().startsWith('type ')) continue
        if (serverOnly.has(m[2])) bad.push(`${relative(web, p)} → ${m[2]}`)
      }
    }
  }
  assert.deepEqual(bad, [],
    '클라이언트 컴포넌트가 서버 전용 모듈에서 값을 가져온다 — 순수 부분을 별도 모듈로 떼어낼 것')
})
