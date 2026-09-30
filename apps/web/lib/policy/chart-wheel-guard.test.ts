/**
 * 차트 위에서 휠을 굴리면 **페이지가 안 내려간다**
 *
 * ## 왜 이 가드가 있나
 *
 * React 는 `wheel` 을 루트에 **passive 로** 건다. react-dom 19.2.0 을 직접 열어 보면
 * `"touchstart" !== domEventName && "touchmove" !== domEventName && "wheel" !== domEventName`
 * 이 아닐 때 `{ passive: true }` 로 `addEventListener` 한다.
 *
 * passive 리스너 안에서 부른 `preventDefault()` 는 브라우저가 **그냥 무시한다**.
 * 그래서 `onWheel={...}` 안에 `e.preventDefault()` 를 적으면 코드는 멀쩡해 보이는데
 * 화면에서는 아무 일도 안 일어난다 — 차트는 줌이 되면서 페이지도 같이 내려간다
 * (사용자 지적 2026-09-30 「차트안에 마우스커서가 있을때는 화면 스크롤이 안되야 하는데
 * 자꾸 스크롤이 되네」).
 *
 * 막으려면 `{ passive: false }` 로 **직접** 거는 수밖에 없다. 이 저장소에는 그렇게 한
 * 자리가 이미 둘 있었다(`OrgTree`·`OrgPublicTree`) — 차트만 React 쪽을 쓰고 있었다.
 *
 * 이 결함은 타입 검사도 lint 도 시험도 못 잡는다. 문법이 맞고 함수도 실제로 불리기
 * 때문이다. 안 일어나는 것은 **브라우저의 기본 동작 취소** 하나뿐이라, 세는 자리가 없으면
 * 다음 사람이 똑같이 적는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..', '..')

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) files(full, out)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

/**
 * 주석을 걷어낸 몸통.
 *
 * **주석은 통과시키면 안 된다.** 실제로 거는 줄을 지우고 설명만 남겨 두어도 초록이면
 * 그 가드는 아무것도 안 지킨다 (전례: CSP 가드가 지시문을 주석에만 두고도 통과했다).
 */
function body(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const PANEL = join(WEB, 'app', '(trading)', 'trading', 'ChartPanel.tsx')

test('★ 차트가 휠을 passive 아닌 리스너로 건다', () => {
  const src = body(readFileSync(PANEL, 'utf8'))
  assert.match(
    src,
    /addEventListener\(\s*'wheel'[\s\S]{0,200}?passive:\s*false/,
    '차트가 wheel 을 { passive: false } 로 안 건다 — preventDefault 가 무시되어 페이지가 같이 내려간다',
  )
  assert.match(
    src,
    /\.preventDefault\(\)/,
    '휠 기본 동작을 취소하는 줄이 없다 — 리스너만 붙이면 페이지는 그대로 내려간다',
  )
})

test('★ 휠을 막는 자리가 React onWheel 을 안 쓴다', () => {
  /*
    React 의 `onWheel` 은 루트의 passive 리스너를 지나므로 그 안의 `preventDefault()` 는
    무시된다. 둘이 한 파일에 같이 있으면 「막았다고 적었는데 안 막히는」 코드다.
    막을 뜻이 없는 `onWheel`(읽기만 하는 것)은 그대로 둬도 된다 — 좁게 센다.
  */
  const broken: string[] = []
  for (const dir of ['app', 'components']) {
    for (const f of files(join(WEB, dir))) {
      const src = body(readFileSync(f, 'utf8'))
      if (!/onWheel\s*=\s*\{/.test(src)) continue
      if (!/preventDefault\(\)/.test(src)) continue
      broken.push(relative(WEB, f))
    }
  }
  assert.deepEqual(
    broken,
    [],
    'React onWheel 안에서 preventDefault 를 부른다 — React 가 wheel 을 passive 로 걸어 그 줄은 무시된다, addEventListener 로 { passive: false } 를 직접 걸어야 한다',
  )
})

test('★ 이 규칙을 이미 지키던 자리가 계속 지킨다', () => {
  // 차트만 고치고 끝내면 다음에 같은 결함이 다른 화면에서 난다. 먼저 있던 두 자리를 같이 센다
  for (const rel of [
    'app/admin/org-chart/OrgTree.tsx',
    'app/(member)/org/OrgPublicTree.tsx',
  ]) {
    const src = body(readFileSync(join(WEB, rel), 'utf8'))
    assert.match(
      src,
      /addEventListener\(\s*'wheel'[\s\S]{0,200}?passive:\s*false/,
      `${rel} 이 wheel 을 { passive: false } 로 안 건다`,
    )
  }
})
