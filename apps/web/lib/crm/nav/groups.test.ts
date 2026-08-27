// lib/crm/nav/groups.test.ts — CRM 메뉴 묶음 계약
//
// 왜 이 가드가 있나: 사이드바를 13개에서 5개로 줄이면서 **화면은 하나도 안 없앴다.**
// 그래서 «묶음에 등재되지 않은 화면»이 생기면 그 화면은 **사이드바에서도 탭에서도
// 갈 수 없는 곳**이 된다 — 라우트는 살아 있는데 아무도 못 찾는 상태다.
// 새 CRM 화면을 만들 때 이 가드가 등재를 강제한다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  CRM_NAV_GROUPS, CRM_ACCOUNT_ITEMS, crmGroupOf, crmGroupMatchPaths,
} from './groups.ts'

const CRM_DIR = join(process.cwd(), 'app/(crm)/crm')

/**
 * 묶음에도 계정 메뉴에도 없어도 되는 화면.
 *
 * **이유 없이 늘리면 가드가 무력해진다** — 빠뜨린 화면과 일부러 뺀 화면이 구분되지 않는다.
 */
const NOT_IN_NAV: Record<string, string> = {
  search: '검색 결과 — 상단 검색창으로만 들어간다. 메뉴에 둘 화면이 아니다',
  onboarding: '처음 한 번만 지나가는 화면',
}

function screenRoutes(): string[] {
  if (!existsSync(CRM_DIR)) return []
  return readdirSync(CRM_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('[') && !d.name.startsWith('_'))
    .filter((d) => existsSync(join(CRM_DIR, d.name, 'page.tsx')))
    .map((d) => d.name)
}

test('★ 스캐너가 실제로 동작한다 — 지표가 틀리면 이 가드 전체가 거짓말이 된다', () => {
  const routes = screenRoutes()
  assert.ok(routes.length >= 10, `CRM 화면을 ${routes.length}개밖에 못 찾았다 — 스캔 경로가 깨졌다`)
  assert.ok(routes.includes('companies'), '회사 화면을 못 봤다')
})

test('★ 모든 CRM 화면은 묶음이나 계정 메뉴에 등재돼 있다 — 안 그러면 갈 길이 없다', () => {
  const inNav = new Set<string>([
    ...CRM_NAV_GROUPS.flatMap((g) => g.tabs.map((t) => t.href)),
    ...CRM_ACCOUNT_ITEMS.map((i) => i.href),
    '/crm/settings', '/crm/process', '/crm/members',
  ])
  const orphans = screenRoutes()
    .filter((r) => !NOT_IN_NAV[r])
    .filter((r) => !inNav.has(`/crm/${r}`))
  assert.deepEqual(orphans, [],
    '이 화면들이 어느 묶음에도 없다. lib/crm/nav/groups.ts 에 등재하거나 NOT_IN_NAV 에 이유와 함께 적을 것')
})

test('★ 사이드바는 다섯 자리다 — 늘리려면 무엇을 뺄지 먼저 정해야 한다', () => {
  assert.equal(CRM_NAV_GROUPS.length, 5,
    `묶음이 ${CRM_NAV_GROUPS.length}개다. 13개였던 것을 5개로 줄인 것이 이 구조의 목적이다`)
})

test('묶음 이름과 항목 이름이 같으면 그 묶음은 없앤다 (§2-3-3 N-3)', () => {
  for (const g of CRM_NAV_GROUPS) {
    if (g.tabs.length === 1) {
      assert.equal(g.tabs[0].label, g.label,
        `${g.label}: 항목이 하나면 묶음 이름과 같아야 한다 — 다르면 이름이 둘이 된다`)
    }
  }
})

test('같은 경로가 두 묶음에 들어가지 않는다 — 어느 자리가 켜질지 정해지지 않는다', () => {
  const seen = new Map<string, string>()
  for (const g of CRM_NAV_GROUPS) {
    for (const t of g.tabs) {
      const prev = seen.get(t.href)
      assert.equal(prev, undefined, `${t.href} 가 「${prev}」와 「${g.label}」 둘에 있다`)
      seen.set(t.href, g.label)
    }
  }
})

test('묶음의 대표 경로는 첫 탭이다 — 눌렀을 때 빈 화면이 뜨면 안 된다', () => {
  for (const g of CRM_NAV_GROUPS) {
    assert.equal(g.href, g.tabs[0].href, `${g.label}: 대표 경로가 첫 탭과 다르다`)
  }
})

test('crmGroupOf 는 상세 경로도 목록과 같은 묶음으로 본다', () => {
  assert.equal(crmGroupOf('/crm/companies/abc-123')?.label, '거래처')
  assert.equal(crmGroupOf('/crm/quotes')?.label, '딜')
  assert.equal(crmGroupOf('/crm/audit')?.label, '기록')
  assert.equal(crmGroupOf('/crm/nowhere'), null)
})

test('설정 3개는 사이드바가 아니라 계정 메뉴에 있다', () => {
  const sidebar = new Set(CRM_NAV_GROUPS.flatMap(crmGroupMatchPaths))
  for (const it of CRM_ACCOUNT_ITEMS) {
    assert.ok(!sidebar.has(it.href),
      `${it.label} 이 사이드바에도 있다 — 같은 곳으로 가는 문이 둘이면 다른 곳으로 읽힌다`)
  }
})
