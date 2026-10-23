/**
 * 새 동작의 정의 초안을 만드는 이름 규칙과 범위 규칙
 *
 * 여기서 정한 값은 초안일 뿐이고 정의 표(apps/web/lib/actions/defs)가 SSOT 다
 * 초안을 표에 옮긴 뒤 사람이 고친 값은 다시 덮어쓰지 않는다 (scaffold 는 없는 줄만 더함)
 */

/** 첫 경로 조각 → CLI 영역 */
const ROUTE_AREA = {
  crm: 'crm', accounts: 'crm', contacts: 'crm', deals: 'crm', leads: 'crm', 'lead-intakes': 'crm',
  ci: 'ci', content: 'ci',
  rfp: 'rfp',
  trading: 'trading',
  pricing: 'gpu',
  ai: 'studio',
  admin: 'admin', user: 'admin', settings: 'admin', 'system-log': 'admin', 'ui-preferences': 'admin',
  onboarding: 'admin', ping: 'admin', auth: 'admin',
  work: 'work', daily: 'work', 'weekly-report': 'work', calendar: 'work', 'meeting-notes': 'work',
  projects: 'work', reports: 'work', files: 'work', 'operations-html': 'work',
}

/** 영역 이름과 같은 첫 조각은 대상에서 뺀다 (crm/deals → deal), 나머지는 대상의 일부 */
const AREA_IS_PREFIX = new Set(['crm', 'ci', 'rfp', 'trading', 'pricing', 'ai', 'admin'])

/** 옛 CRM, 새 CRM 명령으로 대체 */
const LEGACY_ROOTS = new Set(['accounts', 'contacts', 'deals', 'leads', 'lead-intakes'])

const IRREGULAR = { people: 'person', companies: 'company', activities: 'activity', categories: 'category', entries: 'entry', policies: 'policy', histories: 'history', inquiries: 'inquiry', replies: 'reply', analyses: 'analysis', statuses: 'status', aliases: 'alias', batches: 'batch', matches: 'match', searches: 'search', news: 'news', settings: 'settings', series: 'series', status: 'status', analysis: 'analysis', access: 'access', ledger: 'ledger', process: 'process', progress: 'progress' }

export function singular(word) {
  if (IRREGULAR[word]) return IRREGULAR[word]
  if (/ies$/.test(word)) return word.replace(/ies$/, 'y')
  if (/(ss|us|is)$/.test(word)) return word
  if (/s$/.test(word)) return word.replace(/s$/, '')
  return word
}

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[_\s]+/g, '-').toLowerCase()

const SCOPE_RULES = [
  ['delete', /^(delete|remove|purge|revoke|destroy|drop|trash|discard|clear)/],
  ['approve', /^(approve|decide|commit|confirm|apply|accept|reject|adopt|resolve|promote)/],
  ['send', /^(send|mark-sent|sign|publish|dispatch|notify|invite|mail|share)/],
  ['read', /^(get|load|list|fetch|read|search|preview|export|count|find|check|peek|view|download|status|summary|lookup|resolve-read|has|is)/],
]

/** 이름(동사)으로 범위를 정한다, 메서드는 동사가 없을 때만 본다 */
export function scopeOf({ area, method, verb, path }) {
  if (area === 'admin' && !/^\/api\/(user|ui-preferences|ping|onboarding)\b/.test(path ?? '')) {
    return method === 'GET' || /^(get|load|list|fetch|read)/.test(verb) ? 'admin' : 'admin'
  }
  if (method === 'DELETE') return 'delete'
  const v = kebab(verb ?? '')
  for (const [scope, re] of SCOPE_RULES) if (re.test(v)) return scope
  if (method === 'GET') return 'read'
  return 'write'
}

function routeVerb(method, hasTrailingParam, sub) {
  const base = { GET: hasTrailingParam ? 'get' : 'list', POST: 'create', PATCH: 'update', PUT: 'set', DELETE: 'rm' }[method]
  if (!sub) return base
  if (method === 'GET') return hasTrailingParam ? `${sub}-get` : sub
  if (method === 'POST') return sub
  return `${sub}-${base}`
}

