// 설정 화면 동일성 가드
//
// 관리자와 콘텐츠 인텔리전스와 영업 CRM 은 같은 「설정」인데 카드 두께도 배지 색도 달랐다.
// 셋을 공용 부품으로 옮긴 뒤, 다시 갈라지는 것을 막는 것이 이 파일이다.
//
// 갈라지는 방식은 늘 같았다 — 새 카드를 만들 때 옆 화면을 안 보고 자기 마크업을 그린다.
// 그래서 「부품을 쓰는가」가 아니라 「자기 껍데기를 그리지 않는가」를 본다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (f: string) => readFileSync(f, 'utf8')
const rel = (f: string) => relative(WEB, f)

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx$/.test(name)) out.push(p)
  }
  return out
}

/** 세 설정 화면. 하나라도 경로가 바뀌면 여기서 먼저 걸린다 */
const SETTINGS_DIRS = [
  join(WEB, 'app', 'admin', 'settings'),
  join(WEB, 'app', '(ci)', 'ci', 'settings'),
  join(WEB, 'app', '(crm)', 'crm', 'settings'),
]

const SETTINGS_FILES = SETTINGS_DIRS.flatMap((d) => walk(d))
const SHARED_DIR = join(WEB, 'components', 'ui', 'settings')

test('세 설정 화면이 전부 자리에 있다 — 경로가 바뀌면 아래 단정이 조용히 0건이 된다', () => {
  for (const d of SETTINGS_DIRS) {
    assert.ok(walk(d).length > 0, `${rel(d)} 에 화면 파일이 없다. 경로가 바뀌었나`)
  }
  assert.ok(SETTINGS_FILES.length > 20, `훑은 설정 화면이 ${SETTINGS_FILES.length}개뿐이다`)
})

test('세 설정 화면이 전부 공용 설정 부품을 쓴다', () => {
  for (const d of SETTINGS_DIRS) {
    const uses = walk(d).some((f) => /@\/components\/ui\/settings\//.test(read(f)))
    assert.ok(uses, `${rel(d)} 가 공용 설정 부품을 하나도 안 쓴다`)
  }
})

test('설정 화면이 카드 껍데기를 자기 마크업으로 다시 그리지 않는다', () => {
  // `card` 클래스를 직접 붙이고 여백을 인라인으로 주던 것이 세 화면이 갈린 원인이다
  const offenders = SETTINGS_FILES
    .filter((f) => /className=(\{`card |"card")/.test(read(f)))
    .map(rel)
  assert.deepEqual(offenders, [],
    `설정 화면이 카드 껍데기를 자기 마크업으로 그린다(SettingsCard 를 쓸 것): ${offenders.join(', ')}`)
})

test('설정 화면이 상태 색을 인라인으로 칠하지 않는다', () => {
  // 뜻을 고르는 것은 화면, 색을 고르는 것은 StatusPill 이다.
  // 화면이 칠하기 시작하면 같은 「연결됨」이 화면마다 다른 초록이 된다.
  const offenders = SETTINGS_FILES
    .filter((f) => !f.startsWith(SHARED_DIR))
    .filter((f) => /(backgroundColor|background):\s*(`|')?var\(--(success|warning|danger|info)-bg\)/.test(read(f)))
    .map(rel)
  assert.deepEqual(offenders, [],
    `설정 화면이 상태 색을 인라인으로 칠한다(StatusPill 을 쓸 것): ${offenders.join(', ')}`)
})

test('연결 상태 용어를 화면 파일에 직접 적지 않는다', () => {
  // 「연결됨」「연결 안 됨」「연결 해제」는 integration-ui 의 LABEL 에서만 온다.
  // 화면이 직접 적으면 어떤 카드는 「삭제」, 어떤 카드는 「연결 끊기」가 된다.
  const TERMS = /['"`>](연결됨|연결 안 됨|연결 해제|연결 끊기|헬스체크)['"`<]/
  const allowed = new Set(['app/admin/settings/integration-ui.tsx'])
  const offenders = SETTINGS_FILES
    .filter((f) => !allowed.has(rel(f)))
    .filter((f) => TERMS.test(read(f)))
    .map(rel)
  assert.deepEqual(offenders, [],
    `연결 상태 용어를 화면이 직접 적는다(integration-ui 의 LABEL 을 쓸 것): ${offenders.join(', ')}`)
})

test('공용 설정 부품이 전부 있다', () => {
  const parts = readdirSync(SHARED_DIR).filter((f) => f.endsWith('.tsx')).sort()
  assert.deepEqual(parts, [
    'FieldNote.tsx', 'SettingsCard.tsx', 'SettingsPanel.tsx', 'SettingsRow.tsx',
    'SettingsToggle.tsx', 'StatusPill.tsx',
  ], '공용 설정 부품 목록이 달라졌다')
})
