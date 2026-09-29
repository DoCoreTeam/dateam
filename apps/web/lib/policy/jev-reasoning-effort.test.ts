/**
 * 생각 깊이가 **관문 본문까지 가는지**를 센다
 *
 * ## 왜 이름이 아니라 값을 세나
 *
 * 같은 결함이 네 번 났다: 옵션에 이름은 선언해 두고 부르는 자리에서 안 넘기는 것.
 * 단위 시험은 전부 초록이었다 — 그 함수를 직접 부르는 시험이었기 때문이다.
 * 선언만 보는 가드는 그 결함을 한 번도 못 잡는다.
 *
 * ## 무엇이 걸렸었나
 *
 * 실측 2026-09-28: 생각 깊이를 안 실으면 같은 판단 프롬프트가 19.7~21.5초 걸렸고
 * 출력 3,290토큰 중 3,254개가 생각이었다. 대기 시간은 20초였으므로 관문이 답을 쓰는
 * 중에 우리가 끊었다 — 원장에는 22건 전부 ok 인데 판단 기록에는 다섯 건이 `timeout`
 * 으로 남았다. 다섯 중 하나를 우리가 버린 것이다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TRADING_SETTINGS } from '../trading/settings/registry.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const TRADING = join(HERE, '..', 'trading')

/** 설정 키 하나. 두 판단기와 검증이 **같은 글자**를 읽어야 성적을 견줄 수 있다 (§17.1) */
const KEY = 'jev_reasoning_effort'

/** 관문이 받는 값. 목록 밖을 보내면 400 이고 그 판단은 통째로 사라진다 */
const GATEWAY_ACCEPTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * fetch 본문(`JSON.stringify({...})`)만 잘라 낸다.
 *
 * 파일 전체를 훑으면 주석이나 형 선언에 이름이 있어도 통과한다 — 그것이 바로
 * 이 가드가 막으려는 결함이다.
 */
function fetchBody(file: string): string {
  const src = readFileSync(file, 'utf8')
  const at = src.indexOf('JSON.stringify({')
  assert.ok(at > 0, `${file} 에 관문으로 보내는 본문이 없다`)
  let depth = 0
  for (let i = src.indexOf('{', at); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(at, i + 1)
    }
  }
  assert.fail(`${file} 의 본문 괄호가 안 닫힌다`)
}

const JUDGES = [
  { name: '진입 판단', file: join(TRADING, 'judge', 'jev.ts') },
  { name: '청산 섀도', file: join(TRADING, 'judge', 'exit-jev.ts') },
]

test('★ 두 판단기 모두 생각 깊이를 관문 본문에 싣는다 — 이름만 있으면 안 된다', () => {
  for (const j of JUDGES) {
    const body = fetchBody(j.file)
    assert.ok(
      /reasoning_effort:\s*reasoningEffort/.test(body),
      `${j.name}이 관문 본문에 생각 깊이를 안 싣는다 — 관문이 제 마음대로 오래 생각하고 우리가 끊는다`,
    )
  }
})

test('★ 빈 값이면 줄을 아예 뺀다 — 빈 문자열은 관문이 400 으로 거절한다', () => {
  for (const j of JUDGES) {
    const body = fetchBody(j.file)
    assert.ok(
      /reasoningEffort === ''\s*\?\s*\{\}\s*:/.test(body),
      `${j.name}이 빈 값을 그대로 실어 보낸다 — 그 400 은 키 문제·모델 문제와 섞여 원인을 못 찾게 한다`,
    )
  }
})

/**
 * **부르는 자리가 셋이다.** 하나라도 다른 값을 읽으면 그 판의 성적은 다른 조건의 것이다.
 * 실시간 진입 · 실시간 청산 섀도 · 검증 — 셋이 같은 설정 키를 본다 (§17.1 M4).
 */
test('★ 부르는 자리 셋이 같은 설정 키를 읽는다', () => {
  const sites = [
    { name: '실시간 진입', file: join(TRADING, 'jobs', 'tick.ts'), needs: [`str('${KEY}'`, 'reasoningEffort:'] },
    { name: '청산 섀도', file: join(TRADING, 'jobs', 'tick.ts'), needs: [`jevReasoningEffort: str('${KEY}'`] },
    { name: '검증', file: join(TRADING, 'validation', 'pipeline.ts'), needs: [`values.${KEY}`, 'reasoningEffort'] },
  ]
  for (const s of sites) {
    const src = readFileSync(s.file, 'utf8')
    for (const need of s.needs) {
      assert.ok(src.includes(need), `${s.name}이 ${need} 를 안 쓴다 — 셋이 다른 깊이로 생각하면 성적을 못 견준다`)
    }
  }
  // 섀도까지 값이 흘러가야 한다. tick 이 읽고 knowledge-job 이 안 넘기면 거기서 끊긴다
  const job = readFileSync(join(TRADING, 'jobs', 'knowledge-job.ts'), 'utf8')
  assert.ok(job.includes('reasoningEffort: p.jevReasoningEffort'),
    'knowledge-job 이 받아 놓고 청산 판단기에 안 넘긴다')
})

test('★ 관리자가 고를 수 있는 값이 관문이 받는 값과 같다', () => {
  const spec = TRADING_SETTINGS.find((x) => x.key === KEY)
  assert.ok(spec, '설정에 생각 깊이가 없다')
  assert.equal(spec.type, 'choice', '자유 입력이면 관문이 모르는 값을 보낼 수 있다')
  assert.deepEqual(
    [...(spec.choices ?? [])].sort(),
    [...GATEWAY_ACCEPTS].sort(),
    '화면에서 고를 수 있는데 관문이 400 으로 거절하는 값이 있다 — 그 판단은 통째로 사라진다',
  )
  // 기본값도 관문이 받는 값이어야 한다. 기본이 거절당하면 아무도 안 고친 판이 전부 죽는다
  assert.ok(GATEWAY_ACCEPTS.includes(String(spec.defaultValue)), '기본값을 관문이 거절한다')
})

/**
 * **코드가 기본을 박으면 화면과 실제가 갈린다.** 판단기 안에 `?? 'low'` 를 두면
 * 설정 화면이 `high` 라고 적혀 있어도 나가는 값은 `low` 일 수 있고,
 * 그 어긋남은 「화면에는 low 인데 판단이 20초 걸린다」로 나타난다.
 */
test('★ 판단기가 기본값을 자기 안에 안 박는다 — 부르는 쪽이 설정에서 읽는다', () => {
  for (const j of JUDGES) {
    const src = readFileSync(j.file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    assert.equal(
      /reasoningEffort\s*(\?\?|\|\|)\s*['"]/.test(src),
      false,
      `${j.name}이 기본값을 자기 안에 박는다 — 설정 화면이 말하는 것과 실제로 나가는 것이 갈린다`,
    )
  }
})
