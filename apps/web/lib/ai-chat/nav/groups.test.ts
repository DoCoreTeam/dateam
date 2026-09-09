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

// ── 기획서 목업과 대조 ──
//
// 이 묶음은 승격안 §04 「이렇게 보입니다」의 사이드바 목업이 정해 놓은 것이다.
// 처음 구현에서 문서함과 모델 두 칸이 빠졌고 **사용자가 화면을 보고 잡았다**(v0.7.716).
// 사람이 목업과 화면을 눈으로 대조하는 일은 다시 시키지 않는다.

test('★ 기획서 목업의 다섯 칸이 전부 있다 — 빠뜨리면 여기서 먼저 걸린다', () => {
  const labels = AI_NAV_GROUPS.flatMap((g) => g.items.map((i) => i.label))
  assert.deepEqual(labels, ['채팅', '프로젝트', '목록 심층분석', '문서함', '모델'])
})

test('★ 묶음 이름도 목업과 같다 — 이름이 바뀌면 정보구조가 바뀐 것이다', () => {
  assert.deepEqual(AI_NAV_GROUPS.map((g) => g.label), ['대화', '분석', '그 밖'])
})

test('★ 문서함은 자기 주소를 가진다 — 탭이면 분석을 열어야 결과가 보인다(계약 E)', () => {
  const doc = AI_NAV_GROUPS.flatMap((g) => g.items).find((i) => i.label === '문서함')
  assert.equal(doc?.href, '/ai/documents')
  assert.match(read(`${AI_DIR}/documents/page.tsx`), /DocumentListClient/)
})

test('★ 옛 탭 주소는 리다이렉트로 산다 — 완료 안내에서 나간 링크가 이미 밖에 있다', () => {
  const src = read(`${AI_DIR}/analyze/page.tsx`)
  assert.match(src, /tab === 'documents'\) redirect\('\/ai\/documents'\)/)
})

test('★ 문서함으로 가는 길이 한 벌이다 — 분석 탭에 같은 문을 또 두지 않는다', () => {
  assert.doesNotMatch(read(`${AI_DIR}/analyze/page.tsx`), /label: '내 분석 문서'/)
})

test('★ 모델 화면은 모달과 같은 창구를 쓴다 — 두 벌로 읽으면 상태가 갈린다', () => {
  const src = read(`${AI_DIR}/models/ModelsClient.tsx`)
  assert.match(src, /listModelCatalog/)
  assert.match(src, /refreshModelCatalog/)
})

// ── 같은 종류의 자리는 같은 모양이어야 한다 ──
//
// 서비스 묶음에 줄만 추가하고 **그림표를 안 고쳐서** AI 스튜디오만 아이콘 없이 그려졌다
// (실측 v0.7.716, 사용자가 화면을 보고 잡았다). 빈 그림은 오류처럼 보이지 않아 정적 검사가
// 전부 초록인 채로 지나간다. 그래서 여기서 센다 — 셋을 나란히 두고 하나라도 비면 실패다.

test('★ 서비스 셋이 사이드바에서 전부 아이콘을 갖는다 — 하나만 비면 그 서비스가 미완처럼 보인다', () => {
  const src = read(MEMBER_LAYOUT)
  const map = src.slice(src.indexOf('const SERVICE_ICON'), src.indexOf('const NAV_GROUPS'))
  for (const s of SERVICE_NAV) {
    assert.match(map, new RegExp(`'${s.href}':\\s*<`), `${s.label} 의 아이콘이 없다`)
  }
})

test('★ 그림표 키가 서비스 표에 묶여 있다 — 다음 서비스는 타입이 먼저 잡는다', () => {
  assert.match(read(MEMBER_LAYOUT), /Record<ServiceHref, React\.ReactNode>/)
})

test('★ 전체 메뉴에도 같은 문이 있다 — 사이드바에만 있으면 찾는 길이 한 벌뿐이다', () => {
  const src = read('components/ui/QuickNav.tsx')
  for (const s of SERVICE_NAV) {
    assert.match(src, new RegExp(`href: '${s.href}'`), `${s.label} 이 전체 메뉴에 없다`)
  }
})

// ── claude.ai 클론: 자리와 방식이 규정이다 ──
//
// 사용자가 두 번 지적했다("새 대화는 메뉴쪽에", "모델 선택하는 방법도 클론해야지").
// 색은 테마가, 자리는 여기가 잠근다.

test('★ 새 대화는 사이드바 메뉴에 있다 — 목록 판에 두면 「할 수 있는 것」과 「한 것」이 섞인다', () => {
  assert.match(read(LAYOUT), /sidebarTop=\{<NewChatButton \/>\}/)
  assert.doesNotMatch(read(`${AI_DIR}/ConversationSidebar.tsx`), /onNewChat/)
})

test('★ 새 대화는 이미 /ai 에 있어도 동작한다 — 주소만 바꾸면 아무 일도 안 일어난다', () => {
  const src = read('app/(ai)/NewChatButton.tsx')
  assert.match(src, /NEW_CHAT_EVENT/)
  assert.match(read(`${AI_DIR}/AiChatClient.tsx`), /addEventListener\(NEW_CHAT_EVENT/)
})

test('★ 모델은 입력칸 안에서 고른다 — 대화 중 모델 교체가 전면 모달을 띄울 일이 아니다', () => {
  const composer = read(`${AI_DIR}/Composer.tsx`)
  assert.match(composer, /<ModelMenu/)
  assert.doesNotMatch(read(`${AI_DIR}/AiChatClient.tsx`), /ModelPickerModal/)
})

test('★ 모델 드롭다운은 화면과 같은 창구를 쓴다 — 두 벌로 읽으면 상태가 갈린다', () => {
  assert.match(read(`${AI_DIR}/ModelMenu.tsx`), /listModelCatalog/)
})

test('★ 표면이 테마를 고정하지 않는다 — 색은 사용자가 고른 테마가 정한다', () => {
  // 두 번 틀린 자리다: CSS 모듈에 색을 박았고, 그다음엔 테마를 표면에 고정했다.
  // 둘 다 결과가 같았다 — 이 화면에서만 테마 선택이 죽는다.
  assert.doesNotMatch(read(LAYOUT), /surfaceTheme=/)
})

test('★ 클론한 것은 배치다 — 스킨에 색이 한 줄도 없어야 한다', () => {
  const skin = read('app/(ai)/studio.module.css')
  // 토큰을 **읽는** 것(var(--…))은 테마를 따라가는 것이라 괜찮다.
  // 토큰을 **정의**하는 것(--…:)이 테마를 이기는 짓이다.
  assert.doesNotMatch(skin, /^\s*--[\w-]+\s*:/m, '스킨이 토큰을 다시 정의하고 있다')
})
