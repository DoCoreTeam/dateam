#!/usr/bin/env node
// 전면 토큰화 codemod (identity 전용) — 명세: docs/2026-06-08-tokenization-spec
// 원칙: 각 hex → 토큰 값이 그 hex와 "정확히 동일"한 경우에만 매핑(identity). → 시각 무회귀 100% 보장.
// 값이 다른 변형색(예: #10b981, #92400e)은 매핑하지 않고 hex로 남긴다(회귀 0).
// 제외: apps/web/app/api/**, globals.css의 --토큰 정의 라인, KEEP set.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// hex(소문자) → 토큰. globals.css :root에 동일 값으로 정의된 것만(identity).
const MAP = {
  '#0f172a': '--text',
  '#64748b': '--text-muted',
  '#94a3b8': '--text-faint',
  '#f8fafc': '--surface-bg',
  '#f1f5f9': '--surface-muted',
  '#e2e8f0': '--border-light',
  '#cbd5e1': '--border-subtle',
  '#7c3aed': '--brand',
  '#f3effe': '--brand-soft',
  '#ede9fe': '--brand-soft-2',
  '#16a34a': '--success', '#f0fdf4': '--success-bg', '#bbf7d0': '--success-border',
  '#dc2626': '--danger', '#fef2f2': '--danger-bg', '#fecaca': '--danger-border',
  '#d97706': '--warning', '#fffbeb': '--warning-bg', '#fde68a': '--warning-border',
  '#2563eb': '--info', '#eff6ff': '--info-bg', '#bfdbfe': '--info-border',
}
const KEEP = new Set(['#fcd34d', '#ffffff', '#0a0a0a', '#f8f8f6', '#efede8'])

const hexRe = /#[0-9a-fA-F]{6}\b/g
function repl(text, isCss) {
  let n = 0
  const out = text.split('\n').map((line) => {
    if (isCss && /^\s*--/.test(line)) return line // 토큰 정의 라인 보호(순환참조 방지)
    return line.replace(hexRe, (m) => {
      const k = m.toLowerCase()
      if (KEEP.has(k)) return m
      const tok = MAP[k]
      if (!tok) return m
      n++
      return `var(${tok})`
    })
  }).join('\n')
  return [out, n]
}

function walk(dir, acc) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (p.includes('/api')) continue
      if (e === 'node_modules' || e === '.next') continue
      walk(p, acc)
    } else if (/\.(tsx|ts)$/.test(e)) acc.push(p)
  }
}

const files = []
walk('apps/web/app', files)
walk('apps/web/components', files)
let total = 0, changed = 0
for (const f of files) {
  const s = readFileSync(f, 'utf8')
  const [o, n] = repl(s, false)
  if (n) { writeFileSync(f, o); total += n; changed++ }
}
{
  const f = 'apps/web/app/globals.css'
  const s = readFileSync(f, 'utf8')
  const [o, n] = repl(s, true)
  if (n) { writeFileSync(f, o); total += n; changed++ }
}
console.log(`tokenize(identity): ${total}건 치환 / ${changed}파일`)
