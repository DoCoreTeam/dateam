/**
 * RFP 목록 줄 배치 가드 — 단추가 한 세로줄에 서는가
 *
 * **왜 있나** (사용자 지적 2026-09-30, 화면 실측): *"버튼도 뒤죽박죽이네 우리 정책이 안이럴텐데"*
 *
 * `.ruleItem` 은 가로 flex 인데 **글 칸에 flex 가 없으면** 그 칸이 내용 크기만큼만 차지하고,
 * 뒤따르는 단추 무리가 제목 길이를 따라 좌우로 흩어진다. 공고 목록 일곱 줄의
 * 「케이스로 만들기」 오른쪽 끝이 전부 다른 자리에 있었다.
 *
 * 한 화면만 고치면 같은 지적이 다시 온다 — 같은 모양을 쓰는 자리가 여덟이다.
 * 그래서 **여덟 곳 전부**가 같은 글 칸 클래스를 쓰는지를 센다.
 *
 * `tsc`·`lint` 는 이 부류를 절대 못 본다. 빠진 클래스는 문법 오류가 아니다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripComments } from './component-scan.ts'

const WEB = new URL('../../', import.meta.url)

/** `styles.ruleItem` 을 쓰는 화면 전부. 새 화면이 생기면 여기 늘린다 */
const SCREENS = [
  'components/rfp/RadarRules.tsx',
  'components/rfp/SourceSites.tsx',
  'components/rfp/VendorSettings.tsx',
  'components/rfp/RuleSettings.tsx',
  'components/rfp/ProfileEditor.tsx',
  'app/(rfp)/rfp/admin/G2bServices.tsx',
  'app/(rfp)/rfp/admin/NotificationSettings.tsx',
]

function live(rel: string): string {
  return stripComments(readFileSync(new URL(rel, WEB), 'utf8'))
}

const count = (s: string, re: RegExp): number => (s.match(re) ?? []).length

test('줄을 쓰는 화면이 하나도 빠짐없이 목록에 있다', () => {
  // 목록에 없는 화면이 생기면 이 가드는 그 화면을 영영 안 본다
  for (const rel of SCREENS) {
    assert.ok(live(rel).includes('styles.ruleItem'), `${rel} 가 줄을 안 쓴다 — 목록에서 빼야 한다`)
  }
})

test('줄마다 글 칸이 남는 폭을 차지한다', () => {
  for (const rel of SCREENS) {
    const src = live(rel)
    const rows = count(src, /styles\.ruleItem/g)
    const mains = count(src, /styles\.ruleMain/g)
    // 줄 하나에 글 칸 하나. 없으면 단추가 글 길이를 따라 흩어진다
    assert.equal(mains, rows, `${rel}: 줄 ${rows}개에 글 칸 ${mains}개`)
  }
})

test('글 칸이 남는 폭을 차지하고 긴 제목에 안 터진다', () => {
  const css = readFileSync(new URL('app/(rfp)/rfp.module.css', WEB), 'utf8')
  const block = css.slice(css.indexOf('.ruleMain'), css.indexOf('}', css.indexOf('.ruleMain')))
  assert.match(block, /flex:\s*1/, '글 칸이 남는 폭을 안 차지한다')
  // min-width 0 이 없으면 긴 제목이 줄을 터뜨리고 옆 줄까지 같이 밀린다
  assert.match(block, /min-width:\s*0/, '긴 제목이 줄을 터뜨린다')
})

test('단추 무리는 안 줄어든다', () => {
  const css = readFileSync(new URL('app/(rfp)/rfp.module.css', WEB), 'utf8')
  const at = css.indexOf('.ruleActions')
  assert.ok(at > 0, '단추 무리 클래스가 없다')
  const block = css.slice(at, css.indexOf('}', at))
  // 줄어들면 단추 글자가 두 줄로 접힌다
  assert.match(block, /flex-shrink:\s*0/, '단추 무리가 줄어든다')
})

test('글 칸 뜻으로 ruleName 을 쓰지 않는다', () => {
  // ruleName 의 flex 를 글 칸 대용으로 쓰면 「이름 한 줄」과 「글 칸」이 같은 클래스가 되어
  // 한쪽을 고칠 때 다른 쪽이 조용히 따라 바뀐다
  for (const rel of SCREENS) {
    assert.doesNotMatch(
      live(rel),
      /styles\.ruleName\}\s*\$\{styles\.tight\}/,
      `${rel} 가 이름 클래스를 글 칸 대용으로 쓴다`,
    )
  }
})

