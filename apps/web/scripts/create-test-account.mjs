// [일회성] AX사업본부 팀원 테스트 계정 생성 — 앱 admin/users/actions.ts inviteUser + org-chart createNode 패턴 모방.
// 계정 생성은 SQL 직삽 금지·admin.createUser만 (토큰 NULL→로그인500 사고 방지).
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '')
const url = get('NEXT_PUBLIC_SUPABASE_URL')
const serviceKey = get('SUPABASE_SERVICE_ROLE_KEY')
if (!url || !serviceKey) { console.error('env 없음'); process.exit(1) }

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

const EMAIL = 'test@test.co.kr'
const NAME = '테스트계정'
const PASSWORD = 'Test1234!'

// 1) AX사업본부 org 노드 탐색
const { data: nodes, error: nErr } = await admin
  .from('org_nodes').select('id, name, type, parent_id').ilike('name', '%AX사업본부%')
if (nErr) { console.error('org_nodes 조회 실패', nErr.message); process.exit(1) }
const axNode = (nodes || []).find((n) => n.type !== 'person')
if (!axNode) { console.error('AX사업본부 노드 없음. 후보:', JSON.stringify(nodes)); process.exit(1) }

// 2) 계정 생성 (기존 동일 이메일 있으면 재사용)
const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
let user = list?.users?.find((x) => x.email === EMAIL)
if (user) {
  console.log('이미 존재하는 계정 재사용:', user.id)
  await admin.auth.admin.updateUserById(user.id, { password: PASSWORD, email_confirm: true })
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email: EMAIL, password: PASSWORD, email_confirm: true, user_metadata: { name: NAME },
  })
  if (error) { console.error('createUser 실패', error.message); process.exit(1) }
  user = data.user
}
const uid = user.id

// 3) profiles upsert (member, 로그인 직후 변경강제 없음)
const { error: pErr } = await admin.from('profiles').upsert(
  { id: uid, name: NAME, role: 'member', must_change_password: false }, { onConflict: 'id' }
)
if (pErr) { console.error('profiles upsert 실패', pErr.message); process.exit(1) }

// 4) AX사업본부 하위 person 노드 배치 (이미 있으면 skip)
const { data: existingPerson } = await admin
  .from('org_nodes').select('id').eq('user_id', uid).eq('type', 'person').maybeSingle()
let personNodeId = existingPerson?.id ?? null
if (!personNodeId) {
  const { data: sib } = await admin.from('org_nodes').select('display_order').eq('parent_id', axNode.id)
  const maxOrder = (sib && sib.length > 0) ? Math.max(...sib.map((s) => s.display_order ?? 0)) : -1
  const { data: created, error: cErr } = await admin.from('org_nodes').insert({
    type: 'person', parent_id: axNode.id, name: NAME, subtitle: null,
    user_id: uid, display_order: maxOrder + 1,
  }).select('id').single()
  if (cErr) { console.error('person 노드 생성 실패', cErr.message); process.exit(1) }
  personNodeId = created.id
}

console.log(JSON.stringify({
  ok: true, email: EMAIL, name: NAME, password: PASSWORD, role: 'member',
  user_id: uid, ax_node: { id: axNode.id, name: axNode.name }, person_node_id: personNodeId,
}, null, 2))
