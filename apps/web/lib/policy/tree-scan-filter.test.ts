import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { stripComments } from '../ui/component-scan.ts'

/**
 * 훑는 가드가 **어디까지 거르는지**를 기계가 들고 있다
 *
 * ## 왜 이 파일이 생겼나
 *
 * 2026-10-03 실측: `readdirSync` 로 트리를 훑는 시험이 90개인데 그중 56개가
 * `node_modules` 도 점으로 시작하는 디렉터리도 **안 거른다.**
 * 지금은 `lib/trading` 처럼 좁은 뿌리만 훑어서 터지지 않는다 — 그 안에 `node_modules` 가 없다.
 *
 * 뿌리가 하나 넓어지는 날 그 자리에서 터진다. `apps/web` 을 훑으면 `node_modules` 수만 개와
 * `.next-*` 빌드판 수 기가를 읽으러 들어간다. 그러면 「가드가 느리다」로 읽히고,
 * 느린 가드는 안 돌리게 되고, 안 돌리는 가드는 없는 것과 같다 — P0107 에서 한 파일이
 * 실제로 그렇게 전체 시험의 아흔 몇 퍼센트를 먹고 있었다.
 *
 * ## 이 파일은 56개를 고치지 않는다
 *
 * 고치는 일은 별건이다(56파일을 한 번에 건드리는 것). 이 파일이 하는 일은
 * **무엇이 걸려 있는지를 보이게 하고, 그 수가 늘지 않게 하는 것**이다.
 * 「나중에」로 적어 둔 항목은 안 지켜져도 아무도 모른다 —
 * 그래서 문서가 아니라 목록을 가드가 든다.
 *
 * 아래 목록은 **작업 지시서**이기도 하다. 56파일에 거르는 줄을 넣는 날 이 목록을 그대로 쓴다.
 */

const WEB = join(import.meta.dirname, '..', '..')

/** 시험 파일을 찾을 뿌리 */
const ROOTS = ['lib', 'app', 'prisma', 'e2e'] as const

/** 자기 자신. 목록을 문자열로 들고 있어 검사 대상이 되면 영원히 빨갛다 */
const SELF = 'lib/policy/tree-scan-filter.test.ts'

function testFiles(): string[] {
  const out: string[] = []
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(WEB, rel))) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const next = `${rel}/${name}`
      if (statSync(join(WEB, next)).isDirectory()) { walk(next); continue }
      if (name.endsWith('.test.ts') || name.endsWith('.test.tsx')) out.push(next)
    }
  }
  for (const r of ROOTS) {
    try { walk(r) } catch { /* 없는 뿌리는 넘어간다 */ }
  }
  return out.sort()
}

