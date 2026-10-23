#!/usr/bin/env node --experimental-strip-types
/**
 * cli:gen, 기능 정의 표에서 나머지를 만든다
 *
 *   node --experimental-strip-types scripts/cli/gen.mjs            생성물만 다시 만듦
 *   node --experimental-strip-types scripts/cli/gen.mjs --scaffold 정의 없는 동작에 초안 줄을 더한 뒤 생성
 *   node --experimental-strip-types scripts/cli/gen.mjs --check    생성물이 최신인지만 봄 (CI)
 *
 * 생성물
 *   apps/web/lib/actions/generated/table.ts   관문이 쓰는 경로 표와 처리 함수 연결
 *   apps/web/lib/actions/generated/openapi.json  CLI 빌드에 넣는 명령 표
 *   docs/cli/02-기능대응표.md
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { extractOperations } from './extract-operations.mjs'
import { draftRouteDef, draftActionDef, draftPublicDef } from './naming.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const WEB = path.join(ROOT, 'apps/web')
const DEFS_DIR = path.join(WEB, 'lib/actions/defs')
const GEN_DIR = path.join(WEB, 'lib/actions/generated')
const TABLE_MD = path.join(ROOT, 'docs/cli/02-기능대응표.md')

const AREAS = ['work', 'crm', 'ci', 'studio', 'rfp', 'trading', 'gpu', 'admin', 'meta']
const AREA_LABEL = {
  work: '사내 업무', crm: '영업 CRM', ci: '콘텐츠 인텔리전스', studio: 'AI 스튜디오', rfp: 'RFP 분석기',
  trading: 'AI 트레이딩', gpu: '가격정책', admin: '관리자 설정', meta: '공통',
}

export async function loadDefs() {
  const { ALL_DEFS } = await import(pathToFileURL(path.join(DEFS_DIR, 'index.ts')).href + `?t=${Date.now()}`)
  return ALL_DEFS
}

const areaOf = (def) => def.name.split('.')[0]

function draftFor(op) {
  if (op.kind === 'action') return draftActionDef(op)
  if (op.path.startsWith('/api/public/v1/')) return draftPublicDef(op)
  const def = draftRouteDef(op)
  if (op.machineOnly && !def.legacy) def.machine = '크론 워커가 부르는 기계 창구, 사람이 누르는 동작 아님'
  return def
}

/** 이름과 CLI 명령이 겹치면 뒤에 메서드나 번호를 붙여 하나로 */
function dedupe(defs, taken) {
  const names = new Set(taken.map((d) => d.name))
  const clis = new Set(taken.map((d) => d.cli))
  return defs.map((d) => {
    let { name, cli } = d
    // 하위 목록에 더하는 POST 가 같은 이름의 GET 과 겹치면 -add (deal costs 와 deal costs-add)
    if ((names.has(name) || clis.has(cli)) && d.op.startsWith('POST ')) {
      name = `${d.name}-add`
      cli = `${d.cli}-add`
    }
    let n = 2
    while (names.has(name) || clis.has(cli)) {
      name = `${d.name}-${n}`
      cli = `${d.cli}-${n}`
      n++
    }
    names.add(name)
    clis.add(cli)
    return { ...d, name, cli }
  })
}

function serializeDef(d) {
  const keys = ['op', 'name', 'scope', 'cli', 'summary', 'aliases', 'table', 'webOnly', 'legacy', 'machine']
  const parts = keys.filter((k) => d[k] !== undefined).map((k) => `${k}: ${JSON.stringify(d[k])}`)
  return `  { ${parts.join(', ')} },`
}

function writeAreaFile(area, defs) {
  const constName = `${area.toUpperCase()}_DEFS`
  const body = [
    `// ${AREA_LABEL[area]} 기능 정의, 동작 하나에 한 줄 (형식은 ../types.ts)`,
    '// 범위와 CLI 이름은 손으로 고쳐도 됨, scaffold 는 없는 줄만 더하고 있는 줄은 안 건드림',
    "import type { ActionDef } from '../types.ts'",
    '',
    `export const ${constName}: ActionDef[] = [`,
    ...defs.map(serializeDef),
    ']',
    '',
  ].join('\n')
  fs.writeFileSync(path.join(DEFS_DIR, `${area}.ts`), body)
}

function writeIndex() {
  const lines = [
    '// 기능 정의 전체, 영역별 파일을 모은다 (scripts/cli/gen.mjs 가 이 목록을 다시 씀)',
    "import type { ActionDef } from '../types.ts'",
    ...AREAS.map((a) => `import { ${a.toUpperCase()}_DEFS } from './${a}.ts'`),
    '',
    'export const ALL_DEFS: ActionDef[] = [',
    ...AREAS.map((a) => `  ...${a.toUpperCase()}_DEFS,`),
    ']',
    '',
  ]
  fs.writeFileSync(path.join(DEFS_DIR, 'index.ts'), lines.join('\n'))
}

