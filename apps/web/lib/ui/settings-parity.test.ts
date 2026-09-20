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
    'FieldNote.tsx', 'SettingsCard.tsx', 'SettingsCards.tsx', 'SettingsPanel.tsx',
    'SettingsRow.tsx', 'SettingsToggle.tsx', 'StatusPill.tsx',
  ], '공용 설정 부품 목록이 달라졌다')
})

/*
  설정 칸의 단추가 **늘 「저장」이면 안 된다** (사용자 지적 2026-09-20:
  *"방금 상호 넣고 저장 눌렀으면 저장이라는 버튼이 아니라 수정이 되던가 해야지"*).

  늘 같은 글자면 두 가지를 못 말한다 — 눌렀던 것이 먹었는지, 지금 누르면 무슨 일이 나는지.
  누른 뒤에도 글자가 그대로라 사람은 안 먹었다고 읽고 다시 누른다.
  말은 `lib/terms/action.ts` 의 `SETTING_SAVE_LABEL` 이 정한다.
*/

/**
 * 이 규칙 밖인 카드 — **사유를 적어야 들어온다.**
 *
 * 저장된 값을 «고치는» 칸이 아니라 **새로 만드는 폼**이면 「수정」도 「저장됨」도 틀린 말이다.
 */
const NOT_STORED_FIELD: readonly { file: string; why: string }[] = [
  { file: 'app/(crm)/crm/settings/AutomationCard.tsx',
    why: '규칙 목록을 통째로 저장하는 카드라 칸 하나의 «저장됨» 상태가 없다' },
  { file: 'app/(crm)/crm/settings/BusinessTypeCard.tsx',
    why: '사업 유형을 새로 만들고 지우는 목록 편집기다' },
  { file: 'app/(crm)/crm/settings/PipelineCard.tsx',
    why: '파이프라인과 단계를 새로 만들고 지우는 목록 편집기다' },
  { file: 'app/(crm)/crm/settings/QuoteTermsCard.tsx',
    why: 'draft 가 새 조건을 만드는 폼이다 — 아직 저장된 적 없는 값이라 「수정」이 틀린 말이 된다' },
]

/**
 * 저장 단추 **한 덩어리**를 잘라 낸다 — `<NbButton …>` 부터 짝이 맞는 `</NbButton>` 까지.
 *
 * **파일 전체에서 이름을 찾으면 안 된다.** import 줄만 남아도 통과해 버린다 —
 * 실제로 이 가드를 일부러 깨 봤을 때 그래서 안 걸렸다.
 * 값이 그 단추의 글자 자리까지 가는지를 본다.
 */
function saveButtonBodies(src: string): string[] {
  const out: string[] = []
  const flat = src
  let i = 0
  while (true) {
    const open = flat.indexOf('<NbButton', i)
    if (open < 0) break
    const close = flat.indexOf('</NbButton>', open)
    if (close < 0) break
    const body = flat.slice(open, close)
    if (/onClick=\{\(\) => void save\(/.test(body.replace(/\s+/g, ' '))) out.push(body)
    i = close + 1
  }
  return out
}

test('★ 저장된 값을 고치는 설정 단추는 칸의 상태를 말한다 — 늘 「저장」이면 안 된다', () => {
  const skip = new Set(NOT_STORED_FIELD.map((x) => x.file))
  const offenders = SETTINGS_FILES
    .map((f) => ({ rel: f.slice(WEB.length + 1), bodies: saveButtonBodies(read(f)) }))
    .filter((x) => x.bodies.length > 0 && !skip.has(x.rel))
    .filter((x) => !x.bodies.every((b) => b.includes('SETTING_SAVE_LABEL')))
    .map((x) => x.rel)

  assert.deepEqual(offenders, [],
    '설정 저장 단추가 상태와 무관하게 같은 말을 한다. lib/terms 의 SETTING_SAVE_LABEL 을 쓰라:\n'
    + offenders.join('\n'))
})

test('★ 예외마다 사유가 적혀 있고, 그 파일이 실재한다', () => {
  for (const x of NOT_STORED_FIELD) {
    assert.ok(x.why.length > 15, `${x.file} 에 사유가 없다`)
    assert.ok(SETTINGS_FILES.some((f) => f.endsWith(x.file.replace(/^app\//, 'app/'))),
      `예외가 없는 파일을 가리킨다: ${x.file}`)
  }
})