/** 라우트 동작 하나의 정의 초안 */
export function draftRouteDef(op) {
  const segs = op.path.split('/').slice(2) // /api 뒤
  const root = segs[0]
  const area = ROUTE_AREA[root] ?? 'work'
  const rest0 = AREA_IS_PREFIX.has(root) ? segs.slice(1) : segs
  // pricing/gpu/... 의 gpu 는 영역 이름과 같은 말이라 뺀다 (gpu gpu x 가 안 되게)
  const rest = area === 'gpu' && rest0[0] === 'gpu' && rest0.length > 1 ? rest0.slice(1) : rest0
  const statics = rest.filter((s) => !s.startsWith('{'))
  const hasTrailingParam = rest.length > 0 && rest[rest.length - 1].startsWith('{')
  const base = singular(statics[0] ?? root)
  const target = LEGACY_ROOTS.has(root) ? `legacy-${base}` : base
  const sub = statics.slice(1).join('-')
  const verb = routeVerb(op.method, hasTrailingParam, sub)
  const def = {
    op: op.key,
    name: `${area}.${target}.${verb}`,
    scope: op.adminOnly && op.method !== 'GET' ? 'admin' : scopeOf({ area, method: op.method, verb: sub || verb, path: op.path }),
    cli: `${area} ${target} ${verb}`,
  }
  if (LEGACY_ROOTS.has(root)) def.legacy = '이관 중, 새 CRM 명령으로 대체'
  if (root === 'auth') def.webOnly = 'Google Drive 연결은 브라우저 OAuth 동의 화면이 필요함'
  if (root === 'cron') def.machine = '크론이 부르는 기계 창구, 사람이 누르는 동작 아님'
  return def
}

/** 서버 액션 하나의 정의 초안 */
export function draftActionDef(op) {
  const [file, fn] = op.path.split('#')
  const parts = file.replace(/\.tsx?$/, '').split('/').filter((s) => !(s.startsWith('(') && s.endsWith(')')))
  // app/(member)/daily/actions → [app, daily, actions]
  const dirParts = parts.slice(1).filter((s) => s !== 'actions')
  const group = file.match(/\((\w+)\)/)?.[1]
  let area = 'work'
  if (group === 'ai') area = 'studio'
  else if (group === 'trading') area = 'trading'
  else if (dirParts[0] === 'admin') area = 'admin'
  const tail = dirParts.filter((s) => !['admin', 'ai', 'trading'].includes(s)).map((s) => s.replace(/-actions?$/, '').replace(/-action$/, ''))
  const target = tail.length ? tail.join('-') : area === 'studio' ? 'chat' : area === 'trading' ? 'signal' : 'misc'
  const verb = kebab(fn)
  const def = {
    op: op.key,
    name: `${area}.${target}.${verb}`,
    scope: scopeOf({ area, method: 'POST', verb: fn, path: file }),
    cli: `${area} ${target} ${verb}`,
  }
  if (/^app\/\((auth)\)\/|^app\/change-password\/|^app\/security\//.test(file)) {
    def.webOnly = '로그인 비밀번호 2단계 인증 화면, 브라우저 인증 화면은 웹에만 둠'
  }
  return def
}

/** 기존 공개 API 동작의 정의 초안, 경로와 응답 모양은 그대로 두고 범위와 CLI 이름만 붙인다 */
export function draftPublicDef(op) {
  const segs = op.path.replace('/api/public/v1/', '').split('/')
  const root = segs[0]
  const hasTrailingParam = segs[segs.length - 1].startsWith('{')
  if (root === 'openapi.json') {
    return { op: op.key, name: 'meta.openapi.get', scope: 'read', cli: 'sync', summary: 'CLI 명령 표의 원본 (teamda sync 가 받음)' }
  }
  let area = 'gpu'
  let rest = segs
  if (root === 'crm' || root === 'ci') { area = root; rest = segs.slice(1) }
  if (['accounts', 'contacts', 'deals'].includes(root)) area = 'crm'
  const legacy = ['accounts', 'contacts', 'deals'].includes(root)
  const target = (legacy ? 'legacy-' : '') + singular(rest[0])
  const verb = { GET: hasTrailingParam ? 'get' : 'list', POST: 'create', PATCH: 'update', PUT: 'set', DELETE: 'rm' }[op.method]
  const def = {
    op: op.key,
    name: `${area}.${target}.${verb}-v1`,
    scope: 'read',
    cli: `${area} ${target} ${verb}-v1`,
  }
  if (op.method === 'DELETE') def.scope = 'delete'
  else if (op.method !== 'GET') def.scope = root === 'settings' ? 'admin' : 'write'
  if (root === 'quote') { def.scope = 'read'; def.name = 'gpu.quote.calc'; def.cli = 'gpu quote' }
  if (['accounts', 'contacts', 'deals'].includes(root)) def.legacy = '이관 중, 새 CRM 명령으로 대체'
  return def
}
