#!/usr/bin/env node
// 스케일 토큰화 (identity 전용 — 무회귀). scale에 정확히 일치하는 fontSize/gap/padding rem값만 토큰으로.
// off-grid 값(0.7rem,10px 등)·z-index(스태킹 리스크)는 보존.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const FS = { '0.6875rem':'--fs-2xs','0.75rem':'--fs-xs','0.8125rem':'--fs-sm','0.875rem':'--fs-base','0.9375rem':'--fs-md','1rem':'--fs-lg','1.125rem':'--fs-xl','1.5rem':'--fs-2xl','1.75rem':'--fs-3xl' }
const SP = { '0':'--space-0','0.25rem':'--space-1','0.5rem':'--space-2','0.75rem':'--space-3','1rem':'--space-4','1.25rem':'--space-5','1.5rem':'--space-6','2rem':'--space-8','2.5rem':'--space-10','3rem':'--space-12' }

function mapSpaceValue(v) { // 단일/복합 rem → 각 토큰 (전부 매칭될 때만)
  const parts = v.trim().split(/\s+/)
  if (!parts.every(p => SP[p])) return null
  return parts.map(p => `var(${SP[p]})`).join(' ')
}

function repl(text) {
  let n = 0
  // fontSize
  text = text.replace(/fontSize: '([^']+)'/g, (m, v) => { if (FS[v]) { n++; return `fontSize: 'var(${FS[v]})'` } return m })
  // gap
  text = text.replace(/gap: '([^']+)'/g, (m, v) => { const r = SP[v]; if (r) { n++; return `gap: 'var(${r})'` } return m })
  // padding (단일/복합 rem)
  text = text.replace(/(padding|paddingTop|paddingBottom|paddingLeft|paddingRight): '([^']+)'/g, (m, k, v) => { const r = mapSpaceValue(v); if (r) { n++; return `${k}: '${r}'` } return m })
  return [text, n]
}
function walk(d,a){for(const e of readdirSync(d)){const p=join(d,e);const s=statSync(p);if(s.isDirectory()){if(p.includes('/api')||e==='node_modules'||e==='.next')continue;walk(p,a)}else if(/\.(tsx)$/.test(e))a.push(p)}}
const files=[];walk('apps/web/app',files);walk('apps/web/components',files)
let total=0,changed=0
for(const f of files){const s=readFileSync(f,'utf8');const[o,n]=repl(s);if(n){writeFileSync(f,o);total+=n;changed++}}
console.log(`scale: ${total}건 / ${changed}파일`)
