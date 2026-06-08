// [TEST] auth 계정 + 프로필 삭제 (cleanup.sql로 org/report 삭제 후 실행).
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '')
const admin = createClient(get('NEXT_PUBLIC_SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { autoRefreshToken: false, persistSession: false } })

const EMAILS = [
  'test-honbu@axhiertest.local', 'test-lead1@axhiertest.local',
  'test-mem1@axhiertest.local', 'test-lead2@axhiertest.local',
]
const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
let n = 0
for (const email of EMAILS) {
  const u = list?.users?.find((x) => x.email === email)
  if (u) {
    await admin.from('profiles').delete().eq('id', u.id)   // FK 정리(혹시 cascade 미작동 대비)
    const { error } = await admin.auth.admin.deleteUser(u.id)
    if (error) { console.error(email, error.message); continue }
    n++
  }
}
console.log(JSON.stringify({ deleted: n, of: EMAILS.length }))
