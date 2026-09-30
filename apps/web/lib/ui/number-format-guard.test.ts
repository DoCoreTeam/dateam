// lib/ui/number-format-guard.test.ts — 돈·가격·수량은 맨몸으로 안 나간다 (정책 §2-3-2 U-8)
//
// **왜 생겼나**(사용자 지적 2026-09-30): 「모든 숫자에 콤마찍는건 기본 아닌가 그런것도 못지키네」
//
// AI 트레이딩 현황의 지금 가격이 「1086.44」였다. 고칠 자리는 다섯 줄이었지만, 다섯 줄을
// 고치는 것으로는 다음 화면이 또 맨몸으로 나간다 — 규칙이 글로만 있으면 새 화면이 그것을
// 모른다(버전 규칙이 열일곱 판 안 지켜진 것과 같은 구멍).
//
// **무엇을 세나**: `.toFixed(` 를 부르는 자리 중 **부르는 값의 이름이 돈·가격·수량**인 것.
// 백분율·배수·바이트 환산까지 다 막으면 규칙이 넓어져 면제가 늘고, 면제가 늘면 가드가
// 아무것도 안 막는다. 1000 을 넘을 수 있는 성격의 값만 본다.
//
// **면제는 사유와 함께 적는다.** 「나중에」는 안 지켜져도 안 걸리므로 쓰지 않는다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const WEB = join(import.meta.dirname, '..', '..')
const ROOTS = ['lib', 'components', 'app']

/**
 * 이 이름으로 불리는 값은 1000 을 넘을 수 있다 — 넘으면 자릿수를 세어야 읽힌다.
 * 좁게 잡는다: 넓히면 면제 목록이 길어지고, 긴 면제 목록은 가드가 아니라 장부다.
 */
const MONEYISH = /(price|amount|budget|cost|value|median|won|krw|usd|points?|total|revenue|capital|fee|pnl)/i

/**
 * 맨몸 `toFixed` 를 그대로 둘 자리와 **그 이유**.
 *
 * 세 부류만 있다.
 *   ① 굽는 자리 자신 — 여기서 막으면 SSOT 가 자기 일을 못 한다
 *   ② 기계가 읽는 문자열 — 키·사유 코드에 쉼표가 섞이면 대조와 파싱이 깨진다
 *   ③ 입력칸에 넣는 값 — 쉼표가 들어가면 숫자로 안 읽힌다
 */
const ALLOWED: Readonly<Record<string, string>> = {
  'lib/ui/number-format.ts': '① 여기가 굽는 자리다',
  'lib/gpu/usai-orchestrate.ts': '② 같은 품목을 묶는 키 문자열 — 쉼표가 들어가면 같은 품목이 둘로 갈린다',
  'app/api/pricing/gpu/market/sync-cost/route.ts': '② 대기 중인 건을 대조하는 키 문자열',
  'lib/trading/ev/model.ts': '② 기계 사유 코드 ev_below_minimum:0.12 — 읽는 쪽이 숫자로 판다',
  'lib/trading/signal/rules.ts': '② 기계 사유 코드 ev_below_minimum:0.12',
  'lib/ci/queries/assets.ts': '③ 아니고 단위 환산 — 1024 미만으로 줄인 뒤라 네 자리가 안 된다',
  'app/(trading)/trading/EntryPanel.tsx': '③ 값을 입력칸에 넣는다 — 쉼표가 들어가면 숫자로 안 읽힌다',
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.next')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

test('★ 돈·가격·수량은 number-format 을 지난다', () => {
  const bad: string[] = []
  for (const root of ROOTS) {
    for (const full of walk(join(WEB, root))) {
      const rel = relative(WEB, full)
      if (ALLOWED[rel]) continue
      const lines = readFileSync(full, 'utf8').split('\n')
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/([A-Za-z0-9_$.[\]()]+)\s*\.toFixed\(/g)) {
          if (MONEYISH.test(m[1]!)) bad.push(`${rel}:${i + 1}  ${m[1]}.toFixed(`)
        }
      })
    }
  }
  assert.deepEqual(
    bad,
    [],
    `돈·가격·수량을 맨몸으로 굽고 있습니다 — lib/ui/number-format.ts 의 fmtNum 을 쓰거나,\n`
    + `정말 쉼표를 넣으면 안 되는 자리면 이 파일 ALLOWED 에 **사유와 함께** 적으세요:\n  ${bad.join('\n  ')}`,
  )
})

test('면제 목록은 사유를 적는다 — 「나중에」는 안 지켜져도 안 걸린다', () => {
  for (const [file, why] of Object.entries(ALLOWED)) {
    assert.ok(why.length >= 10, `${file} 의 면제 사유가 너무 짧습니다`)
    assert.ok(/^[①②③]/.test(why), `${file} 의 면제 사유가 세 부류 중 어느 것인지 안 밝힙니다`)
  }
})

test('면제 목록에 죽은 줄이 없다 — 고친 파일이 남아 있으면 다음 위반을 그냥 통과시킨다', () => {
  const stale: string[] = []
  for (const file of Object.keys(ALLOWED)) {
    const src = readFileSync(join(WEB, file), 'utf8')
    if (!/\.toFixed\(/.test(src)) stale.push(file)
  }
  assert.deepEqual(stale, [], `면제가 필요 없어진 파일입니다 — ALLOWED 에서 지우세요:\n  ${stale.join('\n  ')}`)
})