/** `node_modules` 를 건너뛰나 */
const SKIPS_NODE_MODULES = /node_modules/
/** 점으로 시작하는 디렉터리를 건너뛰나 */
const SKIPS_DOT_DIRS = /startsWith\(\s*['"]\.['"]\s*\)/

/**
 * 트리를 훑으면서 둘 다 안 거르는 시험들.
 *
 * **고쳤으면 이 목록에서 빼야 한다.** 고친 뒤에도 줄이 남아 있으면 아래 단정이 빨개진다 —
 * 죽은 줄을 남기면 목록이 사실을 말하지 않게 되고, 사실을 말하지 않는 목록은 다음 사람을 속인다.
 */
const SCANS_WITHOUT_FILTER: readonly string[] = [
  'lib/ai-chat/nav/groups.test.ts',
  'lib/api-docs/registry.test.ts',
  'lib/auth/admin-audit.test.ts',
  'lib/auth/api-route-auth.test.ts',
  'lib/auth/api-user-gate.test.ts',
  'lib/ci/crud-coverage.test.ts',
  'lib/crm/domain/money-ssot.test.ts',
  'lib/crm/nav/groups.test.ts',
  'lib/daily/soft-delete-guard.test.ts',
  'lib/datetime/kst-guard.test.ts',
  'lib/policy/access-surface.test.ts',
  'lib/policy/ai-layer-docs-guard.test.ts',
  'lib/policy/ai-pairing-guard.test.ts',
  'lib/policy/api-auth-surface.test.ts',
  'lib/policy/export-gate.test.ts',
  'lib/policy/forming-bar-isolation.test.ts',
  'lib/policy/package-docs-guard.test.ts',
  'lib/policy/package-release-guard.test.ts',
  'lib/policy/rfp-layer-guard.test.ts',
  'lib/policy/rls-baseline.test.ts',
  'lib/policy/test-db-safety.test.ts',
  'lib/policy/trading-backtest-parity.test.ts',
  'lib/policy/trading-knowledge-guard.test.ts',
  'lib/policy/trading-no-order-guard.test.ts',
  'lib/policy/trading-operator-guard.test.ts',
  'lib/policy/trading-order-guard.test.ts',
  'lib/policy/trading-page-split.test.ts',
  'lib/policy/trading-signal-order-guard.test.ts',
  'lib/policy/version-rule.test.ts',
  'lib/terms/terms.test.ts',
  'lib/trading/backtest/run.test.ts',
  'lib/trading/broker/account.test.ts',
  'lib/trading/broker/kis-client.test.ts',
  'lib/trading/calendar/night-signal.test.ts',
  'lib/trading/calendar/night.test.ts',
  'lib/trading/chart/series.test.ts',
  'lib/trading/jobs/watch.test.ts',
  'lib/trading/judge/jev.test.ts',
  'lib/trading/judge/rule.test.ts',
  'lib/trading/knowledge/as-of.test.ts',
  'lib/trading/knowledge/explain.test.ts',
  'lib/trading/notify/outbox.test.ts',
  'lib/trading/operator/handoff.test.ts',
  'lib/trading/overview-gate.test.ts',
  'lib/trading/settings/registry.test.ts',
  'lib/trading/signal/ack.test.ts',
  'lib/trading/signal/emit.test.ts',
  'lib/trading/validation/pipeline-core.test.ts',
  'lib/ui/crm-delete-standard.test.ts',
  'lib/ui/doc-export-standard.test.ts',
  'lib/ui/font-loading.test.ts',
  'lib/ui/ime-guard.test.ts',
  'lib/ui/integration-consistency.test.ts',
  'lib/ui/picker-standard.test.ts',
  'lib/ui/write-permission.test.ts',
  'lib/weekly-report/single-writer-guard.test.ts',
]

/**
 * 둘 다 안 거르면서 트리를 훑는 시험을 실제로 센다.
 *
 * **주석은 떼고 본다.** 「node_modules 는 걸러야 한다」고 주석에 적어 두면 통과하는 가드는
 * 가드가 아니다 — 이 저장소에서 CSP 가드가 지시문을 지우고 주석에 남긴 판을 초록으로
 * 통과시킨 전례가 있다. 오늘은 그런 파일이 0개지만(실측: 주석 포함 56 · 주석 떼고 56),
 * 막아 두지 않으면 내일 생긴다.
 */
function offenders(): string[] {
  return testFiles().filter((f) => {
    if (f === SELF) return false
    const src = stripComments(readFileSync(join(WEB, f), 'utf8'))
    if (!src.includes('readdirSync')) return false
    return !SKIPS_NODE_MODULES.test(src) && !SKIPS_DOT_DIRS.test(src)
  })
}

describe('훑는 가드 — 어디까지 거르는지', () => {
  it('★ 훑는 시험을 손목록이 아니라 트리에서 찾는다', () => {
    const files = testFiles()
    assert.ok(files.length > 600, `시험 파일을 ${files.length}개밖에 못 찾았다 — 뿌리가 바뀌었는지 확인한다`)
    const scanners = files.filter((f) => stripComments(readFileSync(join(WEB, f), 'utf8')).includes('readdirSync'))
    assert.ok(scanners.length > 50, `훑는 시험을 ${scanners.length}개밖에 못 찾았다 — 규칙이 헛돈다`)
  })

  it('★ 거르지 않는 목록이 실측과 정확히 같다 — 새로 들어오면 여기서 걸린다', () => {
    const now = offenders()

    const added = now.filter((f) => !SCANS_WITHOUT_FILTER.includes(f))
    assert.deepEqual(
      added, [],
      `트리를 훑으면서 node_modules 와 점 디렉터리를 안 거르는 시험이 새로 생겼다:\n  ${added.join('\n  ')}\n\n`
        + 'walk 안에 다음 한 줄을 넣는다:\n'
        + "  if (name === 'node_modules' || name.startsWith('.')) continue\n\n"
        + '좁은 뿌리만 훑는 동안은 안 터지지만, 뿌리가 하나 넓어지는 날 node_modules 수만 개와\n'
        + '.next-* 빌드판 수 기가를 읽으러 들어간다. 그러면 그 가드는 안 돌리게 된다.',
    )

    const stale = SCANS_WITHOUT_FILTER.filter((f) => !now.includes(f))
    assert.deepEqual(
      stale, [],
      `이미 고쳤는데 목록에 남아 있다:\n  ${stale.join('\n  ')}\n\n`
        + 'SCANS_WITHOUT_FILTER 에서 그 줄을 지운다. 죽은 줄을 남기면 목록이 사실을 말하지 않는다.',
    )
  })

  it('★ 그 수가 줄기만 한다 — 이 숫자가 오르는 판은 통과하지 않는다', () => {
    /*
      기준값은 2026-10-03 실측이다. P0107 에서 trading-wiring-guard 하나를 고쳐 57 에서 56 이 됐다.
      올리지 않는다 — 올리면 그것은 기준이 아니라 현재값을 베낀 것이고, 베낀 기준은 아무것도 막지 않는다.
    */
    assert.ok(
      SCANS_WITHOUT_FILTER.length <= 56,
      `거르지 않는 훑는 시험이 ${SCANS_WITHOUT_FILTER.length}개다 — 기준 56 보다 많다, 기준을 올리지 말고 거르는 줄을 넣는다`,
    )
  })

  it('거르기를 보는 가드가 자기 뿌리를 다 훑고도 빠르다', () => {
    /*
      이 가드가 느리면 그 자체가 모순이다 — 거르라고 말하는 쪽이 안 거르고 있는 것이다.
      파일을 한 번만 읽고 정규식 둘만 돌리므로 초 단위를 넘길 자리가 없다.
    */
    const before = process.hrtime.bigint()
    offenders()
    const seconds = Number(process.hrtime.bigint() - before) / 1e9
    assert.ok(seconds < 5, `훑고 읽는 데 ${seconds.toFixed(1)}초 걸렸다 — 거르기가 빠진 자리가 있는지 본다`)
  })
})
