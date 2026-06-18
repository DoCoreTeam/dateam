#!/usr/bin/env node
// 디자인 토큰 가드 — 인라인 style 하드코딩 색/치수 + rgba/raw-input/미정의토큰 재유입 검사.
// 사용: node scripts/check-design-tokens.mjs  (CI/pre-commit 연결). 잔여 발견 시 exit 1.
// 정책(DECISION-20260609-guard-ratchet): hex는 즉시 하드페일. rgba/raw-input/미정의토큰은
//   baseline ratchet — 기존 위반(.design-guard-baseline.json)은 추적만, baseline에 없는 신규만 차단.
//   baseline 재생성: node scripts/check-design-tokens.mjs --update-baseline
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ALLOW_HEX = new Set([
  '#fcd34d', '#ffffff', '#0a0a0a', '#f8f8f6', '#efede8',
  '#ec4899', '#fbcfe8',
])
const roots = ['apps/web/app', 'apps/web/components']
const BASELINE_PATH = 'scripts/.design-guard-baseline.json'
const UPDATE = process.argv.includes('--update-baseline')

function walk(d, a) {
  for (const e of readdirSync(d)) {
    const p = join(d, e); const s = statSync(p)
    if (s.isDirectory()) { if (p.includes('/api') || e === 'node_modules' || e === '.next') continue; walk(p, a) }
    else if (/\.(tsx)$/.test(e)) a.push(p)
  }
}

const files = []
for (const r of roots) walk(r, files)

const hardHex = []          // 즉시 차단
const swrMutate = []        // 즉시 차단 — swr 모듈 레벨 전역 mutate import
const ratchet = []          // baseline 대조 대상 {key, desc}

// swr 모듈 레벨 전역 mutate import 금지 — SWRProvider 영속캐시 인스턴스를 못 건드려 "저장 후
// 새로고침해야 목록 반영" 회귀를 유발(v0.7.178/0.7.180 사고). 반드시 useSWRConfig().mutate 사용.
// import {...} from 'swr' 구문(import x, {...} 포함, 멀티라인 허용 — 세미콜론 미포함)에 mutate가 있으면 차단.
// (정상: import { useSWRConfig } 후 const { mutate } = useSWRConfig() — import에 mutate 토큰 없음 → 미검출)
const swrMutateRe = /import\s+[^;]*?from\s+['"]swr['"]/g

const hexRe = /#[0-9a-fA-F]{6}\b/g
const rgbaRe = /\brgba?\(/g
// 미정의 토큰: 크기성인데 --text-* (정의 안 됨, --fs-* 써야 함). --text/--text-muted/--text-faint는 정의됨.
const badTokenRe = /var\(--text-(xs|sm|md|lg|xl|2xl|3xl)\b/g
// raw 입력: input-field 클래스 없는 <input|select|textarea (type=hidden/checkbox/radio 제외 — 토글류는 필드 스타일 비대상)
// input-field 외에 filter-bar 전용 스타일 클래스(filter-search/filter-select)도 정식 필드 디자인으로 인정.
const rawInputRe = /<(input|select|textarea)\b(?![^>]*\b(?:input-field|filter-search|filter-select)\b)(?![^>]*type=["'](?:hidden|checkbox|radio)["'])/g

for (const f of files) {
  const text = readFileSync(f, 'utf8')
  const lines = text.split('\n')
  for (const m of text.matchAll(swrMutateRe)) {
    if (/\{[^}]*\bmutate\b[^}]*\}/.test(m[0])) {
      const lineNo = text.slice(0, m.index).split('\n').length
      swrMutate.push(`${f}:${lineNo}  swr 전역 mutate import 금지 → useSWRConfig().mutate 사용`)
    }
  }
  lines.forEach((line, i) => {
    for (const m of line.matchAll(hexRe)) {
      if (!ALLOW_HEX.has(m[0].toLowerCase())) hardHex.push(`${f}:${i + 1}  hex ${m[0]}`)
    }
    if (/\b[0-9.]+px solid #[0-9a-fA-F]{3,6}\b/.test(line)) hardHex.push(`${f}:${i + 1}  border literal(width+color)`)
    for (const m of line.matchAll(rgbaRe)) ratchet.push({ key: `${f}::rgba`, desc: `${f}:${i + 1}  rgba 인라인색` })
    for (const m of line.matchAll(badTokenRe)) ratchet.push({ key: `${f}::badtoken::${m[0]}`, desc: `${f}:${i + 1}  미정의 토큰 ${m[0]})` })
    for (const m of line.matchAll(rawInputRe)) ratchet.push({ key: `${f}::rawinput::${m[1]}`, desc: `${f}:${i + 1}  raw <${m[1]}> (input-field 누락)` })
  })
}

// 파일별 rgba는 key를 file::rgba 로 묶음(라인 이동에 견고). 신규 파일/카테고리만 차단.
const currentKeys = [...new Set(ratchet.map((r) => r.key))]

if (UPDATE) {
  writeFileSync(BASELINE_PATH, JSON.stringify(currentKeys.sort(), null, 2) + '\n')
  console.log(`✅ baseline 갱신 — ${currentKeys.length}개 키 기록 (${BASELINE_PATH})`)
  process.exit(0)
}

const baseline = existsSync(BASELINE_PATH) ? new Set(JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))) : new Set()
const newRatchet = ratchet.filter((r) => !baseline.has(r.key))

let failed = false
if (swrMutate.length) {
  failed = true
  console.error(`❌ [swr] 전역 mutate import ${swrMutate.length}건 (useSWRConfig().mutate로 교체):`)
  for (const v of swrMutate.slice(0, 40)) console.error('  ' + v)
}
if (hardHex.length) {
  failed = true
  console.error(`❌ [hex] 하드코딩 색/치수 ${hardHex.length}건:`)
  for (const v of hardHex.slice(0, 40)) console.error('  ' + v)
}
if (newRatchet.length) {
  failed = true
  console.error(`❌ [ratchet] baseline에 없는 신규 위반 ${newRatchet.length}건 (토큰/공용컴포넌트 사용):`)
  for (const v of newRatchet.slice(0, 40)) console.error('  ' + v.desc)
}
if (failed) process.exit(1)

const tracked = ratchet.length
console.log(`✅ 디자인 토큰 가드 통과 — hex 0, 신규 ratchet 위반 0 (baseline 추적 ${tracked}건 = 마이그레이션 잔여)`)
