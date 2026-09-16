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

/** AI 결과를 그리면서 공용 부품을 안 쓰는 화면 */
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
      if (!src.includes('confidence')) continue
      if (src.includes('@ax/ai-react')) continue
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
  // 경로나 판정이 깨져 0개가 되면 위 검사는 «늘지 않았다»로 통과해 버린다
  assert.ok(homemade().length >= 20, `훑은 결과가 ${homemade().length}개뿐이다`)
  assert.ok(BASELINE.화면.length > 0, '기준선이 비었다')
  for (const f of BASELINE.화면) {
    assert.ok(existsSync(join(WEB, f)), `${f} 을 못 찾는다`)
  }
})