async function scaffold(ops) {
  fs.mkdirSync(DEFS_DIR, { recursive: true })
  let existing = []
  if (fs.existsSync(path.join(DEFS_DIR, 'index.ts'))) existing = await loadDefs()
  const known = new Set(existing.map((d) => d.op))
  // GET 을 먼저 이름 붙여야 POST 가 -add 를 받는다
  const fresh = ops.filter((o) => !known.has(o.key)).sort((a, b) => (a.method === 'GET' ? 0 : 1) - (b.method === 'GET' ? 0 : 1))
  const drafts = dedupe(fresh.map(draftFor), existing)
  const all = [...existing, ...drafts]
  for (const area of AREAS) writeAreaFile(area, all.filter((d) => areaOf(d) === area))
  writeIndex()
  return drafts.length
}

/** 내부 경로 → 공개 경로, 기존 공개 API 와 같은 메서드 경로면 /web 아래로 */
export function mountOf(op, publicKeys) {
  if (op.kind === 'action') return { method: 'POST', path: `/actions/${op.defName.replace(/\./g, '/')}` }
  if (op.path.startsWith('/api/public/v1/')) return { method: op.method, path: op.path.replace('/api/public/v1', ''), existing: true }
  const p = op.path.replace(/^\/api/, '')
  return publicKeys.has(`${op.method} ${p}`) ? { method: op.method, path: `/web${p}` } : { method: op.method, path: p }
}

