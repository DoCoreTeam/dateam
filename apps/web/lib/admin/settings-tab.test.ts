/**
 * 관리자 설정 카드 목록과 화면이 짝이 맞는가
 *
 * **왜**: 목록에 없는 카드를 화면이 그리면 그 카드는 **어느 탭에서도 안 보인다**.
 * 반대로 목록에만 있고 화면이 안 그리면 탭에 빈 자리가 생긴다.
 * 둘 다 조용하다 — 화면은 그려지고 오류도 안 난다. 그래서 여기서 센다.
 *
 * 영업 CRM 의 같은 시험과 같은 자리다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ADMIN_SETTINGS_CARDS, ADMIN_SETTINGS_CARDS_BY_HAND, ADMIN_SETTINGS_TAB,
  ADMIN_SETTINGS_TAB_ORDER, deriveProviderCards, type AdminSettingsTabKey,
} from './settings-tab.ts'
import { AI_PROVIDERS } from '../ai/provider-catalog.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SETTINGS_DIR = join(WEB, 'app', 'admin', 'settings')
const read = (rel: string) => readFileSync(join(SETTINGS_DIR, rel), 'utf8')
const PAGE = read('page.tsx')

/**
 * 화면의 `node` 묶음이 갖는 이름들.
 *
 * **파일 전체에서 이름을 찾으면 안 된다** — import 줄만 남아도 통과해 버린다.
 * 그 묶음 안쪽만 잘라 내고, 거기 적힌 key 만 본다.
 */
function nodeKeys(): string[] {
  const head = 'const node: Record<string, ReactNode> = {'
  const start = PAGE.indexOf(head)
  assert.ok(start >= 0, '화면에서 node 묶음을 못 찾았다. 이름이 바뀌었나')
  const body = PAGE.slice(start + head.length, PAGE.indexOf('\n  }\n', start))
  return [...body.matchAll(/^ {4}(?:'([\w.]+)'|([A-Za-z][\w]*)):/gm)]
    .map((m) => m[1] ?? m[2])
}

/** 공급자 카드는 손으로 안 적고 펼침으로 들어온다 — 그 자리가 살아 있는지 따로 본다 */
const SPREAD = '...Object.fromEntries(AI_PROVIDERS.map('

test('탭 넷이 순서와 이름을 함께 갖는다', () => {
  assert.equal(ADMIN_SETTINGS_TAB_ORDER.length, 4)
  const missing = ADMIN_SETTINGS_TAB_ORDER.filter((t) => !ADMIN_SETTINGS_TAB[t]?.label)
  assert.deepEqual(missing, [], `이름 없는 탭: ${missing.join(', ')}`)
  const orphan = (Object.keys(ADMIN_SETTINGS_TAB) as AdminSettingsTabKey[])
    .filter((t) => !ADMIN_SETTINGS_TAB_ORDER.includes(t))
  assert.deepEqual(orphan, [], `순서에 없는 탭은 화면에 안 선다: ${orphan.join(', ')}`)
})

test('카드마다 이름이 하나뿐이고 탭이 실재한다', () => {
  const ids = ADMIN_SETTINGS_CARDS.map((c) => c.id)
  assert.deepEqual(ids, [...new Set(ids)], '카드 이름이 겹친다 — 뒤엣것이 앞엣것을 덮는다')
  const badTab = ADMIN_SETTINGS_CARDS.filter((c) => !ADMIN_SETTINGS_TAB[c.tab]).map((c) => c.id)
  assert.deepEqual(badTab, [], `없는 탭을 가리키는 카드: ${badTab.join(', ')}`)
})

test('★ 목록의 카드와 화면이 그리는 카드가 정확히 같다', () => {
  const keys = nodeKeys()
  assert.ok(PAGE.includes(SPREAD), '공급자 카드를 명세에서 펼치는 자리가 사라졌다')

  const drawn = new Set([...keys, ...deriveProviderCards(AI_PROVIDERS).map((c) => c.id)])
  const listed = new Set(ADMIN_SETTINGS_CARDS.map((c) => c.id))

  const notDrawn = [...listed].filter((id) => !drawn.has(id))
  assert.deepEqual(notDrawn, [], `목록에만 있고 화면이 안 그린다(탭에 빈 자리가 생긴다): ${notDrawn.join(', ')}`)

  const notListed = [...drawn].filter((id) => !listed.has(id))
  assert.deepEqual(notListed, [], `화면은 그리는데 목록에 없다(어느 탭에서도 안 보인다): ${notListed.join(', ')}`)
})

test('★ 공급자 카드는 명세에서 파생한다 — 여섯째를 넣으면 따라온다', () => {
  // 손으로 적었다면 여기서 안 늘어난다. 늘어나야 「명세에 한 줄」이 사실이 된다
  const sixth = { ...AI_PROVIDERS[0], id: 'pretend' as never, label: 'Pretend' }
  const grown = deriveProviderCards([...AI_PROVIDERS, sixth])
  assert.equal(grown.length, AI_PROVIDERS.length + 1)
  assert.equal(grown.at(-1)?.id, 'AiProviderCard.pretend')
  assert.equal(grown.at(-1)?.title, 'Pretend API 키')
  assert.equal(grown.at(-1)?.tab, 'ai')
})

test('손으로 적는 카드가 열하나다 — 공급자를 손으로 적기 시작하면 여기서 늘어난다', () => {
  assert.equal(ADMIN_SETTINGS_CARDS_BY_HAND.length, 11)
  assert.equal(ADMIN_SETTINGS_CARDS.length, 11 + AI_PROVIDERS.length)
})

test('★ 목록의 제목이 카드에 실제로 뜨는 제목과 같다 — 보이는 이름으로 찾을 수 있어야 한다', () => {
  /*
    검색은 이 목록의 `title` 에 걸린다. 카드에 뜨는 글자와 다르면
    사람은 눈앞에 보이는 이름을 그대로 쳤는데 「없다」는 답을 받는다.
  */
  const offenders: string[] = []
  for (const c of ADMIN_SETTINGS_CARDS_BY_HAND) {
    const file = `${c.component}.tsx`
    if (!existsSync(join(SETTINGS_DIR, file))) { offenders.push(`${c.id}: ${file} 없음`); continue }
    if (!read(file).includes(`title="${c.title}"`)) offenders.push(`${c.id}: 카드에 title="${c.title}" 가 없다`)
  }
  assert.deepEqual(offenders, [], `목록 제목과 카드 제목이 다르다:\n${offenders.join('\n')}`)

  // 공급자 카드는 한 벌이라 식을 본다
  assert.ok(read('AiProviderCard.tsx').includes('title={`${spec.label} API 키`}'),
    '공급자 카드 제목 식이 바뀌었다. deriveProviderCards 의 title 도 같이 바꿀 것')
})
