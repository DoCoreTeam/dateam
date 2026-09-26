/**
 * 「많은 것 중에서 하나 고르기」 — **자라는 목록은 드롭다운으로 두지 않는다**
 *
 * **왜** (`components/ui/RecordPicker.tsx` 머리말의 실측): 회사·딜처럼 **개수가 자라는**
 *   목록을 native `<select>` 로 두면 항목이 는 만큼 목록도 그대로 길어져 화면 밖으로
 *   넘친다. 검색이 없으니 눈으로 훑는 것 말고는 찾을 방법이 없다
 *   (사용자 지적 「이걸 어떻게 쓰니?」). 더 나쁜 것은 호출부가 전부 `?limit=100` 이라
 *   101번째는 화면에 **아예 없었고** 없다는 사실조차 어디에도 안 적혀 있던 것이다.
 *
 * 그 부품(`RecordPickerField`)은 그때 만들어졌고, 머리말에 「그 판정은
 * `lib/ui/picker-standard.test.ts` 가 지킨다」라고 적혀 있었다. **그 파일이 없었다.**
 * 규칙을 글로만 두면 안 지켜진다 — 새 화면은 그 뒤로도 계속 `<select>` 로 되돌아갔다.
 *
 * ## 경계 — 고정 목록에는 쓰지 않는다
 *
 * 통화(4개)·허용/차단(2개)·프리셋(3개)처럼 **선택지가 코드에 박혀 있으면** 드롭다운이
 * 더 빠르고 정확하다. 그래서 이 가드는 「전부 모달로 바꿔라」가 아니라
 * **「왜 드롭다운인지 적어라」** 다. 적지 않은 자리만 잡는다.
 *
 * ## 왜 한 번에 다 안 막나
 *
 * 지금 자리가 113곳이다. 즉시 차단으로 걸면 `pnpm test` 가 통째로 빨개져 아무 일도
 * 못 한다(용어집 가드가 21곳에서 겪은 것과 같은 상황이다). 그래서 **「지금보다 늘면 차단」**
 * 으로 건다. 다만 접근권한 화면은 이 판에서 실제로 옮겼으므로 그 화면만 **0 으로** 건다 —
 * 옮긴 자리가 되돌아가는 것은 막아야 한다.
 *
 * 기준값은 파일 밖에 안 둔다. 용어집 가드는 baseline 을 파일로 두고 자동 하향했는데,
 * cwd 가 다른 데서 한 번 돌자 **0 을 기준으로 저장해 통째로 비웠다**(실측 2026-08-31).
 * 여기서는 사람이 줄인 만큼 이 숫자를 내린다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const WEB = join(import.meta.dirname, '..', '..')

/**
 * 지금 남아 있는 「사유 없는 드롭다운」 자리 수. **늘면 실패한다.**
 * 줄이면 이 숫자를 그만큼 내린다 — 내리지 않으면 되돌아가도 안 걸린다.
 */
const BASELINE = 109

/** 접근권한 화면은 이 판에서 옮겼다. 여기만 0 으로 건다 */
const CONVERTED = ['app/admin/access/AccessClient.tsx']

/**
 * 드롭다운으로 두는 것이 맞는 자리와 **왜**.
 *
 * 「나중에 옮긴다」는 사유가 아니다 — 그건 위의 기준값이 세는 쪽이다.
 * 여기 적는 것은 **앞으로도 드롭다운일 자리**다.
 */
const WHY_SELECT: Readonly<Record<string, string>> = {
  'app/admin/access/AccessClient.tsx#ACCESS_SUBJECT_ORDER':
    '사람이냐 조직이냐 둘뿐이고 코드에 박혀 있다. 자라지 않는다',
  'app/admin/access/AccessClient.tsx#ACCESS_EFFECT_ORDER':
    '허용과 차단 둘뿐이고 코드에 박혀 있다. 자라지 않는다',
  'app/admin/access/AccessClient.tsx#ACCESS_PRESET_ORDER':
    '보기만·쓰기·내보내기까지 셋뿐이고 코드에 박혀 있다. 자라지 않는다',
  'app/admin/access/AccessClient.tsx#zones':
    '표면 하나에 달린 자리 목록이고 등재부(lib/access/surfaces.ts)가 코드로 정한다. 표면당 많아야 네댓이라 자라지 않는다',
}

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) tsxFiles(full, out)
    else if (full.endsWith('.tsx')) out.push(full)
  }
  return out
}

/**
 * `<select>` 안에서 목록을 펴는 자리를 모은다.
 *
 * **여는 태그만 보지 않는다** — `<select>` 는 있는데 옵션을 손으로 적은 자리는
 * 자라는 목록이 아니다. 목록을 `.map` 으로 펴는 자리만 이 규칙의 대상이다.
 */
