/**
 * 배지 표준 가드 — 숫자 하나가 무엇을 세는지 화면이 말하게 한다 (§0-2 · `lib/terms/badge.ts`)
 *
 * **왜 있나**(사용자 지적 2026-09-09): 사이드바 「업무」에 빨간 `1` 이 떠서 눌렀는데
 * 일일업무 화면이 열렸고, 그 화면 어디에도 그 1건이 없었다. 배지가 세는 것(내가 맡은
 * 미완료 부서 업무)과 도착지(일일업무)가 서로 다른 말을 하고 있었다.
 *
 * 배지는 **열어 보지 않고 판단하라**고 있는 장치다. 뜻을 물어야 알 수 있으면 존재
 * 이유가 사라진다. 그래서 이 가드가 넷을 잠근다:
 *   ① 배지를 다는 화면은 뜻(`badgeTitle`)을 함께 단다
 *   ② 뜻 문장을 화면이 직접 짓지 않는다 — `lib/terms` 에서 가져온다
 *   ③ 배지를 그리는 부품은 그 뜻을 사용자가 볼 수 있는 자리(title·aria-label)에 남긴다
 *   ④ 0이면 배지를 그리지 않는다 — 0을 다른 숫자로 채우지 않는다
 *
 * 만든 뒤 넷을 일부러 깨서 전부 실패를 확인했다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BADGE, badgeTitle, type BadgeKey } from '../terms/index.ts'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

/** 배지를 다는 화면 — 새 배지를 만들면 여기 등재한다 */
const BADGE_SCREENS = [
  '../../app/(member)/layout.tsx',
  '../../app/(crm)/layout.tsx',
  '../../app/(ci)/layout.tsx',
  '../../components/ui/WorkTabBar.tsx',
]

test('★ 배지를 다는 화면은 뜻을 함께 단다 — 숫자만 두면 눌러 보고서야 안다', () => {
  for (const rel of BADGE_SCREENS) {
    const src = read(rel)
    // `badge:` 를 쓰는 줄이 하나라도 있으면, 그 파일은 badgeTitle 도 함께 써야 한다
    const setsBadge = /\bbadge:\s/.test(src)
    assert.ok(setsBadge, `${rel}: 배지를 다는 화면이 아니다 — 목록이 낡았다`)
    assert.match(src, /badgeTitle/, `${rel}: 배지에 뜻이 없다 — 「숫자는 뭐야?」가 다시 나온다`)
  }
})

