// GPU 관리 화면 강조색은 청록 하나, 바탕 위 글자 대비 4.5 이상 (ins_0458 디자인 기준)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const CSS_PATH = path.join(import.meta.dirname, '../../app/(member)/pricing/gpu/board/board.module.css')
const css = readFileSync(CSS_PATH, 'utf8')
const MIN_CONTRAST = 4.5
/** 테마마다 이 화면이 놓이는 밝은 바탕 (globals.css --color-surface --surface-bg --color-bg) */
const SURFACES = ['#ffffff', '#f8fafc', '#eef1f6', '#f8f8f8', '#faf9f5']

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function boardToken(name: string): string {
  const block = css.match(/\.board\s*\{([^}]*)\}/)?.[1] ?? ''
  const value = block.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]
  assert.ok(value, `.board 에 --${name} 이 hex 로 없다`)
  return value
}

test('강조는 --gpu-accent 하나, 화면 규칙에서 --brand 를 직접 안 쓴다', () => {
  const rules = css.replace(/\.board\s*\{[^}]*\}/, '')
  assert.equal(rules.match(/var\(--brand\)/g)?.length ?? 0, 0)
  assert.ok((rules.match(/var\(--gpu-accent\)/g)?.length ?? 0) > 0)
})

test('청록이다 (초록 파랑이 빨강보다 크고 초록이 파랑 이상)', () => {
  const hex = boardToken('gpu-accent')
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  assert.ok(g > r && b > r && g >= b, `${hex} 는 청록이 아니다`)
})

test('강조 글자와 진한 강조 글자가 모든 바탕에서 대비 4.5 이상', () => {
  for (const name of ['gpu-accent', 'gpu-accent-ink']) {
    const fg = boardToken(name)
    for (const bg of SURFACES) {
      assert.ok(contrast(fg, bg) >= MIN_CONTRAST, `${name} ${fg} 대 ${bg} = ${contrast(fg, bg).toFixed(2)}`)
    }
  }
})

test('강조 바탕 위 흰 글자(기본 단추)와 옅은 강조 위 진한 글자(고른 마진)도 4.5 이상', () => {
  assert.ok(contrast('#ffffff', boardToken('gpu-accent')) >= MIN_CONTRAST)
  assert.ok(contrast(boardToken('gpu-accent-ink'), boardToken('gpu-accent-soft')) >= MIN_CONTRAST)
})
