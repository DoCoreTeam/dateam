/**
 * 창구 인구조사 가드 — 「만들고 안 부름」이 늘지 않게 (정책 F-3 · F-4)
 *
 * ## 왜 가드가 필요한가
 *
 * 창구를 만들고 화면에 안 꽂는 실패가 이 저장소에서 여러 판 반복됐다 — AI 트레이딩
 * 여덟 자리, RFP 엔진 둘, 회의 삭제 로직. **그때마다 tsc·lint·시험·빌드가 전부 초록이었다.**
 * 조각이 다 있고 이어지지 않은 것은 코드 검사로 영원히 못 잡는다.
 *
 * ## 무엇을 세나
 *
 * `scripts/route-census.mjs` 와 **같은 기준**이다 — 창구 경로가 화면·훅·서버 액션
 * 어디에도 안 적힌 것. 「안 불린다」가 아니라 「안 적혀 있다」를 센다. 그 이유와 한계는
 * `docs/policy/feature-coverage.md` 와 그 스크립트 머리에 적혀 있다.
 *
 * 세는 규칙이 두 벌이 되면 어긋나므로 **스크립트를 불러 쓴다.**
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const WEB = join(import.meta.dirname, '..', '..')
const SCRIPT = join(WEB, 'scripts', 'route-census.mjs')
const DOC = join(WEB, '..', '..', 'docs', 'policy', 'feature-coverage.md')

/**
 * 지금 값. 줄이는 것은 자유이고 **늘리려면 이 숫자를 고치면서 사유를 적게** 된다.
 * 0 으로 만들려면 창구를 지우거나 화면에 꽂아야 하므로, ratchet 이 아니라 손으로 둔다.
 */
const EXPECTED = 11

function census(): number {
  const out = execFileSync('node', [SCRIPT], { cwd: WEB, encoding: 'utf8' })
  const m = out.match(/CENSUS_UNEXPLAINED=(\d+)/)
  assert.ok(m, '조사 스크립트가 기계가 읽을 줄을 안 찍는다')
  return Number(m[1])
}

test('★ 설명이 안 붙는 창구가 지금보다 늘지 않는다 (F-3)', () => {
  const now = census()
  assert.ok(
    now <= EXPECTED,
    `설명이 안 붙는 창구가 ${EXPECTED}개에서 ${now}개로 늘었다.\n` +
      '  창구를 만들었으면 화면에 꽂거나, 크론·공개 API 처럼 부를 자리가 다른 것이면\n' +
      '  scripts/route-census.mjs 의 분류에 사유와 함께 넣는다.\n' +
      `  돌려 보기: cd apps/web && node scripts/route-census.mjs`,
  )
})

test('★ 줄었으면 적힌 숫자도 같이 내린다 — 문서와 가드가 갈라지지 않게', () => {
  const now = census()
  assert.equal(
    now, EXPECTED,
    now < EXPECTED
      ? `창구가 ${now}개로 줄었다. 이 파일의 EXPECTED 와 docs/policy/feature-coverage.md 의 표를 함께 내린다`
      : `세는 값과 적힌 값이 다르다`,
  )
})

test('★ 조사 스크립트와 문서가 실재한다 — 없는 것을 가리키면 규칙이 헛말이다', () => {
  assert.ok(existsSync(SCRIPT), 'scripts/route-census.mjs 가 없다')
  assert.ok(existsSync(DOC), 'docs/policy/feature-coverage.md 가 없다')
  const doc = readFileSync(DOC, 'utf8')
  assert.match(doc, /route-census\.mjs/, '문서가 세는 방법을 안 가리킨다')
  assert.match(doc, new RegExp(`\\*\\*${EXPECTED}개\\*\\*`), `문서의 수가 ${EXPECTED} 와 다르다`)
})
