/**
 * AI 결과를 자작으로 그리는 화면이 더 늘지 않게 한다
 *
 * **왜**: AI 결과를 그리는 화면이 스물여덟인데 공용 부품을 쓰는 것은 셋뿐이다.
 *   나머지는 자기 화면에서 각자 그린다. 그래서 같은 확신이 어떤 화면에서는 퍼센트,
 *   어떤 화면에서는 배지로 보이고, **고친 흔적은 어느 화면에도 없었다**(실측 2026-09-14).
 *
 *   스물다섯을 한 번에 옮기지 않는다. 화면마다 사정이 달라 한 번에 옮기면 어디가
 *   깨졌는지 못 말한다. 대신 **기준선**을 둔다 — 늘면 막고, 옮겨서 줄면 따라 내린다.
 *
 * 검사 셋:
 *   1) 목록 밖 화면이 새로 자작으로 그리지 않는다
 *   2) 공용으로 옮겨 사라진 화면은 목록에서도 지운다
 *   3) 규칙이 도는 대상이 실제로 있다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const BASELINE = JSON.parse(
  readFileSync(join(WEB, 'lib/policy/ai-component-baseline.json'), 'utf8'),
) as { 화면: string[] }

/*
  판정을 다시 잰다 (2026-09-17).

  처음 규칙은 «`confidence` 라는 글자가 있고 `@ax/ai-react` 를 안 쓰면 자작» 이었다.
  그 셈으로 스물다섯이 나왔는데, 실제로 열어 보니 성격이 셋이었다.

    ① **숫자로 그리는 곳** — `Math.round(c * 100)%` 또는 이미 0~100 정수.
       공용 규칙이 통일할 수 있는 것이 이것이고, 실측 열둘이었다.
    ② **값만 지나가는 곳** — 타입에 `confidence` 가 있거나 아래로 넘기기만 한다.
       그릴 것이 없으니 통일할 것도 없다. 일곱.
    ③ **열거형을 배지로 그리는 곳** — CI 의 `근거 충분 / 관찰 중 / 데이터 부족`.
       퍼센트가 아니라 **다른 개념**이고, 이미 `components/ci/StatusBadge.tsx`
       한 곳에서만 그린다. 공용부에 밀어 넣으면 뜻이 바뀐다.

  ②와 ③을 자작으로 세면 기준선이 안 줄어드는 것처럼 보이고, 그러면 다 옮겨도
  숫자가 남아 「아직 멀었다」로 읽힌다. **재는 것이 틀리면 완료를 판정할 수 없다.**
  그래서 ①만 센다.
*/

/** 확신을 **숫자로 직접 그리는** 줄인가 */
function drawsNumber(line: string): boolean {
  if (!/confidence/i.test(line)) return false
  // 타입 선언·주석은 그리는 것이 아니다
  if (/^\s*(\/\/|\*|\/\*)/.test(line)) return false
  if (/^\s*[a-zA-Z_]*confidence\??\s*:/.test(line.trim())) return false
  return /Math\.round\([^)]*confidence|confidence[^\n]*%|toFixed/i.test(line)
}

/** 확신을 숫자로 직접 그리면서 공용 규칙을 안 쓰는 화면 */
function homemade(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      if (name === 'node_modules' || name.startsWith('.next')) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!name.endsWith('.tsx')) continue
      const src = readFileSync(full, 'utf8')
      if (src.includes('@ax/ai-react')) continue
      if (!src.split('\n').some(drawsNumber)) continue
      out.push(relative(WEB, full))
    }
  }
  walk(join(WEB, 'components'))
  walk(join(WEB, 'app'))
  return out.sort()
}

test('★ 자작으로 그리는 화면이 기준선보다 늘지 않았다', () => {
  const known = new Set(BASELINE.화면)
  const added = homemade().filter((f) => !known.has(f))
  assert.deepEqual(added, [], [
    'AI 결과를 자기 화면에서 새로 그린다. 같은 값이 화면마다 다르게 보이게 된다:',
    ...added.map((f) => `  ${f}`),
    '고치는 법: @ax/ai-react 의 AiValue 와 Evidence 를 쓰고, 말은 용어집에서 준다',
  ].join('\n'))
})

test('★ 공용으로 옮겨 사라진 화면은 기준선에서도 지운다', () => {
  const now = new Set(homemade())
  const gone = BASELINE.화면.filter((f) => !now.has(f))
  assert.deepEqual(gone, [], [
    '기준선에 있는데 실제로는 없다. 공용으로 옮겼거나 파일이 지워졌다:',
    ...gone.map((f) => `  ${f}`),
    '기준선을 안 내리면 그 자리만큼 다시 늘어도 가드가 못 잡는다',
  ].join('\n'))
})

test('규칙이 도는 대상이 실제로 있다', () => {
  /*
    경로나 판정이 깨져 0개가 되면 위 검사는 «늘지 않았다»로 통과해 버린다.
    그런데 «스무 개는 나와야 한다» 로 잡으면 **줄이는 일이 이 검사를 깨뜨린다.**
    세는 대신 판정 자체가 도는지를 본다 — 아는 모양 하나를 실제로 잡는가.
  */
  assert.equal(drawsNumber('  <span>신뢰도 {Math.round(c.confidence * 100)}%</span>'), true)
  assert.equal(drawsNumber('  confidence?: number | null'), false)
  assert.equal(drawsNumber('  // confidence 를 100% 로 보이면 안 된다'), false)
  for (const f of BASELINE.화면) {
    assert.ok(existsSync(join(WEB, f)), `${f} 을 못 찾는다`)
  }
})

test('★ CI 의 열거형 확신은 여전히 한 곳에서만 그린다', () => {
  /*
    CI 의 확신은 퍼센트가 아니라 「근거 충분 / 관찰 중 / 데이터 부족」 셋이다.
    퍼센트 규칙에 밀어 넣으면 뜻이 바뀌므로 공용부로 안 옮긴다. 대신 **갈라지지 않게**
    막는다 — 색과 말을 고르는 자리가 둘이 되면 그때부터 화면마다 달라진다.
  */
  const drawers: string[] = []
  const walk = (dir: string) => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { if (name !== 'node_modules') walk(full); continue }
      if (!name.endsWith('.tsx') && !name.endsWith('.ts')) continue
      if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue
      const src = readFileSync(full, 'utf8')
      if (/CONFIDENCE_TONE\s*[:=]/.test(src)) drawers.push(relative(WEB, full))
    }
  }
  walk(join(WEB, 'components'))
  walk(join(WEB, 'app'))
  walk(join(WEB, 'lib'))
  assert.deepEqual(drawers, ['components/ci/StatusBadge.tsx'],
    `CI 확신 배지를 그리는 자리가 하나가 아니다: ${drawers.join(', ')}`)
})
