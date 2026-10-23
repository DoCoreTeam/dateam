#!/usr/bin/env node
/**
 * 웹 기능 추출기, 코드에서 사람이 부를 수 있는 동작을 전부 센다
 *
 * 세는 것 둘
 *   1 app/api 의 route.ts 가 내보내는 메서드 (GET POST PATCH PUT DELETE)
 *   2 'use server' 파일이 내보내는 async 함수 (서버 액션)
 *
 * 화면(page.tsx)은 동작이 아니라 이 둘을 부르는 자리라 따로 세지 않는다
 * 화면이 무엇을 부르는지는 이 둘 중 하나로 반드시 귀결된다
 *
 * 출력: JSON 배열, 한 줄 = 동작 하나
 *   { key, kind, method, path, file, summary, params }
 *   key 는 "GET /api/crm/deals" 또는 "action app/(member)/daily/actions.ts#saveDailyLog"
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const WEB = path.join(ROOT, 'apps/web')
const METHODS = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.next')) continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** app/api/crm/deals/[id]/route.ts → /api/crm/deals/{id} */
function routePath(file) {
  const rel = path.relative(path.join(WEB, 'app'), path.dirname(file)).split(path.sep)
  const segs = rel
    .filter((s) => !(s.startsWith('(') && s.endsWith(')')))
    .map((s) => s.replace(/^\[\.\.\.(.+)\]$/, '{$1*}').replace(/^\[\[\.\.\.(.+)\]\]$/, '{$1*}').replace(/^\[(.+)\]$/, '{$1}'))
  return '/' + segs.join('/')
}

/** 파일 맨 위 "// GET /api/x — 설명" 꼴 주석에서 메서드별 설명을 뽑는다 */
function headerSummaries(src) {
  const map = {}
  for (const line of src.split('\n').slice(0, 40)) {
    const m = line.match(/^\s*(?:\/\/|\*)\s*(GET|POST|PATCH|PUT|DELETE)\b[^—\-:]*[—\-:]\s*(.+)$/)
    if (m && !map[m[1]]) map[m[1]] = m[2].trim().slice(0, 120)
  }
  return map
}

function routeOps(file) {
  const src = fs.readFileSync(file, 'utf8')
  const sums = headerSummaries(src)
  const userAuth = /getUser|getRequestUser|requireAdmin|requireMember|withCrmApi|resolveCrmAccess|requireCiMember|createClient\(|withPublicCrm|withPublicCi|authenticatePublicApi/.test(src)
  const machineAuth = /CRON_SECRET|WORKER_TOKEN|isMachineCall|machineAuth/.test(src)
  const ops = []
  for (const method of METHODS) {
    const re = new RegExp(`export\\s+(?:async\\s+function\\s+${method}\\b|const\\s+${method}\\b|\\{[^}]*\\b${method}\\b[^}]*\\})`)
    if (!re.test(src)) continue
    // 공개 API 관문을 그대로 내보내는 메서드는 새 동작이 아니다, 정의 표의 줄을 싣는 입구다 (P0158 I07)
    if (src.includes('dispatchPublicApi') && new RegExp(`export\\s+const\\s+${method}\\s*=\\s*(dispatchPublicApi|enter)\\b`).test(src)) continue
    const p = routePath(file)
    // 이 메서드 몸통만 (다음 export 전까지), 관리자 전용인지 본다
    const at = src.search(new RegExp(`export\\s+(?:async\\s+function|const)\\s+${method}\\b`))
    const body = at >= 0 ? src.slice(at, at + 1 + (src.slice(at + 1).search(/\nexport\s/) + 1 || src.length)) : src
    const adminOnly = /requireAdmin(Api)?\(|withCrmApi\(\s*'(ADMIN|OWNER)'/.test(body) && !/requireMember/.test(body)
    ops.push({
      key: `${method} ${p}`,
      kind: 'route',
      method,
      path: p,
      file: path.relative(ROOT, file),
      summary: sums[method] ?? '',
      params: [...p.matchAll(/\{(\w+)\*?\}/g)].map((m) => m[1]),
      machineOnly: machineAuth && !userAuth,
      adminOnly,
    })
  }
  return ops
}

/** export async function name(a: T, b = 1) 에서 인자 이름만 */
function paramNames(sig) {
  let depth = 0
  let cur = ''
  const parts = []
  for (const ch of sig) {
    if ('([{<'.includes(ch)) depth++
    if (')]}>'.includes(ch)) depth--
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts
    .map((s) => s.trim().replace(/^\.\.\./, ''))
    .map((s) => (s.startsWith('{') ? 'input' : s.split(/[?:=\s]/)[0]))
    .filter(Boolean)
}

function actionOps(file) {
  const src = fs.readFileSync(file, 'utf8')
  if (!/^\s*['"]use server['"]/.test(src)) return []
  const ops = []
  const re = /export\s+async\s+function\s+(\w+)\s*(?:<[^>]*>)?\s*\(/g
  let m
  while ((m = re.exec(src))) {
    // 여는 괄호부터 짝이 맞는 닫는 괄호까지
    let i = m.index + m[0].length
    let depth = 1
    const start = i
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth++
      if (src[i] === ')') depth--
      i++
    }
    const before = src.slice(Math.max(0, m.index - 400), m.index)
    const doc = before.match(/\/\*\*([\s\S]*?)\*\/\s*$/) ?? before.match(/((?:\s*\/\/[^\n]*\n)+)\s*$/)
    const summary = doc
      ? doc[1].split('\n').map((l) => l.replace(/^\s*(\*|\/\/)\s?/, '').trim()).find((l) => l && !l.startsWith('@')) ?? ''
      : ''
    const rel = path.relative(ROOT, file)
    ops.push({
      key: `action ${path.relative(WEB, file)}#${m[1]}`,
      kind: 'action',
      method: 'POST',
      path: `${path.relative(WEB, file)}#${m[1]}`,
      file: rel,
      summary: summary.slice(0, 120),
      params: paramNames(src.slice(start, i - 1)),
    })
  }
  return ops
}

export function extractOperations() {
  const files = walk(path.join(WEB, 'app')).concat(walk(path.join(WEB, 'lib')))
  const ops = []
  for (const f of files) {
    if (!/\.(ts|tsx)$/.test(f) || /\.test\.tsx?$/.test(f)) continue
    if (f.endsWith(`${path.sep}route.ts`) && f.includes(`${path.sep}app${path.sep}api${path.sep}`)) ops.push(...routeOps(f))
    else ops.push(...actionOps(f))
  }
  return ops.sort((a, b) => a.key.localeCompare(b.key))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.stdout.write(JSON.stringify(extractOperations(), null, 2) + '\n')
}
