#!/usr/bin/env node
// 팔레트 통일(consolidation) codemod — 변형색을 시맨틱 토큰으로 합침(색 미세 변화=의도).
// identity 단계(tokenize.mjs) 이후 잔여 변형색 대상. 제외: api/, --토큰 정의 라인, KEEP.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAP = {
  // 텍스트(진한 중성/슬레이트 → text)
  '#1e293b':'--text','#374151':'--text','#334155':'--text','#111827':'--text','#1e1b4b':'--text','#13151c':'--text','#1a1a1a':'--text','#1a2332':'--text','#0a0a0f':'--text','#1a1a2e':'--text','#0d1b2a':'--text','#1a0a2e':'--text',
  '#475569':'--text-muted','#6b7280':'--text-muted','#6b6b6b':'--text-muted','#8b8b9e':'--text-muted',
  '#9ca3af':'--text-faint',
  // 표면(근백색)
  '#f9fafb':'--surface-bg','#fafafa':'--surface-bg','#f1f2f6':'--surface-bg','#fafbff':'--surface-bg','#eef0f6':'--surface-bg','#fafbfc':'--surface-bg','#f1f3f9':'--surface-bg','#f0f1f4':'--surface-bg','#f8faff':'--surface-bg','#f8fbff':'--surface-bg','#f8f7ff':'--surface-bg','#f0f0f0':'--surface-bg','#eef2f7':'--surface-bg','#f8f9ff':'--surface-bg','#fbfcfe':'--surface-bg','#f4f5f9':'--surface-bg','#f3f4f8':'--surface-bg','#fffdf5':'--surface-bg',
  '#f3f4f6':'--surface-muted',
  // 보더
  '#d1d5db':'--border-subtle',
  // 브랜드(보라)
  '#5b5ef0':'--brand','#6d28d9':'--brand','#a855f7':'--brand',
  '#5b21b6':'--brand-dark','#4338ca':'--brand-dark','#4244c9':'--brand-dark','#4d50e0':'--brand-dark','#312e81':'--brand-dark','#3730a3':'--brand-dark','#6d6abe':'--brand-dark',
  '#f5f3ff':'--brand-soft','#faf5ff':'--brand-soft','#fdf4ff':'--brand-soft','#f3e8ff':'--brand-soft','#f3eeff':'--brand-soft','#f0f4ff':'--brand-soft','#eef2ff':'--brand-soft',
  '#ddd6fe':'--brand-soft-2','#c4b5fd':'--brand-soft-2','#a78bfa':'--brand-soft-2','#e9d5ff':'--brand-soft-2','#ddd9fb':'--brand-soft-2','#eef0fe':'--brand-soft-2','#f1ebfe':'--brand-soft-2',
  // 성공(초록/라임/틸 계열 일부)
  '#15803d':'--success','#10b981':'--success','#059669':'--success','#22c55e':'--success','#15a35a':'--success','#34d399':'--success','#065f46':'--success','#166534':'--success','#84cc16':'--success',
  '#e6f7ee':'--success-bg','#ecfdf5':'--success-bg','#cfe7d8':'--success-bg','#dcfce7':'--success-bg','#f0fdfa':'--success-bg','#e7f5ec':'--success-bg','#f3fbf6':'--success-bg','#a7f3d0':'--success-border',
  // 위험(빨강)
  '#ef4444':'--danger','#b91c1c':'--danger','#e0405a':'--danger','#7f1d1d':'--danger','#f87171':'--danger','#991b1b':'--danger',
  '#fff1f2':'--danger-bg','#fee2e2':'--danger-bg','#fdebee':'--danger-bg','#f5d2d8':'--danger-bg','#fff3f4':'--danger-bg','#fff5f5':'--danger-bg','#f5d2a0':'--warning-bg',
  '#fca5a5':'--danger-border',
  // 경고(주황/앰버)
  '#92400e':'--warning','#b45309':'--warning','#f59e0b':'--warning','#f97316':'--warning','#c2410c':'--warning','#a16207':'--warning','#ea580c':'--warning','#78350f':'--warning','#eab308':'--warning','#ca8a04':'--warning',
  '#fff7ed':'--warning-bg','#fef3e2':'--warning-bg','#fef3c7':'--warning-bg','#fef9c3':'--warning-bg','#fef7ee':'--warning-bg','#fef08a':'--warning-border','#fed7aa':'--warning-border',
  // 정보(파랑/시안/틸)
  '#3b82f6':'--info','#0284c7':'--info','#0891b2':'--info','#1d4ed8':'--info','#1e40af':'--info','#0ea5e9':'--info','#0369a1':'--info','#0f766e':'--info','#0d9488':'--info','#14b8a6':'--info',
  '#f0f9ff':'--info-bg','#dbeafe':'--info-bg','#ecfeff':'--info-bg','#e0f2fe':'--info-bg','#e0f7fa':'--info-bg','#a5f3fc':'--info-bg','#99f6e4':'--info-bg',
  '#bae6fd':'--info-border','#93c5fd':'--info-border',
}
const KEEP = new Set(['#fcd34d','#ffffff','#0a0a0a','#f8f8f6','#efede8'])
// 의도적 보존(이질 액센트): 핑크 #ec4899/#fbcfe8 등은 매핑하지 않음

const hexRe = /#[0-9a-fA-F]{6}\b/g
function repl(text, isCss){let n=0;const out=text.split('\n').map(line=>{
  if(isCss&&/^\s*--/.test(line))return line
  return line.replace(hexRe,m=>{const k=m.toLowerCase();if(KEEP.has(k))return m;const t=MAP[k];if(!t)return m;n++;return `var(${t})`})
}).join('\n');return[out,n]}
function walk(d,a){for(const e of readdirSync(d)){const p=join(d,e);const s=statSync(p);if(s.isDirectory()){if(p.includes('/api')||e==='node_modules'||e==='.next')continue;walk(p,a)}else if(/\.(tsx|ts)$/.test(e))a.push(p)}}
const files=[];walk('apps/web/app',files);walk('apps/web/components',files)
let total=0,changed=0
for(const f of files){const s=readFileSync(f,'utf8');const[o,n]=repl(s,false);if(n){writeFileSync(f,o);total+=n;changed++}}
{const f='apps/web/app/globals.css';const s=readFileSync(f,'utf8');const[o,n]=repl(s,true);if(n){writeFileSync(f,o);total+=n;changed++}}
console.log(`consolidate: ${total}건 / ${changed}파일`)
