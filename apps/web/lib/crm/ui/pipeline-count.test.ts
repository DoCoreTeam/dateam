// lib/crm/ui/pipeline-count.test.ts — 「같은 자리의 숫자는 뜻이 하나」 가드
//
// 사용자 지적(2026-09-08): *"다섯개인데 왜 총 7개인 걸로 나오지?"*
// 표는 딜 5건, 보드 셀렉트는 「전체 (7개)」 — 7은 **파이프라인 수**였다.
//
// 이 가드가 막는 것은 두 가지다:
//   ① 「전체」가 형제 줄과 다른 것을 세는 것 (지금의 결함)
//   ② 세는 식이 다시 두 벌로 갈리는 것 (그 결함이 생긴 구조적 원인)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dealsInPipeline, dealsInPipelines } from './pipeline-count.ts'

const read = (p: string) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf-8')
const CLIENT = 'app/(crm)/crm/deals/DealsClient.tsx'

/* ── 계산 ────────────────────────────────────────────── */

// 앵커: 운영 DB 실측(2026-09-08) — 살아 있는 파이프라인 7개에 딜 5건.
// GPU 인프라 2건(견적·제안 1 + 수주 1) · 공공 3건 · 나머지 5개는 0건.
// 화면에서 이 값이 「수주 총액 5건」으로 그려지는 것을 확인했다.
test('★ 앵커: 실측 7개 파이프라인의 딜 합이 표의 5건과 같다', () => {
  const live = [
    { stages: [{ dealCount: 0 }, { dealCount: 0 }, { dealCount: 1 }, { dealCount: 0 }, { dealCount: 0 }, { dealCount: 1 }] }, // GPU 인프라
    { stages: [{ dealCount: 0 }, { dealCount: 3 }, { dealCount: 0 }, { dealCount: 0 }, { dealCount: 0 }] },                   // 공공
    { stages: [{ dealCount: 0 }] }, { stages: [{ dealCount: 0 }] }, { stages: [{ dealCount: 0 }] },
    { stages: [{ dealCount: 0 }] }, { stages: [{ dealCount: 0 }] },
  ]
  assert.equal(live.length, 7, '파이프라인은 7개다 — 이 숫자를 딜 수로 쓰면 안 된다')
  assert.equal(dealsInPipelines(live), 5, '「전체」가 뜻해야 하는 수는 표의 5건이다')
  assert.equal(dealsInPipeline(live[0]), 2)
  assert.equal(dealsInPipeline(live[1]), 3)
})

test('단계가 수를 안 주면 0으로 센다 — 모르는 것을 있는 것처럼 세지 않는다', () => {
  assert.equal(dealsInPipeline({ stages: [{}, { dealCount: 2 }] }), 2)
  assert.equal(dealsInPipelines([]), 0)
})

/* ── 배선 — 만들고 안 쓰면 없는 규칙이다 ─────────────── */

test('★ 셀렉트의 「전체」가 딜 수를 말한다 — 파이프라인 수를 쓰면 형제 줄과 뜻이 갈린다', () => {
  const src = read(CLIENT)
  assert.ok(
    !/파이프라인 전체 \(\{pipelines\.length\}/.test(src),
    '「전체」에 파이프라인 수를 넣으면 바로 아래 딜 수 줄들과 같은 자리에서 다른 뜻이 된다',
  )
  assert.match(
    src,
    /파이프라인 전체 \(\{countOnly\('deal', dealCount\)\}\)/,
    '「전체」는 그것을 고르면 보이는 딜 수를 말해야 한다',
  )
})

test('★ 세는 식이 한 곳에서만 나온다 — 두 벌이면 한쪽만 어긋나도 아무도 모른다', () => {
  const src = read(CLIENT)
  assert.ok(
    !/dealCount \?\? 0/.test(src),
    '화면이 직접 세면 SSOT 와 갈린다 — dealsInPipeline(s) 를 쓴다',
  )
  assert.match(src, /dealsInPipelines\(pipelines\)/, '전체 합이 SSOT 를 안 거친다')
  assert.match(src, /dealsInPipeline\(p\)/, '파이프라인별 수가 SSOT 를 안 거친다')
})

test('조수사를 화면이 고르지 않는다 — 용어집이 정한다(§0-2)', () => {
  const src = read(CLIENT)
  assert.match(src, /countOnly\('deal'/, '개수 표기는 countOnly 를 거쳐야 한다')
  assert.ok(
    !/\{dealCount\}건|\{dealCount\}개/.test(src),
    '화면이 「건/개」를 직접 적으면 같은 개체가 화면마다 다르게 세어진다',
  )
})
