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

/* ── 실브라우저 경로 ─────────────────────────────── */

/*
  **e2e 는 `pnpm test` 가 안 돈다.** `node --test` 는 playwright 스펙을 읽지 못하고,
  목록에 넣으면 그 자리에서 전부 죽는다. 그렇다고 아무 데도 안 적어 두면 이 저장소가
  반복한 그 일이 또 일어난다 — **있는데 아무도 안 부르는 검사.**
  그래서 ① 부를 길(`pnpm e2e`)이 있는지 ② 덮기로 한 경로가 스펙에 남아 있는지를 여기서 본다.
*/
test('★ 실브라우저를 부를 길이 있다 — 그리고 node 목록에는 안 들어간다', () => {
  const root = JSON.parse(readFileSync('../../package.json', 'utf8')) as {
    scripts: Record<string, string>
  }
  assert.match(root.scripts.e2e ?? '', /playwright test/,
    '실브라우저를 부르는 스크립트가 없다 — 그러면 아무도 안 돌린다')

  const specs = registeredPaths().filter((p) => p.endsWith('.spec.ts'))
  assert.deepEqual(specs, [],
    'playwright 스펙이 node --test 목록에 들어갔다 — 그 자리에서 전부 죽는다')
})

test('★ 견적서 파일 경로의 실화면 검사가 남아 있다', () => {
  const spec = 'e2e/crm-quote-fill.spec.ts'
  assert.ok(existsSync(spec), `${spec} 가 사라졌다`)
  const src = readFileSync(spec, 'utf8')
  /*
    한 파일에 든 견적 여러 건과 **오류 경로 하나**는 단위 검사로 대신할 수 없다.
    「부품은 다 있는데 화면이 안 부른다」가 이 저장소가 반복한 사고이고, 그것은
    사람이 밟는 경로를 실제로 밟아 봐야만 드러난다.
  */
  assert.match(src, /파일로 가져오기/, '딜 화면의 가져오기 경로를 안 밟는다')
  assert.match(src, /toHaveCount\(2/, '한 파일에서 두 건이 서는지 안 본다')
  assert.match(src, /파일이 너무 큽니다/, '오류 경로를 하나도 안 재현한다')
  assert.match(src, /trashQuotes\(/, '검증으로 만든 견적을 안 지운다 — 운영 데이터에 쌓인다')
})
