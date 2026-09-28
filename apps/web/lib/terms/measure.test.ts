/**
 * 가드 — **입말이 화면으로 돌아오지 않는다**
 *
 * 이 시험이 막는 것은 오타가 아니라 **말투의 재발**이다. 「못 잼」은 한 자리에서 시작해
 * 일곱 자리로 번졌다 — 옆 파일을 보고 따라 적었기 때문이다. 한 번 지운 뒤에도
 * 누가 같은 자리에 같은 말을 다시 적으면 화면은 그날로 다시 섞인다.
 *
 * 이름이 아니라 **값으로** 대조한다. `NOT_MEASURED` 가 무엇인지는 용어집이 정하고
 * 여기서는 그 값이 실제로 화면까지 가는지만 본다 — 상수 이름만 맞춰 두고
 * 안에 옛 말을 넣어 두면 이름을 보는 가드는 초록으로 지나간다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NOT_MEASURED, NOT_MEASURED_SENTENCE, BANNED_MEASURE_WORDS, notMeasuredCount } from './measure.ts'
import { GATE_STATUS_LABEL, GATE_HELP, GATE_HEADLINE_NOT_MEASURED, VALIDATION_PAGE_DESCRIPTION } from '../trading/gate/labels.ts'
import { UNKNOWN_TEXT } from '../trading/position-labels.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..', '..')

test('★ 세 상태가 같은 결의 이름이다', () => {
  // 통과·미달은 명사다. 한 칸만 입말이면 그것이 상태 이름인지 우리가 흘린 말인지 모른다
  assert.equal(GATE_STATUS_LABEL.pass, '통과')
  assert.equal(GATE_STATUS_LABEL.fail, '미달')
  assert.equal(GATE_STATUS_LABEL.insufficient, NOT_MEASURED)
  for (const label of Object.values(GATE_STATUS_LABEL)) {
    assert.doesNotMatch(label, /잼|쟀|잽|잰/, `상태 이름에 입말이 남았다: ${label}`)
  }
})

test('★ 같은 뜻을 쓰는 자리가 모두 한 말을 쓴다', () => {
  assert.equal(UNKNOWN_TEXT, NOT_MEASURED, '손익 칸이 따로 말을 정했다')
  for (const line of [GATE_HELP, GATE_HEADLINE_NOT_MEASURED, VALIDATION_PAGE_DESCRIPTION]) {
    assert.doesNotMatch(line, /잼|쟀|잽|잰|잴 수 없/, `화면 문장에 입말이 남았다: ${line}`)
  }
  // 「측정 전」이 미달로 읽히지 않게 그 차이를 화면이 말해야 한다
  assert.ok(GATE_HELP.includes(NOT_MEASURED) && GATE_HELP.includes('미달'),
    '「측정 전」과 「미달」이 다르다는 말이 화면에 없다')
  assert.ok(NOT_MEASURED_SENTENCE.includes('측정'))
  assert.equal(notMeasuredCount(3), `${NOT_MEASURED} 3건`)
})

/** 화면과 라벨이 사는 곳만 훑는다 (시험·마이그레이션·바뀐 내역은 제외) */
function surfaceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.next-')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { surfaceFiles(full, acc); continue }
    if (!/\.tsx?$/.test(name) || name.endsWith('.test.ts') || name.endsWith('.test.tsx')) continue
    acc.push(full)
  }
  return acc
}

/** 주석을 뺀 코드만 남긴다 — 왜 그 말을 안 쓰는지는 주석에 적을 수 있어야 한다 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

test('★ 옛 말이 화면과 라벨에 남아 있지 않다', () => {
  const roots = [join(WEB, 'lib', 'trading'), join(WEB, 'app', '(trading)'), join(WEB, 'lib', 'terms')]
  const home = join(HERE, 'measure.ts')
  const offenders: string[] = []
  for (const root of roots) {
    for (const file of surfaceFiles(root)) {
      if (file === home) continue
      const code = codeOnly(readFileSync(file, 'utf8'))
      for (const word of BANNED_MEASURE_WORDS) {
        if (code.includes(word)) offenders.push(`${relative(WEB, file)} 「${word}」`)
      }
    }
  }
  assert.deepEqual(offenders, [],
    `입말이 남았다 — 용어집의 NOT_MEASURED 를 쓴다: ${offenders.join(', ')}`)
})
