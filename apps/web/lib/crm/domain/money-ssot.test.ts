/**
 * 금액 변환이 다시 흩어지지 않게 — 정적 가드
 *
 * **왜 필요한가**: `Number.isFinite(n) ? BigInt(Math.round(n)) : BigInt(0)` 이
 * `cost.ts` 와 `booked-amount.ts` 에 **글자까지 똑같이** 두 벌 있었다(v0.7.640 까지).
 * 복붙된 변환은 한쪽만 고쳐지는 날이 오고, 그날부터 원가 쪽 1원과 수주 쪽 1원이 다르다.
 * 그건 결산 때나 발견되고, 그때는 어느 쪽이 맞는지도 알 수 없다.
 *
 * 그래서 **없앤 뒤 잠근다.** 없애기만 하면 다음 사람이 또 만든다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * **`URL.pathname` 을 쓰지 않는다.** 이 저장소 경로에 한글이 들어 있어
 * pathname 은 퍼센트 인코딩된 문자열을 준다 — `readdirSync` 가 못 찾고,
 * 그러면 훑을 파일이 0개가 되어 **가드가 아무것도 안 보고 통과한다.**
 * (실제로 처음 판이 그렇게 «통과»했다)
 */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SSOT = 'lib/crm/domain/money.ts'

/** 검사 대상 — CRM 도메인·서비스·화면 */
const SCAN_DIRS = ['lib/crm', 'app/(crm)', 'app/api/crm']

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(join(ROOT, dir)) } catch { return out }
  for (const e of entries) {
    const rel = `${dir}/${e}`
    const abs = join(ROOT, rel)
    if (statSync(abs).isDirectory()) walk(rel, out)
    else if (/\.tsx?$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(rel)
  }
  return out
}

const FILES = SCAN_DIRS.flatMap((d) => walk(d))

test('가드가 실제로 파일을 훑는다 — 0개를 훑고 통과하면 가드가 아니다', () => {
  assert.ok(FILES.length > 50, `훑은 파일 ${FILES.length}개 — 경로가 틀렸다`)
})

test('★ 금액 변환을 복붙하지 않는다 — toMinor 하나만 쓴다', () => {
  // `BigInt(Math.round(…))` 은 «소수를 금액으로 바꾸는» 자리다. money.ts 밖에서는 쓰지 않는다.
  const offenders: string[] = []
  for (const f of FILES) {
    if (f === SSOT) continue
    const src = readFileSync(join(ROOT, f), 'utf8')
    src.split('\n').forEach((line, i) => {
      // 공수(MM_SCALE)처럼 «금액이 아닌» 정수화는 예외로 표시할 수 있다
      if (line.includes('// minor-ok')) return
      if (/BigInt\(Math\.round\(/.test(line)) offenders.push(`${f}:${i + 1}`)
    })
  }
  assert.deepEqual(offenders, [],
    `금액 변환이 흩어졌다. lib/crm/domain/money.ts 의 toMinor()/pctOfMinor() 를 쓸 것:\n  ${offenders.join('\n  ')}`)
})

test('★ 비율 계산도 한 곳이다 — ratioPct 를 쓴다', () => {
  const offenders: string[] = []
  for (const f of FILES) {
    if (f === SSOT) continue
    const src = readFileSync(join(ROOT, f), 'utf8')
    src.split('\n').forEach((line, i) => {
      if (line.includes('// minor-ok')) return
      // `Math.round(a / b * 1000) / 10` 꼴 — 소수 한 자리 비율
      if (/Math\.round\([^)]*\)\s*\/\s*10\b/.test(line) && /Number\(/.test(line)) {
        offenders.push(`${f}:${i + 1}`)
      }
    })
  }
  assert.deepEqual(offenders, [],
    `비율 계산이 흩어졌다. money.ts 의 ratioPct() 를 쓸 것:\n  ${offenders.join('\n  ')}`)
})

test('SSOT 가 실제로 그 함수들을 내보낸다 — 가드가 없는 것을 지키면 안 된다', () => {
  const src = readFileSync(join(ROOT, SSOT), 'utf8')
  for (const fn of ['toMinor', 'toNum', 'pctOfMinor', 'ratioPct', 'divRound', 'roundToUnit']) {
    assert.ok(new RegExp(`export function ${fn}\\b`).test(src), `${fn} 이 없다`)
  }
})
