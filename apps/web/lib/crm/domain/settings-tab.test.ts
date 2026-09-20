// 영업 CRM 설정 분류 가드
//
// 카드가 늘 때 분류를 안 적으면 그 카드는 **어느 탭에서도 안 보인다.**
// 화면은 멀쩡히 그려지고 오류도 안 나므로, 세는 것 말고는 알아낼 길이 없다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  CRM_SETTINGS_CARDS, CRM_SETTINGS_TAB, CRM_SETTINGS_TAB_ORDER,
  type CrmSettingsTabKey,
} from './settings-tab.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const PAGE = join(WEB, 'app', '(crm)', 'crm', 'settings', 'page.tsx')

test('카드 열네 장이 저마다 한 탭에 정확히 한 번씩 들어간다', () => {
  assert.equal(CRM_SETTINGS_CARDS.length, 14, '카드 수가 달라졌다. 화면과 목록을 함께 고쳤나')

  const seen = new Map<string, number>()
  for (const c of CRM_SETTINGS_CARDS) seen.set(c.id, (seen.get(c.id) ?? 0) + 1)
  const twice = [...seen].filter(([, n]) => n > 1).map(([id]) => id)
  assert.deepEqual(twice, [], `같은 카드가 두 번 들어갔다: ${twice.join(', ')}`)

  const unknown = CRM_SETTINGS_CARDS.filter((c) => !(c.tab in CRM_SETTINGS_TAB)).map((c) => c.id)
  assert.deepEqual(unknown, [], `없는 분류에 넣은 카드: ${unknown.join(', ')}`)
})

test('탭마다 카드가 하나 이상 있다 — 빈 탭은 누르면 아무것도 없다', () => {
  const empty = CRM_SETTINGS_TAB_ORDER.filter((t) => !CRM_SETTINGS_CARDS.some((c) => c.tab === t))
  assert.deepEqual(empty, [], `카드가 하나도 없는 분류: ${empty.join(', ')}`)
})

test('탭 순서 목록과 탭 사전이 같은 것을 가리킨다', () => {
  assert.deepEqual(
    [...CRM_SETTINGS_TAB_ORDER].sort(),
    (Object.keys(CRM_SETTINGS_TAB) as CrmSettingsTabKey[]).sort(),
    '순서 목록에 없는 탭이 있거나, 사전에 없는 탭을 순서가 가리킨다',
  )
})

test('화면이 그리는 카드 부품과 목록이 정확히 같다', () => {
  // 목록에만 있으면 화면에 안 뜨고, 화면에만 있으면 어느 탭에도 안 들어간다.
  // 둘 다 오류를 안 내므로 여기서 세는 것 말고는 알 길이 없다.
  const src = readFileSync(PAGE, 'utf8')
  const imported = [...src.matchAll(/^import (\w+) from '\.\/(\w+)'$/gm)].map((m) => m[1])
  // 부품 하나가 카드 둘을 그릴 수 있다 — 세는 것은 부품 이름이다
  const listed = [...new Set(CRM_SETTINGS_CARDS.map((c) => c.component))]
  assert.equal(listed.length, 12, '부품 수가 달라졌다. 화면과 목록을 함께 고쳤나')

  const onlyScreen = imported.filter((i) => !listed.includes(i))
  const onlyList = listed.filter((i) => !imported.includes(i))
  assert.deepEqual(onlyScreen, [], `화면에만 있는 카드(어느 탭에도 안 들어간다): ${onlyScreen.join(', ')}`)
  assert.deepEqual(onlyList, [], `목록에만 있는 카드(화면에 안 뜬다): ${onlyList.join(', ')}`)
})
