/**
 * 테스트 등재 가드 — 「등재했는데 안 도는」 가드를 막는다
 *
 * **왜 있나**(v0.7.708 실측): `pnpm test` 는 `apps/web/package.json` 의 손으로 적은
 * 파일 목록을 돈다. 그런데 그 목록에 **한 인용부호 안에 경로 두 개 이상**이 들어간
 * 항목이 있었다 — `"a.test.ts b.test.ts"`. 셸이 그것을 **파일 이름 하나**로 넘기므로
 * `node --test` 는 `Could not find 'a.test.ts b.test.ts'` 를 뱉고 **그냥 지나간다.**
 *
 * 결과: 가드 **7개(70개 단정)가 등재된 채로 한 번도 실행되지 않았다.**
 * 목록에는 이름이 있으니 아무도 몰랐다 — 실패가 없는 것과 **돌지 않는 것**이
 * 화면에서 똑같이 보인다. 그게 이 부류의 가장 나쁜 점이다.
 *
 * 그런데 등재 목록을 **읽는 가드가 하나도 없었다.** 정책은 「새 테스트는 목록에
 * 등재한다」고 적어 두었지만 기계는 그 목록을 본 적이 없다.
 * 진척을 재는 도구가 틀리면 완료 판정이 불가능하다 — 여기가 그 자리다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

/** `pnpm test` 가 실제로 넘기는 인자들 — 셸이 보는 것과 같게 인용부호 단위로 자른다 */
function registeredPaths(): string[] {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>
  }
  const script = pkg.scripts.test
  assert.ok(script, 'package.json 에 test 스크립트가 없다 — 이름이 바뀌었는지 확인한다')
  return [...script.matchAll(/"([^"]+)"/g)].map((m) => m[1])
}

test('★ 등재된 경로에 공백이 없다 — 붙여 쓰면 그 가드는 한 번도 안 돈다', () => {
  /*
    `"a.test.ts b.test.ts"` 는 파일 **하나**의 이름이다. 없는 파일이므로 조용히 건너뛴다.
    목록을 늘릴 때는 인용부호도 함께 늘린다: `"a.test.ts" "b.test.ts"`.
  */
  const glued = registeredPaths().filter((p) => p.includes(' '))
  assert.deepEqual(glued, [], [
    '한 인용부호 안에 경로가 둘 이상 들어갔다 — 이 항목들은 실행되지 않는다:',
    ...glued.map((g) => `  · "${g}"\n    → ${g.split(' ').map((x) => `"${x}"`).join(' ')} 로 가른다`),
  ].join('\n'))
})

test('★ 등재된 파일이 실제로 있다 — 없으면 그 줄은 아무 일도 하지 않는다', () => {
  const missing = registeredPaths().filter((p) => !existsSync(p))
  assert.deepEqual(missing, [], [
    '등재됐는데 파일이 없다(이름이 바뀌었거나 지워졌다):',
    ...missing.map((m) => `  · ${m}`),
  ].join('\n'))
})

test('규칙이 도는 대상이 실제로 있다', () => {
  // 정규식이 안 맞아 0개가 되면 위 둘은 «전부 통과»로 보인다 — 가장 위험한 실패다
  const n = registeredPaths().length
  assert.ok(n >= 100, `등재된 테스트가 ${n}개뿐이다 — 목록을 읽는 방식이 깨졌는지 확인한다`)
})
