// 설정 화면 동일성 가드
//
// 관리자와 콘텐츠 인텔리전스와 영업 CRM 은 같은 「설정」인데 카드 두께도 배지 색도 달랐다.
// 셋을 공용 부품으로 옮긴 뒤, 다시 갈라지는 것을 막는 것이 이 파일이다.
//
// 갈라지는 방식은 늘 같았다 — 새 카드를 만들 때 옆 화면을 안 보고 자기 마크업을 그린다.
// 그래서 「부품을 쓰는가」가 아니라 「자기 껍데기를 그리지 않는가」를 본다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
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

/**
 * 설정 화면이 어디인가 — **손으로 적지 않는다.**
 *
 * 예전엔 디렉터리 셋을 적어 뒀다. 그래서 RFP 관리자가 같은 설정 화면인데도
 * 아래 단정 어디에도 안 걸렸고, 자기 카드 껍데기를 그대로 그리고 있었다(실측 2026-09-20).
 * 목록에 없는 화면은 가드가 있는 줄도 모른다.
 *
 * 이제 **공용 설정 부품을 쓰는 파일**이 설정 화면이다. 새 설정 화면을 만들면
 * 부품을 쓰는 순간 여기 목록에 들어온다 — 누가 적어 넣지 않아도 된다.
 */
const SHARED_DIR = join(WEB, 'components', 'ui', 'settings')
const USES_SHARED = /@\/components\/ui\/settings\//

/** 설정 화면이 사는 곳. 부품 자신은 빼고 훑는다 */
const SCAN_ROOTS = [join(WEB, 'app'), join(WEB, 'components')]

const SETTINGS_FILES = SCAN_ROOTS
  .flatMap((d) => walk(d))
  .filter((f) => !f.startsWith(SHARED_DIR))
  .filter((f) => USES_SHARED.test(read(f)))

/** 화면이 자기 격자를 짤 때 쓰는 말 — CSS 와 인라인 style 둘 다 */
const OWN_GRID = /grid-template-columns|gridTemplateColumns/
/** 카드를 옆 카드 높이에 맞춰 늘리는 말 */
const STRETCH = /align-items:\s*stretch|alignItems:\s*['"`]stretch/

test('설정 화면 목록이 스스로 찬다 — RFP 관리자처럼 나중에 생긴 화면도 들어온다', () => {
  assert.ok(SETTINGS_FILES.length > 10, `훑은 설정 화면이 ${SETTINGS_FILES.length}개뿐이다. 부품 경로가 바뀌었나`)

  // 화면 넷이 전부 걸려 있어야 한다. 하나라도 빠지면 그 화면만 조용히 갈린다
  const musts = [
    'app/admin/settings', 'app/(ci)/ci/settings', 'app/(crm)/crm/settings',
    'app/(rfp)/rfp/admin', 'components/rfp',
  ]
  const missing = musts.filter((m) => !SETTINGS_FILES.some((f) => rel(f).startsWith(m)))
  assert.deepEqual(missing, [], `설정 화면인데 목록에 없다(공용 부품을 안 쓴다): ${missing.join(', ')}`)
})

/**
 * 설정 **페이지** 넷. 카드가 아니라 카드를 담는 자리다.
 *
 * 위 목록(SETTINGS_FILES)은 부품을 쓰는 파일이 스스로 찬다. 그래서 카드가 갈리는 것은 잡지만
 * **그릇이 갈리는 것은 못 잡았다** — 관리자 설정은 카드를 전부 공용 부품으로 그리면서도
 * 자기 탭 묶음을 직접 짜고 있었고, 그 화면에만 검색 칸이 없었다(사용자 지적 2026-09-22).
 *
 * 페이지는 스스로 안 찬다. 「여기가 설정 페이지다」를 아는 것은 사람뿐이라 손으로 적는다 —
 * 다섯째 설정 화면을 만들면 여기 한 줄을 더해야 하고, 안 더하면 그 화면만 조용히 갈린다.
 */
const SETTINGS_PAGES = [
  'app/admin/settings/page.tsx',
  'app/(ci)/ci/settings/SettingsView.tsx',
  'app/(crm)/crm/settings/page.tsx',
  'app/(rfp)/rfp/admin/page.tsx',
]

test('★ 설정 페이지 넷이 전부 공용 그릇에 담는다 — 검색 칸과 분류 탭이 화면마다 갈리지 않게', () => {
  const missing = SETTINGS_PAGES.filter((rel) => {
    const f = join(WEB, rel)
    if (!existsSync(f)) return true
    const src = read(f)
    return !/<Settings(Cards|Panel)\b/.test(src)
  })
  assert.deepEqual(missing, [],
    '설정 페이지가 공용 그릇(SettingsCards·SettingsPanel)에 안 담는다. '
    + '자기 탭 묶음을 짜면 그 화면만 검색 칸이 없어진다:\n' + missing.join('\n'))
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


test('설정 화면이 카드를 자기 격자에 늘어놓지 않는다', () => {
  /*
    화면마다 제 격자를 짜면 열 수도 간격도 갈린다. **카드 배치는** 공용 그릇(SettingsPanel)이 한다.

    카드 «안»의 격자는 여기 걸리지 않는다 — 테마 고르기 칸처럼 카드 하나 안에서 내용을
    늘어놓는 격자는 배치가 아니라 그 카드의 내용이다. 그래서 카드를 둘 이상 그리는
    파일만 본다: 그 격자는 카드를 늘어놓는 격자다.
  */
  const offenders = SETTINGS_FILES
    .filter((f) => (read(f).match(/<SettingsCard/g) ?? []).length > 1)
    .filter((f) => OWN_GRID.test(read(f)))
    .map(rel)
  assert.deepEqual(offenders, [],
    `설정 화면이 카드를 자기 격자에 늘어놓는다(SettingsPanel 에 담을 것): ${offenders.join(', ')}`)
})

test('카드를 옆 카드 높이에 맞춰 늘리지 않는다', () => {
  /*
    stretch 는 짧은 카드 아래를 통째로 빈 상자로 만든다 —
    실측 2026-09-20 영업 CRM 설정은 카드 높이 합 11,961px 중 5,263px(44%)이 그 자리였다.
    맞출 것은 시작점이고 늘릴 것은 없다(계측 e2e/settings-whitespace.spec.ts).
  */
  const offenders = SETTINGS_FILES.filter((f) => STRETCH.test(read(f))).map(rel)
  assert.deepEqual(offenders, [],
    `설정 화면이 카드를 늘린다: ${offenders.join(', ')}`)

  /*
    예전에는 여기서 `.settings-grid` 가 다시 stretch 로 늘리는지를 봤다.
    그 격자는 관리자 설정만 쓰던 것이고, 그 화면이 공용 그릇으로 옮겨 오면서 쓰는 곳이 0 이 됐다.
    쓰는 곳이 없는 이름을 CSS 에 남겨 두면 다음 사람이 **지금 써도 되는 이름**인 줄 안다 —
    그러면 카드 배치가 다시 화면마다 갈린다(걷어 낸 자리를 지키는 것이 이 줄이다).
  */
  const css = read(join(WEB, 'app', 'globals.css'))
  const revived = ['.settings-grid', '.settings-stack', '.settings-section-head', '.settings-section-desc']
    .filter((name) => css.includes(`${name} {`) || css.includes(`${name},`))
  assert.deepEqual(revived, [],
    `걷어 낸 옛 배치 규칙이 CSS 에 돌아왔다(배치는 SettingsPanel 이 한다): ${revived.join(', ')}`)
})
