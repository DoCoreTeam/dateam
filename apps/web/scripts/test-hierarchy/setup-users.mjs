// [TEST] 계층 권한 검증용 테스트 계정 생성 — 종료 후 cleanup-users.mjs로 전부 삭제.
// service role 사용 (앱 admin/users/actions.ts inviteUser 패턴 모방).
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

// apps/web/.env.local 로드 (이 파일 기준 ../../.env.local)
const env = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '')
const url = get('NEXT_PUBLIC_SUPABASE_URL')
const serviceKey = get('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !serviceKey) { console.error('env 없음'); process.exit(1) }

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

const PASSWORD = 'TestHier!2026'
const USERS = [
  { key: 'honbu', email: 'test-honbu@axhiertest.local', name: '[TEST]본부장' },
  { key: 'lead1', email: 'test-lead1@axhiertest.local', name: '[TEST]1팀장' },
  { key: 'mem1',  email: 'test-mem1@axhiertest.local',  name: '[TEST]1팀원' },
  { key: 'lead2', email: 'test-lead2@axhiertest.local', name: '[TEST]2팀장' },
]

const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
const out = {}
for (const u of USERS) {
  const existing = list?.users?.find((x) => x.email === u.email)
  if (existing) await admin.auth.admin.deleteUser(existing.id)
  const { data, error } = await admin.auth.admin.createUser({
    email: u.email, password: PASSWORD, email_confirm: true, user_metadata: { name: u.name },
  })
  if (error) { console.error(u.email, error.message); process.exit(1) }
  const id = data.user.id
  await admin.from('profiles').upsert(
    { id, name: u.name, role: 'member', must_change_password: false }, { onConflict: 'id' }
  )
  out[u.key] = { id, email: u.email }
}
console.log(JSON.stringify({ password: PASSWORD, users: out }, null, 2))
