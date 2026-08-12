#!/usr/bin/env node
// docs/ui-system/scan-screens.mjs — 화면별 UI 구성 전수 스캐너
//
// 왜: "무엇이 어디서 제각각인지"를 사람 기억이 아니라 코드에서 뽑는다.
//   화면을 하나씩 열어보며 고치면 반드시 빠뜨린다(실제로 탭이 그랬다).
// 실행: node docs/ui-system/scan-screens.mjs [--md]

import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../apps/web', import.meta.url))

/** 화면 = app/** 의 page.tsx와 그 옆 View/Client 컴포넌트를 한 덩어리로 본다 */
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '.next' || e === 'api') continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (e.endsWith('.tsx')) out.push(p)
  }
  return out
}

/** 축: 같은 성격의 UI가 어떤 구현으로 그려지는지 */
const AXES = [
  { axis: '탭', std: [/SegmentedTabs/], custom: [/role=["']tablist["']/, /className="[^"]*\b(?:gpu-tabs|gpu-admin-tabs|artifact-tabs|gpu-udetail-tabs|home-dept-toggle)\b/] },
  { axis: '목록·표', std: [/ListSurface/], custom: [/<table/, /DynamicTable/, /NbTable/] },
  { axis: '목록 도구', std: [/ListToolbar/], custom: [/filter-bar|filter-search|filter-select/, /BulkActionBar/, /TrashToggle/] },
  { axis: '페이지 이동', std: [/ListPager/], custom: [/setSize\(|nextCursor|IntersectionObserver/] },
  { axis: '목록 상태', std: [/useListQuery/], custom: [/useState<[^>]*Sort|const \[sort|const \[search|const \[filter/] },
  { axis: '페이지 헤더', std: [/PageHeader/], custom: [/<h1\b/] },
  { axis: '빈 상태', std: [/EmptyState/], custom: [/없습니다|비어 ?있습니다|없어요/] },
  { axis: '오류', std: [/ErrorState/], custom: [/실패했습니다|오류가|불러오지 못/] },
  { axis: '로딩', std: [/Skel(Page|Card|List)|AXDotLoader/], custom: [/불러오는 ?중|로딩 ?중|animation: 'spin|Loader2/] },
  { axis: '모달·패널', std: [/NbModal|SlidePanel|DetailSheet/], custom: [/position: ?'fixed'[^}]*inset|role="dialog"/] },
  { axis: '버튼', std: [/NbButton|btn-primary|btn-ghost/], custom: [/<button style=\{\{/] },
  { axis: '카드', std: [/className="card|className=\{`card/], custom: [/border(?:Radius)?: ?'?var\(--radius/] },
  { axis: '입력', std: [/input-field/], custom: [/<(?:input|select|textarea)(?![^>]*input-field)[^>]*>/] },
]

const files = walk(join(ROOT, 'app'))
/** 화면 키 = 라우트 폴더 */
const screens = new Map()
for (const f of files) {
  const rel = relative(ROOT, f)
  const route = rel.replace(/^app/, '').replace(/\/[^/]+\.tsx$/, '') || '/'
  const key = route.replace(/\((\w+)\)/g, '').replace(/\/+/g, '/') || '/'
  const src = readFileSync(f, 'utf8')
  const entry = screens.get(key) ?? { files: [], src: '' }
  entry.files.push(rel)
  entry.src += '\n' + src
  screens.set(key, entry)
}

const rows = []
for (const [route, { files: fs_, src }] of [...screens].sort()) {
  const cells = AXES.map(({ std, custom }) => {
    const hasStd = std.some((r) => r.test(src))
    const hasCustom = custom.some((r) => r.test(src))
    if (hasStd && !hasCustom) return '표준'
    if (hasStd && hasCustom) return '혼재'
    if (hasCustom) return '자작'
    return '-'
  })
  rows.push({ route, files: fs_.length, cells })
}

// 축별 집계 — 어디부터 손대야 하는지 숫자로 나온다
const summary = AXES.map((a, i) => {
  const c = { 표준: 0, 혼재: 0, 자작: 0 }
  for (const r of rows) if (r.cells[i] in c) c[r.cells[i]]++
  return { axis: a.axis, ...c }
})

if (process.argv.includes('--md')) {
  const head = `| 화면 | ${AXES.map((a) => a.axis).join(' | ')} |`
  const sep = `|---|${AXES.map(() => '---').join('|')}|`
  const body = rows.map((r) => `| \`${r.route}\` | ${r.cells.join(' | ')} |`).join('\n')
  const sum = [`| 축 | 표준 | 혼재 | 자작 |`, `|---|---|---|---|`,
    ...summary.map((s) => `| ${s.axis} | ${s.표준} | ${s.혼재} | ${s.자작} |`)].join('\n')
  writeFileSync(fileURLToPath(new URL('./SCREEN-MAP.md', import.meta.url)),
`# 화면 × UI 축 지도 (자동 생성)

\`node docs/ui-system/scan-screens.mjs --md\`로 다시 만든다. **손으로 고치지 않는다.**

- **표준** = 공용 부품을 쓴다 · **자작** = 화면이 직접 그린다 · **혼재** = 둘 다 있다(이관 중)

## 축별 현황

${sum}

## 화면별

${head}
${sep}
${body}
`)
  console.log('SCREEN-MAP.md 생성')
} else {
  console.table(summary)
}
