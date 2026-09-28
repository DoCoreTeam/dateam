/**
 * 가드 — **말한 곳에는 갈 수 있어야 한다**
 *
 * 실측 2026-09-28: 검증 화면이 「자료 화면에서 모인 봉을 볼 수 있습니다」를 아홉 번
 * 말하는데 링크가 0개였다. 가라고 말해 놓고 길을 안 주면 그 문장은 안내가 아니다.
 *
 * 주소는 사이드바 배치에서 온다. 여기서 주소를 적어 두면 메뉴를 옮긴 날 이 시험만
 * 초록인 채로 안내가 옛 자리를 가리킨다 — 그래서 **배치와 대조**한다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { howHref, GATE_STATUS_LABEL, GATE_HELP, VALIDATION_PAGE_DESCRIPTION } from './labels.ts'
import { evaluateGate } from './criteria.ts'
import { TRADING_NAV } from '../nav/groups.ts'
import { TRADING_APP_DIR } from '../../policy/app-dirs.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

const THRESHOLDS = {
  minValidateTrades: 500, minLockboxTrades: 100, minProfitFactor: 1.25,
  maxDrawdownLimitMultiple: 8, dailyLossLimitKrw: 500_000, minJudgeImprovementR: 0.05,
}

test('★ 「○○ 화면에서」라고 말하면 그 화면 주소가 나온다', () => {
  const data = TRADING_NAV.find((n) => n.href === '/trading/data')
  assert.ok(data, '자료 화면이 배치에서 사라졌다')
  assert.equal(howHref(`${data.label} 화면에서 모인 봉을 볼 수 있습니다`), '/trading/data')
  // 화면 이름이 안 들어간 안내는 길이 없다 — 아무 데나 보내지 않는다
  assert.equal(howHref('앞 관문을 지난 뒤에 열립니다'), null)
  assert.equal(howHref(undefined), null)
  assert.equal(howHref(''), null)
})

test('★ 관문이 실제로 내는 안내 중 화면을 가리키는 줄에 길이 있다', () => {
  const verdict = evaluateGate({
    thresholds: THRESHOLDS,
    validateTradeCount: 0, lockboxTradeCount: 0,
    validateExpectancy: null, lockboxExpectancy: null, harshExpectancyR: null,
    profitFactor: null, maxDrawdownR: null, riskPerTradeKrw: null,
    calibration: null, judgeComparison: null, riskArithmeticOk: null,
  })
  const pointing = verdict.criteria.filter((c) => c.how && /화면에서/.test(c.how))
  assert.ok(pointing.length > 0, '화면을 가리키는 안내가 하나도 없다 — 시험이 아무것도 안 지킨다')
  for (const c of pointing) {
    assert.ok(howHref(c.how), `「${c.label}」의 안내가 화면을 가리키는데 갈 길이 없다: ${c.how}`)
  }
})

test('★ 화면이 그 길을 실제로 그린다 — 만들어만 두지 않는다', () => {
  const src = readFileSync(join(HERE, '..', '..', '..', TRADING_APP_DIR, 'BacktestPanel.tsx'), 'utf8')
  assert.ok(src.includes('howHref('), '길을 찾는 자리를 안 부른다')
  assert.ok(/<Link\s+href=\{href\}/.test(src), '찾아 놓고 링크로 안 그린다 — 여전히 읽고 스스로 찾아가야 한다')
})

test('주소를 화면 파일에 적어 두지 않는다', () => {
  const src = readFileSync(join(HERE, '..', '..', '..', TRADING_APP_DIR, 'BacktestPanel.tsx'), 'utf8')
  assert.doesNotMatch(src, /href="\/trading/, '화면이 주소를 직접 안다 — 메뉴를 옮기면 여기만 옛 자리를 가리킨다')
})

test('상태 이름과 화면 문장은 그대로다', () => {
  assert.equal(GATE_STATUS_LABEL.pass, '통과')
  assert.match(GATE_HELP, /미달/)
  assert.ok(VALIDATION_PAGE_DESCRIPTION.length > 0)
})
