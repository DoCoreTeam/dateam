/**
 * 키 소유자로 처리 함수 부르기 (P0158 I06)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { issueActingGrant, runActing, currentActing, type ActingContext } from './acting-session.ts'
import { createSessionMinter } from './acting-as.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const CTX: ActingContext = {
  userId: 'u1', role: 'member', keyId: 'k1', scopes: ['read'], requestId: 'r1',
  session: { accessToken: 'at-secret', refreshToken: 'rt-secret', expiresAt: 2_000_000_000 },
}

test('문맥 밖에서는 currentActing 이 없다, 열면 안에서만 보이고 끝나면 사라진다', async () => {
  assert.equal(currentActing(), undefined)
  const grant = issueActingGrant(CTX)
  const seen = await runActing(grant, async () => {
    await new Promise((r) => setTimeout(r, 5))
    return currentActing()?.userId
  })
  assert.equal(seen, 'u1')
  assert.equal(currentActing(), undefined)
})

test('★ 관문이 만든 허가증이 아니면 문맥이 안 열린다', () => {
  const forged = { ctx: CTX }
  assert.throws(() => runActing(forged, () => 1), /grant not issued/)
  assert.throws(() => issueActingGrant({ ...CTX, keyId: '' }), /verified key owner/)
  assert.throws(() => issueActingGrant({ ...CTX, session: { ...CTX.session, accessToken: '' } }))
})

test('허가증의 문맥은 바꿀 수 없다', () => {
  const grant = issueActingGrant(CTX)
  assert.throws(() => { (grant.ctx as { userId: string }).userId = 'admin' })
})

function fakeDeps(log: string[], now = 1_000_000_000_000) {
  return {
    now: () => now,
    emailOf: async (id: string) => (id === 'ghost' ? null : `${id}@x.co`),
    generateLink: async (email: string) => { log.push(`link:${email}`); return { tokenHash: 'h', error: null } },
    verifyOtp: async () => { log.push('verify'); return { session: { accessToken: 'a', refreshToken: 'r', expiresAt: now / 1000 + 3600 }, error: null } },
  }
}

test('세션은 사용자별로 캐시되고 동시에 불러도 한 번만 만든다', async () => {
  const log: string[] = []
  const m = createSessionMinter(fakeDeps(log))
  const [a, b] = await Promise.all([m.sessionFor('u1'), m.sessionFor('u1')])
  assert.ok(a.ok && b.ok)
  await m.sessionFor('u1')
  assert.deepEqual(log, ['link:u1@x.co', 'verify'])
  await m.sessionFor('u2')
  assert.equal(m.size(), 2)
})

test('만료가 가까우면 새로 만들고, 없는 사용자는 no_user', async () => {
  const log: string[] = []
  let now = 1_000_000_000_000
  const deps = { ...fakeDeps(log), now: () => now }
  const m = createSessionMinter(deps)
  await m.sessionFor('u1')
  now += (3600 - 60) * 1000
  await m.sessionFor('u1')
  assert.equal(log.filter((l) => l === 'verify').length, 2)
  assert.deepEqual(await m.sessionFor('ghost'), { ok: false, reason: 'no_user' })
})

test('★ createClient 가 관문 안에서만 키 소유자 세션을 쓰고, 토큰을 로그에 안 찍는다', () => {
  const src = readFileSync(join(WEB, 'lib', 'supabase', 'server.ts'), 'utf8')
  const body = src.slice(src.indexOf('export async function createClient('))
  const head = body.slice(0, body.indexOf('const cookieStore'))
  assert.match(head, /const acting = currentActing\(\)\s*\n\s*if \(acting\) return actingClient\(acting\)/)
  assert.match(src, /generateLink\(\{ type: 'magiclink'/)
  assert.match(src, /verifyOtp\(\{ token_hash/)
  for (const f of ['server.ts']) {
    const s = readFileSync(join(WEB, 'lib', 'supabase', f), 'utf8')
    assert.doesNotMatch(s, /console\.\w+\([^)]*(access_?[tT]oken|refresh_?[tT]oken|tokenHash|hashed_token)/)
  }
  const acting = readFileSync(join(WEB, 'lib', 'actions', 'acting-as.ts'), 'utf8')
  assert.doesNotMatch(acting, /console\./)
})

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.next') || name === 'generated') continue
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

/** 문맥을 여는 함수를 부를 수 있는 파일, 관문 하나와 이 모듈뿐 */
const MAY_OPEN = new Set(['lib/actions/acting-session.ts', 'lib/actions/dispatch.ts', 'lib/actions/acting-as.test.ts'])

test('★ 관문 밖 파일이 acting 문맥을 여는 길이 없다', () => {
  const offenders: string[] = []
  for (const dir of ['app', 'lib', 'components']) {
    for (const f of walk(join(WEB, dir))) {
      const rel = relative(WEB, f).split('\\').join('/')
      if (MAY_OPEN.has(rel)) continue
      const s = readFileSync(f, 'utf8')
      if (/\b(issueActingGrant|runActing)\b/.test(s)) offenders.push(rel)
    }
  }
  assert.deepEqual(offenders, [])
})
