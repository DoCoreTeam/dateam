import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveTheme } from './themes.ts'

// resolveTheme(userPref, globalDefault): 개인 선택 우선, 무효/없음이면 디폴트 폴백

test('유효한 개인 테마는 그대로 반환', () => {
  assert.equal(resolveTheme('mono', 'nb'), 'mono')
  assert.equal(resolveTheme('classic', 'nb'), 'classic')
  assert.equal(resolveTheme('nb', 'classic'), 'nb')
})

test('null/undefined 개인 테마는 전역 디폴트로 폴백', () => {
  assert.equal(resolveTheme(null, 'classic'), 'classic')
  assert.equal(resolveTheme(undefined, 'mono'), 'mono')
})

test('무효값(레지스트리에 없는 id)은 전역 디폴트로 폴백', () => {
  assert.equal(resolveTheme('does-not-exist', 'nb'), 'nb')
  assert.equal(resolveTheme('', 'classic'), 'classic')
  assert.equal(resolveTheme('NB', 'mono'), 'mono') // 대소문자 구분
})

// ── 등재한 테마는 globals.css 에 실제로 있어야 한다 ──
//
// 테마는 «배열 1줄 + globals.css `[data-theme="id"]` 블록» 한 쌍이다.
// 한쪽만 있으면 목록에는 뜨는데 골라도 아무 일이 안 일어난다 — 사용자는 고장으로 읽는다.
// (실측 v0.7.716: AI 스튜디오에 색을 직접 박았더니 그 화면에서 테마 선택이 죽었다.
//  색은 표면이 아니라 테마가 정한다.)

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { THEMES } from './themes.ts'

const GLOBALS = readFileSync(join(import.meta.dirname, '..', 'app', 'globals.css'), 'utf8')

test('★ 등재한 테마마다 globals.css 블록이 있다 (골라도 아무 일 없으면 고장으로 읽힌다)', () => {
  for (const t of THEMES) {
    if (t.id === 'nb') continue // 기본 테마는 :root 가 곧 자기 블록이다
    assert.ok(
      GLOBALS.includes(`[data-theme="${t.id}"] {`),
      `${t.label}(${t.id}) 의 토큰 블록이 globals.css 에 없다`,
    )
  }
})

test('★ 표면 스킨이 색을 다시 정의하지 않는다 — 그 화면에서만 테마가 죽는다', () => {
  const skin = readFileSync(
    join(import.meta.dirname, '..', 'app', '(ai)', 'studio.module.css'),
    'utf8',
  )
  assert.doesNotMatch(skin, /--(brand|color-bg|text|ink|sidebar-bg|surface-bg)\s*:/,
    'AI 스튜디오 스킨이 색 토큰을 다시 정의하고 있다 — 색은 [data-theme] 의 일이다')
})
