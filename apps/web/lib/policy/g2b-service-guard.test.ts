/**
 * 공공데이터포털 주소가 등록부를 지나는지 본다
 *
 * **왜**: 키는 하나인데 활용 신청은 서비스마다 따로이고 일일 한도도 따로다.
 *   주소를 코드 여기저기 적으면 **어느 서비스를 쓰고 있는지 세는 곳이 사라진다.**
 *   그러면 신청 안 된 서비스를 부르고도 왜 안 되는지 못 말하고,
 *   한도를 넘겨 수집이 멈춰도 어느 서비스가 멈췄는지 모른다.
 *
 * 검사 셋:
 *   1) 포털 주소는 등록부에만 있다
 *   2) 등록된 서비스마다 무엇을 주는지가 적혀 있다
 *   3) 규칙이 도는 대상이 실제로 있다
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { G2B_SERVICES } from '../rfp/g2b/services.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 주소를 들고 있어도 되는 자리 */
const ALLOWED = new Set([
  'lib/rfp/g2b/services.ts',
  // 지금 쓰는 서비스의 주소. 등록부와 같은지 services.test.ts 가 묶어 두고 있다
  'lib/rfp/g2b/client.ts',
])

const PORTAL = /https:\/\/apis\.data\.go\.kr/

function sources(): { rel: string; src: string }[] {
  const out: { rel: string; src: string }[] = []
  const walk = (dir: string) => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      if (name === 'node_modules' || name.startsWith('.next')) continue
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
      if (name.endsWith('.test.ts')) continue
      out.push({ rel: relative(WEB, full), src: readFileSync(full, 'utf8') })
    }
  }
  walk(join(WEB, 'lib'))
  walk(join(WEB, 'app'))
  return out
}

test('★ 포털 주소는 등록부에만 있다', () => {
  const offenders = sources()
    .filter((f) => PORTAL.test(f.src) && !ALLOWED.has(f.rel))
    .map((f) => f.rel)
  assert.deepEqual(offenders, [], [
    '포털 주소를 코드에 직접 적었다. 어느 서비스를 쓰는지 세는 곳이 사라진다:',
    ...offenders.map((o) => `  ${o}`),
    '고치는 법: lib/rfp/g2b/services.ts 의 등록부를 지난다',
  ].join('\n'))
})

test('★ 등록된 서비스마다 무엇을 주는지 적혀 있다', () => {
  const blank = G2B_SERVICES.filter((s) => !s.gives || s.gives.trim().length === 0).map((s) => s.id)
  assert.deepEqual(blank, [], [
    '무엇을 주는지 안 적힌 서비스가 있다. 그러면 왜 신청해야 하는지 아무도 모른다:',
    ...blank.map((b) => `  ${b}`),
  ].join('\n'))

  const noNo = G2B_SERVICES.filter((s) => !/^\d{8}$/.test(s.portalNo)).map((s) => s.id)
  assert.deepEqual(noNo, [], `포털 번호가 이상한 서비스: ${noNo.join(', ')}`)
})

test('규칙이 도는 대상이 실제로 있다', () => {
  // 경로가 깨져 0개가 되면 위 검사는 «위반 없음»으로 통과해 버린다
  assert.ok(sources().length >= 500, `소스를 ${sources().length}개만 찾았다`)
  assert.equal(G2B_SERVICES.length, 6)
  assert.ok(sources().some((f) => ALLOWED.has(f.rel) && PORTAL.test(f.src)), '등록부 자체를 못 찾았다')
})