test('★ 뜻 문장을 화면이 직접 짓지 않는다 — lib/terms 에서 가져온다 (§0-2)', () => {
  for (const rel of BADGE_SCREENS) {
    const src = read(rel)
    assert.match(
      src, /from '@\/lib\/terms'/,
      `${rel}: 화면이 배지 문장을 직접 적으면 같은 배지가 화면마다 다른 말을 한다`,
    )
    // 화면에 한글 문장을 직접 박아 넣지 않는다 — badgeTitle(...) 호출만 허용
    assert.ok(
      !/badgeTitle:\s*['"`][^'"`]*[가-힣]/.test(src),
      `${rel}: 배지 문장을 화면에 직접 적었다 — lib/terms 에 먼저 추가한다`,
    )
  }
})

test('★ 배지를 그리는 부품은 뜻을 사용자가 볼 수 있는 자리에 남긴다', () => {
  // 사이드바 배지
  const nav = read('../../components/ui/nb/NbNavItem.tsx')
  assert.match(nav, /className="nb-nav-badge"[^>]*title=\{badgeTitle\}/s, '사이드바 배지에 title 이 없다')
  assert.match(nav, /aria-label=\{badgeTitle\}/, '낭독기가 숫자만 읽는다 — 「업무 1」로는 뜻을 모른다')

  // 탭 배지
  const tabs = read('../../components/ui/SegmentedTabs.tsx')
  assert.match(tabs, /className="seg-tab-badge"[^>]*title=\{t\.badgeTitle\}/s, '탭 배지에 title 이 없다')
  assert.match(tabs, /aria-label=\{t\.badgeTitle\}/, '탭 배지를 낭독기가 숫자로만 읽는다')
})

test('★ 셀 것이 0이면 배지를 그리지 않는다 — 0을 다른 숫자로 채우지 않는다', () => {
  const nav = read('../../components/ui/nb/NbNavItem.tsx')
  assert.match(nav, /badge != null && badge > 0/, '사이드바가 0을 그린다')

  const tabs = read('../../components/ui/SegmentedTabs.tsx')
  assert.match(tabs, /t\.badge != null && t\.badge > 0/, '탭이 0을 그린다')

  // 조건에 따라 다른 값으로 대체하지 않는다 — 어떤 날은 「밀린 것」, 어떤 날은 「전부」가 된다
  for (const rel of BADGE_SCREENS) {
    assert.ok(
      !/badge:\s*\w+\s*>\s*0\s*\?\s*\w+\s*:\s*\w+/.test(read(rel)),
      `${rel}: 같은 자리의 숫자가 상황에 따라 뜻이 바뀐다`,
    )
  }
})

test('★ 배지가 세는 것과 도착지가 같은 말을 한다 — 「업무」 배지는 그 목록으로 간다', () => {
  const tabs = read('../../components/ui/WorkTabBar.tsx')
  // 배지가 있을 때는 그 N건만 보이는 주소로 보낸다
  assert.match(tabs, /assignee=me/, '배지를 눌러도 내 담당만 보이지 않는다')
  assert.match(tabs, /status=open/, '배지를 눌러도 미완료만 보이지 않는다')
  // 쿼리가 붙은 href 는 경로 비교로 활성 판정을 못 한다 — match 가 있어야 탭 불이 켜진다
  assert.match(tabs, /match: \['\/dept-tasks'\]/, '탭이 활성으로 안 켜진다')

  // 도착 화면이 그 두 조건을 실제로 받는다
  const dept = read('../../app/(member)/dept-tasks/DeptTasksClient.tsx')
  assert.match(dept, /filterKeys: \['status', 'assignee'\]/, '도착 화면이 담당자 조건을 안 읽는다')
  assert.match(dept, /query\.filters\.assignee === 'me'/, '「내 담당」이 목록에 안 걸린다')
  assert.match(dept, /value: 'open', label: '미완료'/, '「미완료」 칩이 없다')
})

test('★ 「미완료」의 정의는 한 곳이다 — 배지가 세는 것과 목록이 보여 주는 것이 갈리면 안 된다', () => {
  const utils = read('../dept-task-utils.ts')
  assert.match(utils, /OPEN_DEPT_TASK_STATUSES/, '미완료 목록 SSOT 가 없다')

  const actions = read('../../app/(member)/dept-tasks/actions.ts')
  assert.ok(
    !/const OPEN_STATUSES/.test(actions),
    '서버가 미완료 목록을 따로 들고 있다 — 두 벌이면 한쪽만 고쳐진다',
  )
  assert.match(actions, /OPEN_DEPT_TASK_STATUSES/, '서버가 SSOT 를 안 쓴다')

  const dept = read('../../app/(member)/dept-tasks/DeptTasksClient.tsx')
  assert.match(dept, /isOpenDeptTaskStatus/, '화면이 미완료 판정을 다시 짰다')
})

test('배지 뜻 문장이 전부 채워져 있다 — 빈 문장은 없느니만 못하다', () => {
  for (const [key, meta] of Object.entries(BADGE)) {
    assert.ok(meta.meaning.trim().length > 0, `${key}: 뜻이 비었다`)
    assert.ok(['건', '곳', '명', '개'].includes(meta.counter), `${key}: 조수사가 넷 밖이다`)
    // 문장이 「무엇을」로 끝나야 사람이 읽는다 — 「미완료 부서 업무 1건」
    assert.match(badgeTitle(key as BadgeKey, 1), /1[건곳명개]$/, `${key}: 개수 표기가 어긋난다`)
  }
})