function selectSites(): { site: string; file: string; id: string }[] {
  const found: { site: string; file: string; id: string }[] = []
  for (const f of [...tsxFiles(join(WEB, 'app')), ...tsxFiles(join(WEB, 'components'))]) {
    const src = readFileSync(f, 'utf8')
    const rel = relative(WEB, f)
    let i = 0
    while ((i = src.indexOf('<select', i)) > -1) {
      const end = src.indexOf('</select>', i)
      if (end < 0) break
      for (const m of src.slice(i, end).matchAll(/([A-Za-z_$][\w$.]*)\s*\.map\s*\(/g)) {
        const id = m[1]
        found.push({ site: `${rel}#${id}`, file: rel, id })
      }
      i = end
    }
  }
  return found
}

test('드롭다운으로 그리는 목록이 지금보다 늘지 않는다', () => {
  const open = [...new Set(selectSites().map((s) => s.site))].filter((s) => !(s in WHY_SELECT))
  assert.ok(
    open.length <= BASELINE,
    `사유 없는 드롭다운이 ${open.length}곳으로 늘었다(기준 ${BASELINE}). `
      + `자라는 목록이면 RecordPickerField 를 쓰고, 고정 목록이면 WHY_SELECT 에 사유와 함께 적는다:\n  `
      + open.slice(0, 12).join('\n  '),
  )
})

test('옮긴 화면은 되돌아가지 않는다 — 접근권한 화면에 사유 없는 드롭다운이 0곳이다', () => {
  const left = selectSites()
    .filter((s) => CONVERTED.includes(s.file))
    .map((s) => s.site)
    .filter((s) => !(s in WHY_SELECT))
  assert.deepEqual(left, [], `옮긴 화면에 드롭다운이 다시 생겼다:\n  ${left.join('\n  ')}`)
})

test('사람과 조직은 모달로 고른다', () => {
  const src = readFileSync(join(WEB, 'app/admin/access/AccessClient.tsx'), 'utf8')
  assert.match(src, /import RecordPickerField/, '고르기 SSOT 부품을 안 쓴다')

  /**
   * **자리를 짚는다.** 파일 어딘가에 부품이 import 돼 있는 것으로는
   * 그 칸이 실제로 그 부품인지 알 수 없다(소유자 칸만 바꾸고 주체 칸은 그대로일 수 있다).
   */
  assert.match(src, /id=\{`who-\$\{s\.key\}`\}[\s\S]{0,400}?search=\{searchSubjects\}/,
    '주체 칸이 아직 모달 피커가 아니다')
  assert.match(src, /searchSubjects: RecordSearch|const searchSubjects/, '주체 후보를 찾는 자리가 없다')

  /** 그리고 그 칸에 select 가 남아 있으면 안 된다 */
  const whoAt = src.indexOf('id={`who-${s.key}`}')
  const around = src.slice(Math.max(0, whoAt - 400), whoAt + 400)
  assert.doesNotMatch(around, /<select/, '주체 칸에 드롭다운이 남아 있다')
})

test('고른 뒤 사람 수는 예전과 같은 값을 그린다', () => {
  const src = readFileSync(join(WEB, 'app/admin/access/AccessClient.tsx'), 'utf8')
  /**
   * 미리보기 숫자의 출처는 `orgOptions`(actions.ts)가 센 `directCount`·`subtreeCount` 다.
   * 피커로 바꾸면서 화면이 자기 방식으로 다시 세면 관리자가 보는 숫자와
   * 실제로 걸리는 사람 수가 갈린다.
   */
  assert.match(src, /draft\.includeDescendants \? org\.subtreeCount : org\.directCount/,
    '미리보기 숫자를 서버가 센 값으로 안 그린다')
  assert.match(src, /accessPeopleCount\(previewCount\)/, '미리보기 숫자를 안 그린다')
})

test('사유 목록이 죽지 않았다 — 없어진 자리가 남아 있지 않다', () => {
  const sites = new Set(selectSites().map((s) => s.site))
  const stale = Object.keys(WHY_SELECT).filter((s) => !sites.has(s))
  assert.deepEqual(stale, [], `이제 없는 자리가 사유 목록에 남아 있다: ${stale.join(', ')}`)

  for (const [site, why] of Object.entries(WHY_SELECT)) {
    assert.ok(why.length > 15, `${site} 의 사유가 너무 짧다`)
    assert.doesNotMatch(why, /나중에|추후|TODO|예정/, `${site} 의 사유가 「나중에」다 — 그건 기준값이 세는 쪽이다`)
  }
})
