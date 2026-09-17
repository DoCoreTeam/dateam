/**
 * 패키지 넷이 저장소 밖에서도 쓸 수 있는 모양인가
 *
 * **왜**: 이 넷은 우리 앱 안에서만 도는 동안 `private: true` 와 판 번호 `0.0.0` 이었다.
 * 그 상태로는 사내 레지스트리에도 못 올라가고, 올라간다 해도 받는 쪽이 **무엇을 받았는지**
 * 알 길이 없다 — 이름만 있고 설명도 라이선스도 판도 없으니까.
 *
 * 그런데 빠뜨리기 쉬운 것이 그 중 하나만이 아니다. 판을 안 올리면 받는 쪽이 옛것을 계속 쓰고,
 * 시험 파일을 같이 실으면 남의 저장소에서 우리 시험이 돌고, `access` 를 안 잡으면
 * **사내용이 공개 레지스트리로 나간다.** 셋 다 조용히 지나간다.
 *
 * 그래서 출시 모양을 여기서 센다. 새 패키지를 더하면 이 검사가 바로 붙는다.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const PKG_DIR = join(ROOT, 'packages')

interface Manifest {
  name?: string
  version?: string
  description?: string
  license?: string
  private?: boolean
  exports?: unknown
  files?: string[]
  repository?: unknown
  publishConfig?: { access?: string }
  scripts?: Record<string, string>
}

function packages(): { dir: string; m: Manifest }[] {
  return readdirSync(PKG_DIR)
    .filter((n) => statSync(join(PKG_DIR, n)).isDirectory())
    .filter((n) => existsSync(join(PKG_DIR, n, 'package.json')))
    .sort()
    .map((n) => ({ dir: n, m: JSON.parse(readFileSync(join(PKG_DIR, n, 'package.json'), 'utf8')) as Manifest }))
}

test('★ 패키지마다 출시에 필요한 것이 다 있다', () => {
  const missing: string[] = []
  for (const { dir, m } of packages()) {
    const need = (cond: boolean, what: string) => { if (!cond) missing.push(`${dir}: ${what}`) }
    need(typeof m.name === 'string' && m.name.length > 0, '이름')
    need(typeof m.version === 'string' && m.version !== '0.0.0', '판 번호 (0.0.0 은 아직 안 낸 것이다)')
    need(typeof m.description === 'string' && m.description.trim().length > 10, '무엇을 하는 것인지 한 줄')
    need(typeof m.license === 'string' && m.license.length > 0, '라이선스')
    need(m.private !== true, '올릴 수 있는 상태 (private 이면 못 올린다)')
    need(Boolean(m.exports), '들어오는 문 (exports)')
    need(Boolean(m.repository), '어디서 왔는지 (repository)')
  }
  assert.deepEqual(missing, [], [
    '받는 쪽이 무엇을 받았는지 알 수 없는 패키지가 있다:',
    ...missing.map((s) => `  ${s}`),
  ].join('\n'))
})

test('★ 실수로 공개 레지스트리에 나가지 않는다', () => {
  /*
    이 넷은 사내용이다. `access` 를 안 잡으면 스코프 설정에 따라 **공개로 나간다** —
    그때는 되돌릴 수가 없다(npm 은 올린 판을 지워도 이름을 못 되돌린다).
  */
  const open = packages().filter(({ m }) => m.publishConfig?.access !== 'restricted')
  assert.deepEqual(open.map((p) => p.dir), [],
    `publishConfig.access 가 restricted 가 아니다: ${open.map((p) => p.dir).join(', ')}`)
})

test('★ 시험 파일은 싣지 않는다', () => {
  // 받는 쪽 저장소에서 우리 시험이 돌면, 우리 잘못이 남의 파이프라인을 깨뜨린다
  const bad: string[] = []
  for (const { dir, m } of packages()) {
    const files = m.files ?? []
    if (!files.some((f) => f.startsWith('!') && f.includes('.test.'))) bad.push(dir)
  }
  assert.deepEqual(bad, [], `files 에서 시험 파일을 안 뺀다: ${bad.join(', ')}`)
})

test('★ 라이선스 글이 실제로 있다', () => {
  // 「SEE LICENSE IN」 이라고 적어 두고 그 파일이 없으면 라이선스가 없는 것이다
  assert.ok(existsSync(join(PKG_DIR, 'LICENSE')), 'packages/LICENSE 가 없다')
  const text = readFileSync(join(PKG_DIR, 'LICENSE'), 'utf8')
  assert.ok(text.length > 200, '라이선스 글이 너무 짧다')
  for (const { dir, m } of packages()) {
    if (!(m.license ?? '').startsWith('SEE LICENSE IN')) continue
    const rel = (m.license ?? '').replace('SEE LICENSE IN', '').trim()
    assert.ok(existsSync(join(PKG_DIR, dir, rel)), `${dir}: 라이선스가 가리키는 ${rel} 가 없다`)
  }
})

test('규칙이 도는 대상이 실제로 있다', () => {
  // 경로가 깨져 0개가 되면 위 검사 전부가 «위반 없음» 으로 통과한다
  const found = packages()
  assert.ok(found.length >= 4, `패키지를 ${found.length}개만 찾았다`)
  for (const { m } of found) assert.match(String(m.name), /^@ax\//)
})