/** route.ts 파일 경로 → import 지정자 (@/app/api/crm/deals/[id]/route) */
const importSpec = (file) => '@/' + file.replace(/^apps\/web\//, '').replace(/\.tsx?$/, '')

export function buildRows(ops, defs) {
  const byOp = new Map(defs.map((d) => [d.op, d]))
  const publicKeys = new Set(ops.filter((o) => o.path.startsWith('/api/public/v1/')).map((o) => `${o.method} ${o.path.replace('/api/public/v1', '')}`))
  return ops.map((op) => {
    const def = byOp.get(op.key)
    const mount = def ? mountOf({ ...op, defName: def.name }, publicKeys) : null
    const exported = op.kind === 'action' ? op.path.split('#')[1] : op.method
    const exposed = !!def && !def.legacy && !def.webOnly && !def.machine
    return { op, def, mount, exported, exposed, module: importSpec(op.file) }
  })
}

/** 관문에 올라가는 동작 (기존 공개 API 는 제 파일이 처리하므로 빠짐) */
export function mountedOf(rows) {
  const live = rows.filter((r) => r.exposed && !r.mount.existing)
  const modules = [...new Set(live.map((r) => r.module))].sort()
  const idx = new Map(modules.map((m, i) => [m, i]))
  const mounted = live.map((r) => ({
    name: r.def.name, scope: r.def.scope, cli: r.def.cli, kind: r.op.kind, method: r.mount.method,
    mount: r.mount.path, internal: r.op.path, params: r.op.params, exported: r.exported,
    module: idx.get(r.module), summary: r.def.summary || r.op.summary || '',
  }))
  return { modules, mounted }
}

/** 기존 공개 API 동작, openapi 에 x-cli x-scope 를 붙이는 데 씀 */
export function existingOf(rows) {
  return rows.filter((r) => r.exposed && r.mount.existing).map((r) => ({
    name: r.def.name, scope: r.def.scope, cli: r.def.cli, method: r.mount.method, mount: r.mount.path,
  }))
}

function genTable(rows) {
  const { modules, mounted } = mountedOf(rows)
  const lines = [
    '// 생성물, 손대지 말 것 (scripts/cli/gen.mjs)',
    '// 관문이 공개 경로를 정의와 처리 함수로 바꾸는 표, 처리 함수는 화면이 쓰는 그 모듈에서 꺼낸다',
    '// 요약 글은 싣지 않는다: 소스 주석에서 온 개발자 글이라 화면 문구 가드(용어집)를 지나지 않았다, 설명은 openapi.json 이 맡는다',
    "import type { Scope } from '../types.ts'",
    '',
    'export interface MountedOp {',
    '  name: string',
    '  scope: Scope',
    '  cli: string',
    "  kind: 'route' | 'action'",
    '  method: string',
    '  /** 공개 경로, /api/public/v1 뒤 */',
    '  mount: string',
    '  /** 내부 경로 (라우트) 또는 파일#함수 (서버 액션) */',
    '  internal: string',
    '  params: string[]',
    '  /** 모듈에서 꺼낼 이름, 라우트는 메서드 서버 액션은 함수 이름 */',
    '  exported: string',
    '  module: number',
    '}',
    '',
    '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
    'export const MODULES: Array<() => Promise<any>> = [',
    ...modules.map((m) => `  () => import('${m}'),`),
    ']',
    '',
    'export const MOUNTED: MountedOp[] = [',
    ...mounted.map(({ summary: _summary, ...m }) => '  ' + JSON.stringify(m) + ','),
    ']',
    '',
  ]
  return lines.join('\n')
}

function statusOf(r) {
  if (!r.def) return '미착수'
  if (r.def.legacy) return '이관 중'
  if (r.def.webOnly) return '웹 전용'
  if (r.def.machine) return '기계 창구'
  return r.tested ? '시험됨' : 'CLI됨'
}

function genMarkdown(rows) {
  const out = [
    '# 02 기능 대응표',
    '',
    '생성물, 손대지 말 것 (node --experimental-strip-types scripts/cli/gen.mjs)',
    '한 줄 = 웹에서 사람이 하는 동작 하나 (라우트 메서드 하나 또는 서버 액션 하나)',
    '화면의 단추 메뉴 저장 끌어 놓기 업로드 다운로드 확인 창의 확인은 모두 이 둘 중 하나를 부른다, 같은 처리 함수를 부르는 단추는 한 줄로 묶임',
    '',
  ]
  const counts = {}
  for (const r of rows) {
    const s = statusOf(r)
    counts[s] = (counts[s] ?? 0) + 1
  }
  out.push(`전체 ${rows.length}, ` + Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', '), '')
  for (const area of AREAS) {
    const list = rows.filter((r) => r.def && areaOf(r.def) === area)
    if (!list.length) continue
    out.push(`## ${AREA_LABEL[area]} (${list.length})`, '')
    out.push('| 영역 > 대상 > 동작 | 웹 코드 위치 | 기능 정의 | 공개 API | CLI 명령 | 범위 | 상태 |')
    out.push('|---|---|---|---|---|---|---|')
    for (const r of list) {
      const [, target, verb] = r.def.name.split('.')
      const desc = (r.def.summary || r.op.summary || '').replace(/\|/g, '/')
      const where = r.op.kind === 'action' ? r.op.path : `${r.op.file.replace(/^apps\/web\//, '')} ${r.op.method}`
      const api = r.mount ? `${r.mount.method} ${r.mount.path}` : ''
      const note = r.def.legacy || r.def.webOnly || r.def.machine
      const cli = note ? note : `teamda ${r.def.cli}`
      out.push(`| ${AREA_LABEL[area]} > ${target} > ${verb}${desc ? ` (${desc})` : ''} | ${where} | ${r.def.name} | ${api} | ${cli} | ${r.def.scope} | ${statusOf(r)} |`)
    }
    out.push('')
  }
  const missing = rows.filter((r) => !r.def)
  if (missing.length) {
    out.push(`## 정의 없음 (${missing.length})`, '')
    for (const r of missing) out.push(`- ${r.op.key}`)
    out.push('')
  }
  return out.join('\n')
}

export async function generate({ check = false, scaffoldFirst = false } = {}) {
  const ops = extractOperations()
  if (scaffoldFirst) {
    const n = await scaffold(ops)
    process.stderr.write(`[cli:gen] 정의 초안 ${n}줄 추가\n`)
  }
  const defs = await loadDefs()
  const rows = buildRows(ops, defs)
  const { buildOpenApi } = await import(pathToFileURL(path.join(WEB, 'lib/actions/openapi.ts')).href)
  const files = {
    [path.join(GEN_DIR, 'table.ts')]: genTable(rows),
    [TABLE_MD]: genMarkdown(rows),
  }
  files[path.join(GEN_DIR, 'openapi.json')] = JSON.stringify(buildOpenApi(mountedOf(rows).mounted, existingOf(rows)), null, 1) + '\n'

  const stale = []
  for (const [file, content] of Object.entries(files)) {
    const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
    if (cur === content) continue
    if (check) stale.push(path.relative(ROOT, file))
    else {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, content)
    }
  }
  return { rows, stale }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check')
  const { stale } = await generate({ check, scaffoldFirst: process.argv.includes('--scaffold') })
  if (check && stale.length) {
    process.stderr.write(`[cli:gen] 생성물이 낡음, node --experimental-strip-types scripts/cli/gen.mjs 를 돌려 커밋: ${stale.join(', ')}\n`)
    process.exit(1)
  }
  process.stderr.write(check ? '[cli:gen] 생성물 최신\n' : '[cli:gen] 생성 끝\n')
}
