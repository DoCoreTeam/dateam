// GPU 관리 화면은 고른 테마의 색을 그대로 쓴다 (사용자 지적 2026-11-05 「여기만 색깔이 다르네 표준화된 색깔로 해야지 테마도 있는데」)
// 한때 이 화면만 청록으로 토큰을 덮어써서 테마를 바꿔도 이 화면만 안 바뀌었다
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(import.meta.dirname, '../../app/(member)/pricing/gpu/board')
const CSS = readFileSync(path.join(DIR, 'board.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const TSX = readdirSync(DIR).filter((f) => !f.startsWith('.') && f.endsWith('.tsx')).map((f) => [f, readFileSync(path.join(DIR, f), 'utf8')] as const)

/** 테마가 정하는 색 토큰 — 화면이 다시 정의하면 그 화면만 테마에서 떨어진다 */
const THEME_TOKENS = /--(brand|brand-[a-z0-9-]+|color-brand[a-z-]*|gpu-accent[a-z-]*|accent[a-z-]*|text|border[a-z-]*|surface[a-z-]*|color-[a-z-]+)\s*:/

test('화면 CSS 가 테마 색 토큰을 다시 정의하지 않는다', () => {
  assert.equal(CSS.match(new RegExp(THEME_TOKENS.source, 'g'))?.length ?? 0, 0, CSS.match(THEME_TOKENS)?.[0])
})

test('화면 CSS 에 색 값을 직접 적지 않는다 (16진, rgb, hsl)', () => {
  const hits = CSS.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/g) ?? []
  assert.deepEqual(hits, [])
})

test('화면 컴포넌트가 인라인 색을 쓰지 않는다', () => {
  const bad = TSX.filter(([, src]) => /(color|background|borderColor)\s*:\s*['"`]#|#[0-9a-fA-F]{6}\b/.test(src)).map(([f]) => f)
  assert.deepEqual(bad, [])
})

test('강조는 테마 토큰으로 쓴다', () => {
  assert.ok((CSS.match(/var\(--gpu-accent\)|var\(--brand\)/g)?.length ?? 0) > 0)
})
