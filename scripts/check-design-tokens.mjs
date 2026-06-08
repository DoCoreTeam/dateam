#!/usr/bin/env node
// 디자인 토큰 가드 — 인라인 style에 하드코딩된 색/치수가 재유입되는지 검사.
// 사용: node scripts/check-design-tokens.mjs  (CI/pre-commit에 연결 권장)
// 실패(잔여 발견) 시 exit 1. 예외: api/(데이터팔레트), 의도 보존 색(핑크 등) ALLOW.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ALLOW_HEX = new Set([
  '#fcd34d', '#ffffff', '#0a0a0a', '#f8f8f6', '#efede8',
  // 의도적 이질 액센트(테마 비대상) — 진단 13건
  '#ec4899', '#fbcfe8',
])
const roots = ['apps/web/app', 'apps/web/components']
function walk(d, a){for(const e of readdirSync(d)){const p=join(d,e);const s=statSync(p);if(s.isDirectory()){if(p.includes('/api')||e==='node_modules'||e==='.next')continue;walk(p,a)}else if(/\.(tsx)$/.test(e))a.push(p)}}

const files = []
for (const r of roots) walk(r, files)
const violations = []
// style={{ ... }} 블록 내부만 검사(대략): 'prop: ' 라인에서 hex/치수 리터럴
const hexRe = /#[0-9a-fA-F]{6}\b/g
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n')
  lines.forEach((line, i) => {
    // 색
    for (const m of line.matchAll(hexRe)) {
      if (!ALLOW_HEX.has(m[0].toLowerCase())) violations.push(`${f}:${i + 1}  hex ${m[0]}`)
    }
    // 보더: 너비+색이 모두 하드코딩(#hex)인 경우만 = 진짜 분산. 삼각형(transparent)·동적(${})·토큰색은 허용.
    if (/\b[0-9.]+px solid #[0-9a-fA-F]{3,6}\b/.test(line)) {
      violations.push(`${f}:${i + 1}  border literal(width+color)`)
    }
  })
}
if (violations.length) {
  console.error(`❌ 디자인 토큰 가드 실패 — 하드코딩 ${violations.length}건 (토큰 var(--*) 사용 권장):`)
  for (const v of violations.slice(0, 40)) console.error('  ' + v)
  if (violations.length > 40) console.error(`  …외 ${violations.length - 40}건`)
  process.exit(1)
}
console.log('✅ 디자인 토큰 가드 통과 — 인라인 하드코딩 색/치수 없음')
