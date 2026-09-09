/**
 * RFP 서비스 등재 가드
 *
 * ## 왜 이 파일이 생겼나
 *
 * 이 저장소가 반복해 온 사고는 **「만들어 놓고 안 꽂는 것」**이다 —
 * AI 채팅은 화면 6개·코드 2만 줄인데 사이드바 한 줄로 살았고,
 * 서비스를 등재하고 아이콘을 빠뜨려 그 줄만 그림 없이 그려졌다.
 *
 * RFP 분석기는 표 43개·라우트 15개짜리 서비스다. 등재를 빠뜨리면
 * **있는 줄도 모르는 기능**이 된다. 그래서 다섯 자리를 여기서 잠근다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { SERVICE_LABEL } from '../terms/entity.ts'
import { NAV_LABEL, SERVICE_NAV } from '../nav/menu.ts'
import { RFP_NAV_GROUPS, rfpNavFor, rfpNavMatchPaths } from './nav/groups.ts'
import { RFP_SERVICE_LABEL } from './terms.ts'

const WEB = join(import.meta.dirname, '..', '..')
const read = (p: string) => readFileSync(join(WEB, p), 'utf8')

// 다섯 자리 등재

test('★ 서비스 이름이 등재돼 있다 — 로고 자리에 「지금 어느 서비스인가」가 뜬다', () => {
  assert.equal(SERVICE_LABEL.rfp, 'RFP 분석기')
  // 서비스 이름과 화면 안 이름이 같아야 한다 — 두 이름이면 두 기능인 줄 안다
  assert.equal(RFP_SERVICE_LABEL, SERVICE_LABEL.rfp)
})

test('★ 경로가 서비스로 잡힌다 — /rfp 가 업무 워크스페이스로 읽히면 안 된다', () => {
  const src = read('lib/nav/surface.ts')
  assert.match(src, /\{ key: 'rfp', prefixes: \['\/rfp'\] \}/)
  assert.match(src, /rfp: '\/rfp'/)
})

test('★ 메뉴 이름이 간판과 같다', () => {
  assert.equal(NAV_LABEL['/rfp'], SERVICE_LABEL.rfp)
})

test('★ 「서비스」 그룹에 들어 있다 — 전체 메뉴와 사이드바가 같은 표를 읽는다', () => {
  assert.ok(SERVICE_NAV.some((s) => s.href === '/rfp'), 'SERVICE_NAV 에 /rfp 가 없다')
})

test('★ 사이드바와 전체 메뉴에 그림이 있다 — 빈 그림은 오류처럼 보이지도 않는다', () => {
  // 실측 v0.7.716: AI 스튜디오만 그림이 비어 있었고 사람이 화면을 봐야 잡혔다
  assert.match(read('app/(member)/layout.tsx'), /'\/rfp': <\w+ size=\{16\} \/>/)
  assert.match(read('components/ui/QuickNav.tsx'), /href: '\/rfp'/)
})

// 화면이 실제로 있다

test('★ 등재한 경로에 화면이 있다 — 링크가 404 로 가면 등재가 거짓말이다', () => {
  const pages = [
    'app/(rfp)/layout.tsx',
    'app/(rfp)/rfp/page.tsx',
    'app/(rfp)/rfp/new/page.tsx',
    'app/(rfp)/rfp/[id]/page.tsx',
    'app/(rfp)/rfp/radar/page.tsx',
    'app/(rfp)/rfp/profile/page.tsx',
    'app/(rfp)/rfp/assistant/page.tsx',
    'app/(rfp)/rfp/admin/page.tsx',
  ]
  const missing = pages.filter((p) => !existsSync(join(WEB, p)))
  assert.deepEqual(missing, [], `등재했는데 화면이 없다: ${missing.join(', ')}`)
})

test('★ 메뉴의 모든 자리에 화면이 있다', () => {
  const missing: string[] = []
  for (const g of RFP_NAV_GROUPS) {
    for (const it of g.items) {
      const rel = it.href.replace(/^\/rfp\/?/, '')
      const p = rel ? `app/(rfp)/rfp/${rel}/page.tsx` : 'app/(rfp)/rfp/page.tsx'
      if (!existsSync(join(WEB, p))) missing.push(`${it.href} → ${p}`)
    }
  }
  assert.deepEqual(missing, [], `메뉴에 있는데 화면이 없다:\n  ${missing.join('\n  ')}`)
})

test('★ 관리자 전용 자리는 관리자에게만 보인다', () => {
  const memberHrefs = rfpNavFor(false).flatMap((g) => g.items.map((i) => i.href))
  const adminHrefs = rfpNavFor(true).flatMap((g) => g.items.map((i) => i.href))
  assert.equal(memberHrefs.includes('/rfp/admin'), false, '구성원에게 설정이 보인다')
  assert.ok(adminHrefs.includes('/rfp/admin'))
})

test('메뉴 자리마다 켜질 경로가 자기 주소를 포함한다', () => {
  for (const g of RFP_NAV_GROUPS) {
    for (const it of g.items) {
      assert.equal(rfpNavMatchPaths(it)[0], it.href, `${it.href} 가 자기 주소를 안 든다`)
    }
  }
})

// 게이트

test('★ 서비스 레이아웃이 api_user 를 막는다', () => {
  const layout = read('app/(rfp)/layout.tsx')
  assert.match(layout, /redirectApiUser\(/)
  // 임직원만 — 이 두 줄이 없으면 로그인만 하면 누구나 본다
  assert.match(layout, /role !== 'admin' && profile\?\.role !== 'member'/)
})

test('★ 게이트 목록에 등재돼 있다', () => {
  assert.match(read('lib/auth/api-user-gate.test.ts'), /'app\/\(rfp\)\/layout\.tsx'/)
})

test('★ 관리자 화면이 저장소 SSOT 로 판정한다', () => {
  // 화면마다 각자 판정하면 한 곳만 느슨해진다
  assert.match(read('app/(rfp)/rfp/admin/page.tsx'), /await requireAdmin\(\)/)
})

// 테스트 등재

test('★ RFP 테스트가 전부 등재돼 있다 — 등재 안 된 테스트는 안 돈다', () => {
  const pkg = JSON.parse(read('package.json')) as { scripts: { test: string } }
  const registered = pkg.scripts.test
  const expected = [
    'lib/rfp/domain/domain.test.ts',
    'lib/rfp/ir/ir.test.ts',
    'lib/rfp/parse/hwp.test.ts',
    'lib/rfp/parse/office.test.ts',
    'lib/rfp/parse/image-text.test.ts',
    'lib/rfp/parse/bundle.test.ts',
    'lib/rfp/parse/quality.test.ts',
    'lib/rfp/structure/sections.test.ts',
    'lib/rfp/structure/requirements.test.ts',
    'lib/rfp/jobs/queue.test.ts',
    'lib/rfp/index/chunk.test.ts',
    'lib/rfp/ai/gateway.test.ts',
    'lib/rfp/ai/self-hosted.test.ts',
    'lib/rfp/report/report.test.ts',
    'lib/rfp/report/grounding.test.ts',
    'lib/rfp/anomaly/anomaly.test.ts',
    'lib/rfp/anomaly/merge.test.ts',
    'lib/rfp/fit/assess.test.ts',
    'lib/rfp/fit/draft.test.ts',
    'lib/rfp/analyze/run-base.test.ts',
    'lib/rfp/cross/consensus.test.ts',
    'lib/rfp/compare/compare.test.ts',
    'lib/rfp/assistant/assistant.test.ts',
    'lib/rfp/g2b/g2b.test.ts',
    'lib/rfp/g2b/award.test.ts',
    'lib/rfp/learn/calibrate.test.ts',
    'lib/rfp/radar/sweep.test.ts',
    'lib/rfp/notify/notify.test.ts',
    'lib/rfp/proposal/outline.test.ts',
    'lib/rfp/revision/diff.test.ts',
    'lib/rfp/tenant/tenant.test.ts',
    'lib/rfp/export/export.test.ts',
    'lib/rfp/rfp-guard.test.ts',
  ]
  const missing = expected.filter((t) => !registered.includes(`"${t}"`))
  // 실패 0 과 안 도는 것이 화면에서 똑같이 보인다
  assert.deepEqual(missing, [], `등재 안 된 테스트:\n  ${missing.join('\n  ')}`)
})
