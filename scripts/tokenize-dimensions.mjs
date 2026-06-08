#!/usr/bin/env node
// 치수 토큰화 codemod — 보더 두께/모서리 radius 리터럴 → 토큰. (색은 별도 완료)
// nb 무회귀: --border-w(3px)/--border-w-2(2px)/--hairline(1px) identity. radius는 --radius(4)/--radius-lg(8) 2단계.
// 제외: api/, globals --토큰 정의 라인, 원형(50%)·pill(999/9999px).
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function repl(text, isCss) {
  let n = 0
  const lines = text.split('\n').map((line) => {
    if (isCss && /^\s*--/.test(line)) return line
    let l = line
    // 보더 두께: "Npx solid" → 토큰 (var(--border-w) 등). 이미 var면 건드리지 않음.
    l = l.replace(/\b3px solid\b/g, () => { n++; return 'var(--border-w) solid' })
    l = l.replace(/\b2px solid\b/g, () => { n++; return 'var(--border-w-2) solid' })
    l = l.replace(/\b1px solid\b/g, () => { n++; return 'var(--hairline) solid' })
    l = l.replace(/\b1px dashed\b/g, () => { n++; return 'var(--hairline) dashed' })
    l = l.replace(/\b2px dashed\b/g, () => { n++; return 'var(--border-w-2) dashed' })
    // borderRadius 인라인 리터럴 (pill/원형 제외)
    l = l.replace(/borderRadius: '(2px|3px|4px|0\.25rem)'/g, () => { n++; return "borderRadius: 'var(--radius)'" })
    l = l.replace(/borderRadius: '(5px|6px|7px|8px|9px|10px|11px|12px|0\.4rem|0\.5rem|0\.625rem|0\.75rem|0\.875rem)'/g, () => { n++; return "borderRadius: 'var(--radius-lg)'" })
    // CSS border-radius (globals 클래스)
    if (isCss) {
      l = l.replace(/border-radius: (2px|3px|4px|0\.25rem);/g, () => { n++; return 'border-radius: var(--radius);' })
      l = l.replace(/border-radius: (5px|6px|7px|8px|9px|10px|11px|12px|0\.4rem|0\.5rem|0\.625rem|0\.75rem|0\.875rem);/g, () => { n++; return 'border-radius: var(--radius-lg);' })
    }
    return l
  })
  return [lines.join('\n'), n]
}
function walk(d, a){for(const e of readdirSync(d)){const p=join(d,e);const s=statSync(p);if(s.isDirectory()){if(p.includes('/api')||e==='node_modules'||e==='.next')continue;walk(p,a)}else if(/\.(tsx|ts)$/.test(e))a.push(p)}}
const files=[];walk('apps/web/app',files);walk('apps/web/components',files)
let total=0,changed=0
for(const f of files){const s=readFileSync(f,'utf8');const[o,n]=repl(s,false);if(n){writeFileSync(f,o);total+=n;changed++}}
{const f='apps/web/app/globals.css';const s=readFileSync(f,'utf8');const[o,n]=repl(s,true);if(n){writeFileSync(f,o);total+=n;changed++}}
console.log(`dimensions: ${total}건 / ${changed}파일`)