// 찾은 공고를 뺄 수 있는가 — I04

test('적중 줄마다 빼기 단추가 있다', () => {
  // 사용자 지적 2026-09-30: 「공고 찾았으면 상관없는건 제거하거나 뺄수 있는 방법이 있어야지」
  const src = live('components/rfp/RadarRules.tsx')
  assert.match(src, /RFP_RADAR\.hitDismiss\b/, '빼기 단추가 없다')
  assert.match(src, /dismiss\(h\.id\)/, '그 줄을 안 뺀다')
  assert.match(src, /method: 'PATCH'/, '상태를 안 바꾼다')
})

test('빼기가 되돌릴 수 있다고 말한다', () => {
  // 못 되돌리는 줄 알면 아무도 안 누르고, 그러면 목록은 영영 안 줄어든다
  const src = live('components/rfp/RadarRules.tsx')
  assert.match(src, /hitDismissHint/, '되돌릴 수 있다는 말이 단추에 안 붙었다')
  assert.match(src, /aria-label=/, '읽어 주는 이름이 없다')
})

test('빼는 중에는 그 줄만 잠긴다', () => {
  /*
    한 덩이 busy 로 잠그면 한 줄을 빼는 동안 목록 전체가 멈춘다.
    쉰 줄에서 하나씩 빼야 하는데 매번 전체가 멈추면 못 쓴다
  */
  const src = live('components/rfp/RadarRules.tsx')
  // 이름이 어딘가에 있는 것으로는 모자란다 — 라벨에도 같은 식이 쓰인다.
  // **잠그는 자리**가 줄 단위인지를 본다 (처음 쓴 가드가 그래서 통과했다)
  assert.match(src, /disabled=\{dismissing === h\.id\}/, '줄마다 안 잠그고 전체를 잠근다')
  assert.doesNotMatch(
    src,
    /onClick=\{\(\) => void dismiss\(h\.id\)\}[\s\S]{0,120}?disabled=\{busy\}/,
    '빼기가 공용 busy 로 잠긴다',
  )
})

test('서버가 받아들인 뒤에 화면에서 뺀다', () => {
  // 먼저 빼면 실패했을 때 줄이 사라진 채로 남아, 새로고침해야 돌아온다
  const src = live('components/rfp/RadarRules.tsx')
  const at = src.indexOf('const dismiss')
  const body = src.slice(at, src.indexOf('}, [])', at))
  const okAt = body.indexOf('if (!res.ok)')
  const filterAt = body.indexOf('prev.filter')
  assert.ok(okAt > 0 && filterAt > okAt, '실패를 확인하기 전에 화면에서 뺀다')
})

// 골라서 한 번에 빼기 — I05

test('줄마다 고르는 칸이 있고 고른 수가 보인다', () => {
  const src = live('components/rfp/RadarRules.tsx')
  assert.match(src, /type="checkbox"[\s\S]{0,160}?picked\.has\(h\.id\)/, '줄마다 고르는 칸이 없다')
  assert.match(src, /RFP_RADAR\.hitSelected/, '고른 수를 안 보여 준다')
  assert.match(src, /RFP_RADAR\.hitDismissSelected/, '한 번에 빼기 단추가 없다')
  assert.match(src, /RFP_RADAR\.hitClearSelection/, '고른 것을 풀 길이 없다')
})

test('한 번에 빼기는 바뀐 것만 화면에서 뺀다', () => {
  // 서버가 못 바꾼 것이 있을 수 있다(남의 조직 것이 섞였거나 그 사이에 지워졌거나).
  // 고른 것을 전부 빼면 화면과 DB 가 어긋난 채로 남는다
  const src = live('components/rfp/RadarRules.tsx')
  const at = src.indexOf('const dismissPicked')
  const body = src.slice(at, src.indexOf('}, [picked])', at))
  assert.match(body, /body\.changed/, '서버가 바꿨다고 한 것을 안 읽는다')
  assert.match(body, /changed\.has\(h\.id\)/, '바뀐 것만 빼지 않는다')
  assert.match(body, /body\.failed/, '못 바꾼 수를 안 말한다')
})
