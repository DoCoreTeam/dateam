/**
 * 단건 처리가 전체 배치를 부르지 않는다 (P0030 I01)
 *
 * ## 왜 소스를 읽는 가드인가
 *
 * 이 규칙은 «무엇이 무엇을 부르는가»라서 값으로 확인할 수 없다. handleProject 를
 * 실제로 돌리려면 Supabase 관리자 클라이언트와 콘텐츠 한 건이 필요하고, 그렇게
 * 세운 시험은 정작 «불렀는가»가 아니라 «붙었는가»를 본다.
 *
 * ## 무엇을 막는가
 *
 * 파생값 계산(handleProject)이 콘텐츠 한 건마다 runDiscovery 를 불렀다. 그 한 줄이
 * 주제마다 대조 30건을 AI 에게 묻는 배치라, 간격 3.2초를 지키면 11분이 걸렸다.
 * 잠금 만료는 5분이어서 매번 죽은 것으로 회수돼 세 번씩 다시 돌았다.
 *
 * 실측 2026-09-20
 *   - ai_llm_calls 사흘 ci-discover 49,064회, 그중 46,212회가 한도로 실패
 *   - ci_jobs project 단계 STALLED 302건, 전부 시도 3회 뒤 폐기
 *   - 같은 사흘 실제 신규 콘텐츠는 하루 7.3건
 *
 * 한 줄을 지웠다고 끝나지 않는다. 다음 사람이 «파생값이 바뀌었으니 공식도 다시»
 * 라고 생각하면 같은 한 줄이 돌아온다. 그래서 가드로 남긴다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'lib', 'ci', 'jobs')
const handlers = readFileSync(join(DIR, 'handlers.ts'), 'utf8')
const stages = readFileSync(join(DIR, 'stages.ts'), 'utf8')

/**
 * 함수 하나의 본문만 떼어 낸다. 파일 전체를 훑으면 옆 함수의 호출을 잘못 잡는다.
 *
 * 인자 목록을 **먼저 건너뛴다.** 이름 뒤의 첫 중괄호를 본문으로 잡으면
 * `opts: { maxSetsPerTopic: number }` 같은 인자 타입을 본문으로 읽는다(실제로 그랬다).
 */
function bodyOf(src: string, name: string): string {
  const start = src.indexOf(`async function ${name}(`)
  assert.notEqual(start, -1, `${name} 을 찾지 못했다`)

  let i = src.indexOf('(', start)
  for (let depth = 0; i < src.length; i++) {
    if (src[i] === '(') depth++
    else if (src[i] === ')' && --depth === 0) break
  }

  const open = src.indexOf('{', i)
  assert.notEqual(open, -1, `${name} 본문의 시작을 찾지 못했다`)
  for (let depth = 0, j = open; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}' && --depth === 0) return src.slice(open, j + 1)
  }
  assert.fail(`${name} 본문의 끝을 찾지 못했다`)
}

test('파생값 계산이 발견과 공식 배치를 부르지 않는다', () => {
  const body = bodyOf(handlers, 'handleProject')

  for (const batch of ['runDiscovery', 'runPatterns']) {
    assert.ok(
      !new RegExp(`\\b${batch}\\s*\\(`).test(body),
      `handleProject 가 ${batch} 를 부른다. `
      + '워크스페이스 전체를 훑는 배치를 콘텐츠 한 건마다 부르면 안 된다. '
      + '해석은 버튼(/api/ci/patterns/recompute)이나 배치 워커(/api/ci/internal/worker/discover)의 일이다',
    )
  }
})

test('배치를 부르는 길은 파생값 계산 밖에만 있다', () => {
  // 지웠는지가 아니라 **어디로 옮겼는지**를 확인한다. 둘 다 사라지면 기능이 죽은 것이고,
  // 그것은 이 항목이 하려던 일이 아니다.
  assert.ok(
    /\bimport\b[^;]*\brunDiscovery\b/.test(
      readFileSync(join(process.cwd(), 'app/api/ci/internal/worker/discover/route.ts'), 'utf8'),
    ),
    '배치 워커가 runDiscovery 를 안 부른다. 발견을 돌릴 길이 아예 없어졌다',
  )
  assert.ok(
    /\bimport\b[^;]*\brunDiscovery\b/.test(
      readFileSync(join(process.cwd(), 'app/api/ci/patterns/recompute/route.ts'), 'utf8'),
    ),
    '버튼이 runDiscovery 를 안 부른다. 사람이 발견을 돌릴 길이 없어졌다',
  )
})

test('runDiscovery 의 예산 인자에 기본값이 없다', () => {
  const sig = stages.slice(
    stages.indexOf('export async function runDiscovery('),
    stages.indexOf('): Promise<StageResult>', stages.indexOf('export async function runDiscovery(')),
  )

  assert.ok(
    /opts:\s*\{[^}]*maxSetsPerTopic:\s*number/.test(sig.replace(/\/\*[\s\S]*?\*\//g, '')),
    'maxSetsPerTopic 이 필수가 아니다. '
    + '선택이면 「안 정해도 도는 길」이 남고, 언젠가 한 곳이 그 길로 전체 배치를 부른다',
  )
  assert.ok(
    !/opts\?:/.test(sig.replace(/\/\*[\s\S]*?\*\//g, '')),
    'opts 자체가 선택이다. runDiscovery(workspaceId) 한 줄이 다시 가능해진다',
  )
})

test('예산 없이 부르면 조용히 기본값을 채우지 않고 멈춘다', async () => {
  // stages.ts 는 Supabase 클라이언트를 끌어와 여기서 못 부른다.
  // 그래서 판정은 순수 계층에 두고 stages 가 그것을 부르는지는 아래에서 소스로 확인한다.
  const { assertDiscoveryBudget, DEFAULT_MAX_SETS } = await import('../analysis/discovery.ts')

  for (const bad of [undefined, null, {}, { maxSetsPerTopic: 0 }, { maxSetsPerTopic: 1.5 }]) {
    assert.throws(
      () => assertDiscoveryBudget(bad as { maxSetsPerTopic?: number } | undefined),
      /maxSetsPerTopic/,
      `${JSON.stringify(bad)} 로 불렀는데 안 멈췄다`,
    )
  }
  assert.doesNotThrow(() => assertDiscoveryBudget({ maxSetsPerTopic: DEFAULT_MAX_SETS }))
})

test('runDiscovery 가 그 판정을 실제로 부른다', () => {
  const body = bodyOf(stages, 'runDiscovery')
  assert.match(
    body,
    /assertDiscoveryBudget\s*\(\s*opts\s*\)/,
    'runDiscovery 가 예산 판정을 안 부른다. 판정만 있고 아무도 안 부르면 없는 것과 같다',
  )
})
