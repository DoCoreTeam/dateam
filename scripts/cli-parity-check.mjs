#!/usr/bin/env node
/**
 * cli-parity-check, 웹에서 되는 동작이 전부 CLI 로도 되는지 센다
 *
 *   node --experimental-strip-types scripts/cli-parity-check.mjs
 *
 * 실패(종료 코드 1) 조건, 예외 목록 파일은 두지 않는다
 *   1 정의가 없는 라우트 메서드나 서버 액션 (정의를 거치지 않은 동작)
 *   2 코드에 없는 동작을 가리키는 정의 (지운 기능의 남은 줄)
 *   3 범위가 없거나 모르는 범위인 정의
 *   4 웹 전용 사유가 인증 화면이 아닌 정의 (저장소 주인 승인 문구가 없으면)
 *   5 이름이나 CLI 명령이 겹치는 정의
 *   6 관문 표(generated/table.ts)가 정의와 어긋남 (cli:gen 을 안 돌림)
 *   7 시험 안 된 줄: 관문 표의 처리 함수가 화면이 쓰는 그 모듈의 그 export 가 아님
 *   8 화면이 브라우저 Supabase 로 직접 쓰는 자리 (관문을 안 거치는 쓰기)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractOperations } from './cli/extract-operations.mjs'
import { generate, buildRows, loadDefs } from './cli/gen.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WEB = path.join(ROOT, 'apps/web')
const SCOPES = new Set(['read', 'write', 'approve', 'send', 'delete', 'admin'])
/** 웹에만 둘 수 있는 화면: 로그인 비밀번호 2단계 인증 */
const AUTH_SCREEN = /^action app\/\(auth\)\/|^action app\/change-password\/actions\.ts#change-?password|^action app\/change-password\/actions\.ts#changePassword|^action app\/security\//
const OWNER_APPROVED = /저장소 주인 승인 \d{4}-\d{2}-\d{2}/

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.next')) continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\.tsx?$/.test(ent.name)) out.push(p)
  }
  return out
}

function browserWrites() {
  const hits = []
  for (const f of ['app', 'components', 'lib', 'hooks'].flatMap((d) => (fs.existsSync(path.join(WEB, d)) ? walk(path.join(WEB, d)) : []))) {
    const src = fs.readFileSync(f, 'utf8')
    if (!/from ['"]@\/lib\/supabase\/client['"]/.test(src)) continue
    if (/\.(insert|update|upsert|delete|rpc)\(/.test(src)) hits.push(path.relative(ROOT, f))
  }
  return hits
}

export async function runParityCheck() {
  const problems = []
  const ops = extractOperations()
  const defs = await loadDefs()
  const opKeys = new Set(ops.map((o) => o.key))

  const rows = buildRows(ops, defs)
  for (const r of rows) if (!r.def) problems.push(`정의 없음: ${r.op.key} (${r.op.file})`)
  for (const d of defs) if (!opKeys.has(d.op)) problems.push(`코드에 없는 동작의 정의: ${d.op} (${d.name})`)
  for (const d of defs) if (!SCOPES.has(d.scope)) problems.push(`범위 없음 또는 모르는 범위: ${d.name} scope=${d.scope}`)
  for (const d of defs) {
    if (d.webOnly && !AUTH_SCREEN.test(d.op) && !OWNER_APPROVED.test(d.webOnly)) {
      problems.push(`웹 전용 사유가 인증 화면이 아니고 저장소 주인 승인도 없음: ${d.name}`)
    }
  }
  const seen = new Map()
  for (const d of defs) {
    for (const k of [`name:${d.name}`, `cli:${d.cli}`]) {
      if (seen.has(k)) problems.push(`겹침 ${k} (${seen.get(k)} 와 ${d.op})`)
      seen.set(k, d.op)
    }
  }

  const { stale } = await generate({ check: true })
  for (const f of stale) problems.push(`생성물이 낡음: ${f} (node --experimental-strip-types scripts/cli/gen.mjs)`)

  // 7 같은 처리 함수 대조: 관문 표가 가리키는 모듈 파일에 그 export 가 실제로 있는가
  const exposed = rows.filter((r) => r.exposed)
  let tested = 0
  for (const r of exposed) {
    const file = path.join(ROOT, r.op.file)
    const src = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
    const name = r.exported
    const ok = new RegExp(`export\\s+(?:async\\s+function|const|function)\\s+${name}\\b|export\\s*\\{[^}]*\\b${name}\\b`).test(src)
    if (ok) tested++
    else problems.push(`시험 안 됨: ${r.def.name} 가 가리키는 ${r.op.file} 에 ${name} 이 없음`)
  }

  for (const f of browserWrites()) problems.push(`관문을 안 거치는 브라우저 쓰기: ${f}`)

  const count = (pred) => rows.filter(pred).length
  const byArea = {}
  for (const r of rows) {
    const a = r.def ? r.def.name.split('.')[0] : '정의 없음'
    byArea[a] ??= { 전체: 0, CLI: 0, 시험: 0 }
    byArea[a].전체++
    if (r.exposed) { byArea[a].CLI++; byArea[a].시험++ }
  }
  const summary = {
    전체동작: ops.length,
    대응표줄: count((r) => !!r.def),
    CLI됨: exposed.length,
    시험됨: tested,
    웹전용: count((r) => r.def?.webOnly),
    이관중: count((r) => r.def?.legacy),
    기계창구: count((r) => r.def?.machine),
    대응안된줄: count((r) => !r.def),
    시험안된줄: exposed.length - tested,
  }
  return { problems, summary, byArea }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { problems, summary, byArea } = await runParityCheck()
  const line = Object.entries(summary).map(([k, v]) => `${k} ${v}`).join(', ')
  process.stdout.write(`[cli-parity] ${line}\n`)
  for (const [a, c] of Object.entries(byArea)) process.stdout.write(`  ${a}: 전체 ${c.전체} / CLI ${c.CLI} / 시험 ${c.시험}\n`)
  if (problems.length) {
    process.stdout.write(`[cli-parity] 실패 ${problems.length}건\n`)
    for (const p of problems.slice(0, 200)) process.stdout.write(`  - ${p}\n`)
    process.exit(1)
  }
  process.stdout.write('[cli-parity] 통과\n')
}
