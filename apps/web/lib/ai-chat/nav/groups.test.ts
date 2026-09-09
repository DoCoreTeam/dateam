import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { AI_NAV_GROUPS, aiNavMatchPaths } from './groups.ts'
import { SERVICE_NAV, NAV_LABEL, NAV_AUDIENCE } from '../../nav/menu.ts'
import { serviceOf, surfaceOf } from '../../nav/surface.ts'
import { SERVICE_LABEL } from '../../terms/entity.ts'

const WEB = join(import.meta.dirname, '..', '..', '..')
const read = (rel: string) => readFileSync(join(WEB, rel), 'utf8')

const AI_DIR = 'app/(ai)/ai'
const LAYOUT = 'app/(ai)/layout.tsx'
const MEMBER_LAYOUT = 'app/(member)/layout.tsx'
const ADMIN_LAYOUT = 'app/admin/layout.tsx'

/** `app/(ai)/ai/**\/page.tsx` → 실제 주소 */
function aiRoutes(): string[] {
  const out: string[] = []
  const walk = (rel: string) => {
    for (const e of readdirSync(join(WEB, rel))) {
      const child = `${rel}/${e}`
      if (statSync(join(WEB, child)).isDirectory()) walk(child)
      else if (e === 'page.tsx') out.push(child.replace(`${AI_DIR}`, '/ai').replace('/page.tsx', '') || '/ai')
    }
  }
  walk(AI_DIR)
  return out.map((r) => (r === '' ? '/ai' : r)).sort()
}

test('가드가 헛돌지 않는다 — 화면이 실제로 있다', () => {
  assert.ok(aiRoutes().length >= 5, `화면 ${aiRoutes().length}개`)
})

// ── 등재: 표 세 곳이 같은 말을 해야 한다 ──

test('★ 서비스 표 세 곳에 전부 등재돼 있다 — 하나라도 빠지면 그 자리에서만 사라진다', () => {
  assert.equal(SERVICE_LABEL.ai, 'AI 스튜디오') // 간판
  assert.equal(serviceOf('/ai/analyze').key, 'ai') // 경로 판정
  assert.ok(SERVICE_NAV.some((s) => s.href === '/ai')) // 메인 사이드바의 서비스 묶음
})

test('★ 하위 서비스라 나가는 문이 필요하다 — 사이드바가 통째로 바뀌기 때문이다', () => {
  assert.equal(surfaceOf('/ai'), 'sub')
  assert.equal(surfaceOf('/ai/projects/abc'), 'sub')
})

test('경계를 본다 — /aix 는 AI 스튜디오가 아니다', () => {
  assert.notEqual(serviceOf('/aix').key, 'ai')
})

test('메뉴 이름은 간판과 같은 말을 쓴다 — 링크와 로고가 다른 말을 하면 안 된다', () => {
  assert.equal(NAV_LABEL['/ai'], SERVICE_LABEL.ai)
})

test('아직 관리자 전용이다 — 멤버를 열 때 고칠 곳은 이 표와 레이아웃 두 줄뿐이다', () => {
  assert.equal(NAV_AUDIENCE['/ai'], 'admin')
  assert.match(read(LAYOUT), /requireAdmin\(\)/)
})

// ── 배선: 만들고 안 꽂으면 없는 기능이다 ──

test('★ 레이아웃이 표를 펴 쓴다 — 손으로 적으면 화면이 늘 때 그 목록만 안 고쳐진다', () => {
  assert.match(read(LAYOUT), /AI_NAV_GROUPS\.map\(/)
})

test('★ 새 셸을 만들지 않는다 — 셸은 AppShell 하나뿐이다', () => {
  const src = read(LAYOUT)
  assert.match(src, /<AppShell/)
  assert.doesNotMatch(src, /MobileShell/)
})

test('★ 모든 AI 화면은 묶음에서 갈 수 있다 — 등재를 잊으면 길이 없는 화면이 된다', () => {
  const hrefs = AI_NAV_GROUPS.flatMap((g) => g.items.flatMap(aiNavMatchPaths))
  const orphans = aiRoutes().filter(
    (r) => !hrefs.some((h) => r === h || r.startsWith(`${h}/`)),
  )
  assert.deepEqual(orphans, [], `묶음에 없는 화면: ${orphans.join(' · ')}`)
})

test('묶음 안에서 같은 경로가 두 번 나오지 않는다 — 어느 자리가 켜질지 정해지지 않는다', () => {
  const hrefs = AI_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href))
  assert.equal(new Set(hrefs).size, hrefs.length, hrefs.join(' '))
})

// ── 중복 문 제거: 한 서비스로 들어가는 길은 한 자리다 ──

test('★ 상위 사이드바에 「AI 채팅」 한 줄이 되살아나지 않는다 — 서비스 묶음이 유일한 문이다', () => {
  const src = read(MEMBER_LAYOUT)
  assert.doesNotMatch(src, /href: '\/ai'/)
  assert.doesNotMatch(src, /\/ai-chat/)
})

test('★ 관리자 사이드바에도 중복 문이 없다 — 같은 화면이 두 자리에 있었다', () => {
  assert.doesNotMatch(read(ADMIN_LAYOUT), /\/admin\/ai-chat/)
})

// ── 옛 주소: 밖으로 나간 링크가 깨지면 안 된다 ──

test('★ 옛 주소 넷이 전부 영구 리다이렉트로 살아 있다', () => {
  const src = read('next.config.js')
  for (const s of ["'/ai-chat'", "'/ai-chat/:path*'", "'/admin/ai-chat'", "'/admin/ai-chat/:path*'"]) {
    assert.ok(src.includes(`source: ${s}`), `${s} 리다이렉트 없음`)
  }
  assert.match(src, /permanent: true/)
})

test('★ 공유 링크 화면이 실재한다 — 로그인 없이 열리는 주소라 이미 밖으로 나갔다', () => {
  assert.ok(aiRoutes().includes('/ai/shared/[token]'))
})

test('★ 화면에 옛 주소가 하드코딩으로 남지 않았다 — 리다이렉트는 안전망이지 정답이 아니다', () => {
  const bad: string[] = []
  const walk = (rel: string) => {
    for (const e of readdirSync(join(WEB, rel))) {
      const child = `${rel}/${e}`
      if (statSync(join(WEB, child)).isDirectory()) walk(child)
      else if (/\.tsx?$/.test(e)) {
        const src = readFileSync(join(WEB, child), 'utf8')
        // 주소 리터럴만 본다 — `@/lib/ai-chat/…` import 와 `/api/admin/ai-chat/…` API 는 안 옮겼다.
        // 저장 키(persistKey)도 주소가 아니다 — 바꾸면 사용자 목록 설정만 초기화된다.
        for (const line of src.split('\n')) {
          if (/['"`]\/ai-chat/.test(line) && !line.includes('persistKey')) bad.push(`${child}: ${line.trim()}`)
        }
      }
    }
  }
  walk(AI_DIR)
  assert.deepEqual(bad, [], `옛 주소가 남아 있다:\n  ${bad.join('\n  ')}`)
})
