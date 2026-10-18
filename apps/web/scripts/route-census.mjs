#!/usr/bin/env node
// scripts/route-census.mjs — 창구 인구조사 (정책 F-3·F-4)
//
// **무엇을 세나**: `app/api/**/route.ts` 가 만든 창구 가운데, 그 경로가 화면·훅·서버 액션
// **어디에도 안 적힌** 것. 「만들고 안 부름」은 이 저장소가 여러 판 겪은 실패다
// (AI 트레이딩 1-A 여덟 자리 · RFP 엔진 둘 · 회의 삭제 로직) — 그때마다 tsc·시험·빌드가
// 전부 초록이었다.
//
// **왜 「안 적힌」으로 세나**: 「안 불린다」를 정확히 세려면 서버 액션과 prop 으로 넘어간
// 주소까지 따라가야 한다. 실측으로 그 둘을 안 따라가면 **멀쩡한 창구 114개를 고장으로** 센다
// (`useCrmBulk` 는 `endpoint` 를 prop 으로 받아 런타임에 `${endpoint}/${id}` 를 만든다).
// 그래서 더 거친 대신 **틀리지 않는** 기준을 쓴다 — 경로가 코드 어디에도 없으면 부를 길이 없다.
//
// **고치면서 배운 것**: `[id]` 를 지우고 앞뒤를 이어 붙이면 `/api/crm/companies/owner` 처럼
// 실재할 수 없는 모양이 되어 멀쩡한 창구를 고장으로 센다. 앞부분과 뒷부분을 **따로** 찾는다.
//
// 돌리는 법: node scripts/route-census.mjs   (apps/web 에서)
// 가드: lib/policy/route-census.test.ts 가 「설명이 안 붙는 것」 수를 잠근다
//
// 이 조사가 **세지 않는 것**: 자원마다 만들기·고치기·지우기가 다 있는지(F-3 의 CRUD 모양).
// `POST /rollback` 처럼 자원이 아닌 동작 창구가 많아, 자원을 가리는 모델 없이 세면
// 「만들기는 있고 지우기가 없는 자원 110개」 같은 못 믿을 숫자가 나온다. 별건으로 남긴다.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
const WEB = process.cwd()
const walk = (d, out = []) => {
  for (const n of readdirSync(d)) {
    if (n.startsWith('.') || n === 'node_modules') continue
    const p = join(d, n)
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p)
  }
  return out
}
// 창구 경로 (메서드 무시)
const routes = new Map()
for (const p of walk(join(WEB, 'app', 'api'))) {
  if (!/route\.tsx?$/.test(p)) continue
  const rel = relative(WEB, p)
  const url = '/' + rel.replace(/^app[\\/]/, '').replace(/[\\/]route\.tsx?$/, '')
    .split(sep).filter((s) => !(s.startsWith('(') && s.endsWith(')'))).join('/')
  routes.set(url, rel)
}
// 창구 밖 모든 코드 한 덩어리 (서버 액션·훅·화면 전부)
let blob = ''
for (const root of ['app', 'components', 'lib']) {
  for (const p of walk(join(WEB, root))) {
    const rel = relative(WEB, p)
    if (rel.includes(`${sep}api${sep}`)) continue
    if (!/\.(tsx|ts)$/.test(rel) || /\.test\.tsx?$/.test(rel)) continue
    blob += readFileSync(p, 'utf8') + '\n'
  }
}
// 경로가 **어디에도 안 적혀 있나** — 동적 조각은 지우고 고정 앞부분으로 찾는다
const never = []
for (const [url, file] of routes) {
  // `[id]` 앞까지의 **고정 앞부분**과 그 뒤 **고정 뒤부분**을 따로 찾는다.
  // 둘을 이어 붙이면 실재하지 않는 경로가 되어 멀쩡한 창구를 안 불린다고 말한다
  // (실측: /api/crm/companies/[id]/owner -> /api/crm/companies/owner, 코드에 있을 수 없는 모양)
  const segs = url.split('/')
  const di = segs.findIndex((x) => x.startsWith('['))
  const head = (di === -1 ? segs : segs.slice(0, di)).join('/')
  const tail = di === -1 ? '' : segs.slice(di + 1).filter((x) => !x.startsWith('[')).join('/')
  const seen = blob.includes(head) && (!tail || blob.includes(tail))
  if (!seen) never.push([url, file])
}
const CLASSES = [
  [/\/internal\/|\/cron\/|\/jobs\/|\/worker/, '크론·내부 작업자'],
  [/\/callback$|\/oauth|\/webhook/, '외부가 들어오는 자리'],
  [/\/api\/ping$|\/api\/health/, '살아 있는지 보는 자리'],
  [/^\/api\/public\//, '바깥에 내준 공개 API (우리 화면이 부르는 자리가 아니다)'],
  [/^\/api\/docs|\/openapi/, 'API 문서가 읽는 자리'],
]
const cls = new Map(); const residual = []
for (const [u, f] of never) {
  const hit = CLASSES.find(([re]) => re.test(u))
  if (hit) cls.set(hit[1], [...(cls.get(hit[1]) ?? []), u])
  else residual.push([u, f])
}
console.log(`창구 경로 ${routes.size}개`)
console.log(`경로가 **코드 어디에도 안 적힌** 창구 ${never.length}개 가운데`)
for (const [why, arr] of cls) console.log(`  ${arr.length}건  ${why}`)
console.log(`  ${residual.length}건  설명이 안 붙는 것\n`)
for (const [u, f] of residual) console.log(`  ${u}\n      ${f}`)

console.log(`\nCENSUS_UNEXPLAINED=${residual.length}`)
