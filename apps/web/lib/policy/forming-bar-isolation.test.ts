/**
 * 형성 중인 봉은 **그림에만 있다** — 판단·지표·채점에 닿으면 안 된다
 *
 * ## 왜 이 가드가 있나
 *
 * 형성 중인 봉은 아직 바뀌는 값이다. 그 값으로 판단하면 **같은 순간을 다시 재현할 수
 * 없다** — 나중에 그 판단을 되짚어도 그때 본 봉이 남아 있지 않다(M5). 채점도 마찬가지다:
 * 안 닫힌 봉으로 채점하면 성적이 볼 때마다 달라진다.
 *
 * 그림과 판단이 같은 자료를 쓰는 것이 이 저장소의 규칙인데, **여기 한 곳만 예외**다.
 * 예외는 좁게 못 박아 두지 않으면 반드시 새어 나간다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..', '..')
const TRADING = join(WEB, 'lib', 'trading')

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) files(full, out)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

/** import 줄과 주석을 걷어낸 몸통. 이름만 스치는 자리를 세면 가드가 헛돈다 */
function body(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*import\s[\s\S]*?from\s*['"][^'"]*['"];?\s*$/gm, '')
}

/** 형성 봉을 만드는 곳은 여기 하나다 */
const MAKER = 'lib/trading/chart/forming.ts'

test('★ 형성 봉을 만드는 모듈을 판단·채점 쪽에서 안 부른다', () => {
  /**
   * 부르면 안 되는 자리 — 지표·판단기·채점·계보·백테스트·검증.
   * 그림(`app/`)과 차트 모듈만 불러도 된다.
   */
  const forbidden = ['judge', 'backtest', 'validation', 'signal', 'jobs', 'replay', 'ev', 'calibrate']
  const leaked: string[] = []
  for (const f of files(TRADING)) {
    const rel = relative(WEB, f)
    if (!forbidden.some((d) => rel.includes(`lib/trading/${d}/`))) continue
    if (/from ['"].*chart\/forming/.test(body(readFileSync(f, 'utf8')))) leaked.push(rel)
  }
  assert.deepEqual(leaked, [],
    '형성 봉 모듈이 판단·채점 쪽으로 샜다 — 안 닫힌 값으로 판단하면 그 판단을 다시 재현할 수 없다')
})

test('★ 판단에 들어가는 봉은 서버가 준 확정 봉뿐이다', () => {
  // 지표는 확정 봉만 받는다. 형성 봉 타입이 이 셋 근처에 있으면 안 된다
  for (const rel of [
    'lib/trading/judge/indicators.ts',
    'lib/trading/judge/score.ts',
    'lib/trading/judge/lineage.ts',
    'lib/trading/backtest/run.ts',
  ]) {
    const src = body(readFileSync(join(WEB, rel), 'utf8'))
    assert.equal(/\bFormingBar\b|\bisForming\b|buildDisplayBars/.test(src), false,
      `${rel} 이 형성 봉을 안다 — 판단이 안 닫힌 값을 볼 길이 생겼다`)
  }
})

test('★ 화면 봉 단위가 판단 단위를 안 바꾼다', () => {
  const panel = readFileSync(join(WEB, 'app', '(trading)', 'trading', 'ChartPanel.tsx'), 'utf8')
  /*
    고르기는 **보는 단위**다. 판단은 `decision_tf` 가 정하고 그 값은 설정에서 온다 —
    화면에서 60분을 골라도 판단 단위가 안 바뀌어야 한다.
  */
  assert.equal(/decision_tf|decisionTf/.test(body(panel)), false,
    '화면 봉 단위 고르기가 판단 단위에 닿는다')
  // 그 사실을 화면이 사람에게도 말해야 한다
  assert.match(panel, /판단은 1분봉으로 합니다/, '보는 단위와 판단 단위가 다르다는 것을 화면이 안 말한다')
})

test('★ 형성 봉은 그리는 자리에서만 만들어진다', () => {
  const makers: string[] = []
  for (const f of files(join(WEB, 'lib'))) {
    const rel = relative(WEB, f)
    if (rel === MAKER) continue
    if (/buildDisplayBars\s*\(/.test(body(readFileSync(f, 'utf8')))) makers.push(rel)
  }
  assert.deepEqual(makers, [], `형성 봉을 ${MAKER} 밖에서도 만든다 — 규칙이 두 곳이 된다`)
})

test('★ 저장하는 봉에는 형성 봉이 안 섞인다', () => {
  // 봉을 쓰는 자리가 형성 봉을 알면 안 된다. 저장된 봉은 전부 확정 봉이어야 한다
  for (const rel of ['lib/trading/bars/store.ts', 'lib/trading/bars/confirm.ts', 'lib/trading/bars/rollup.ts']) {
    const src = body(readFileSync(join(WEB, rel), 'utf8'))
    assert.equal(/forming|DisplayBar/.test(src), false, `${rel} 이 형성 봉을 안다 — 안 닫힌 봉이 표에 들어갈 길이 생겼다`)
  }
})
