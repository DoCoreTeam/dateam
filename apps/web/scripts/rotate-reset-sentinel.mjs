#!/usr/bin/env node
/**
 * 공용 초기화 비밀번호가 걸려 있던 계정에 새 무작위 비밀번호를 넣는다
 *
 * **왜**: v0.11.48 전까지 관리자 초기화와 초대는 모든 계정에 코드에 적힌 같은 비밀번호를 넣었다.
 *   로그인 화면의 빈칸 로그인은 v0.11.48 에서 없앴지만, 그 비밀번호를 아는 사람은
 *   Supabase 인증 창구를 직접 불러 여전히 들어올 수 있다. 비밀번호 자체를 바꿔야 닫힌다.
 *
 * 대상: profiles.must_change_password = true 이고 지워지지 않은 계정 가운데
 *   **옛 공용 비밀번호로 실제 로그인이 되는 계정만.** 표시만 남고 자기 비밀번호를 이미 정한 사람을
 *   바꾸면 그 사람이 잠긴다(마이그 007 이 비관리자 전원에 표시를 일괄로 켠 전례가 있다).
 *   옛 비밀번호는 코드에 다시 적지 않는다, 실행할 때 OLD_RESET_PASSWORD 로 넘긴다.
 *
 * 사람에게 미치는 영향: 없음에 가깝다. 빈칸 로그인은 이미 막혔으므로 이 사람들은 어차피
 *   관리자가 「PW초기화」로 임시 비밀번호를 새로 받아야 들어온다. 이 스크립트는 그 사실을 바꾸지 않고
 *   인증 창구 직접 호출만 닫는다. 새 비밀번호는 어디에도 출력하거나 저장하지 않는다.
 *
 * 쓰는 법 (apps/web 에서):
 *   OLD_RESET_PASSWORD=... node scripts/rotate-reset-sentinel.mjs           옛 비밀번호가 통하는 계정 수만 센다
 *   OLD_RESET_PASSWORD=... node scripts/rotate-reset-sentinel.mjs --apply   그 계정만 바꾼다
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'

const { createClient } = createRequire(process.cwd() + '/package.json')('@supabase/supabase-js')

function readEnv(path) {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => {
        const i = line.indexOf('=')
        return [line.slice(0, i), line.slice(i + 1).replace(/^"|"$/g, '')]
      }),
  )
}

const env = { ...readEnv('.env.local'), ...process.env }
const url = env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const oldPassword = process.env.OLD_RESET_PASSWORD
if (!url || !serviceKey || !anonKey) {
  console.error('NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY 가 필요합니다')
  process.exit(1)
}
if (!oldPassword) {
  console.error('OLD_RESET_PASSWORD 가 필요합니다 (옛 공용 초기화 비밀번호)')
  process.exit(1)
}

const apply = process.argv.includes('--apply')
const admin = createClient(url, serviceKey, { auth: { persistSession: false } })

const { data: rows, error } = await admin
  .from('profiles')
  .select('id')
  .eq('must_change_password', true)
  .is('deleted_at', null)

if (error) {
  console.error('대상 조회 실패:', error.message)
  process.exit(1)
}

/** 옛 비밀번호로 들어가지는지 본다. 들어가지면 그 세션은 바로 닫는다 */
async function stillOnOldPassword(id) {
  const { data: got } = await admin.auth.admin.getUserById(id)
  const email = got?.user?.email
  if (!email) return false
  const probe = createClient(url, anonKey, { auth: { persistSession: false } })
  const { error: signInError } = await probe.auth.signInWithPassword({ email, password: oldPassword })
  if (signInError) return false
  // 이 확인용 세션만 닫는다. 기본값(global)은 그 사람의 다른 기기 세션까지 끊는다
  await probe.auth.signOut({ scope: 'local' })
  return true
}

const exposed = []
for (const { id } of rows) {
  if (await stillOnOldPassword(id)) exposed.push(id)
}

console.log(`표시 ${rows.length}명 중 옛 공용 비밀번호가 통하는 계정 ${exposed.length}명${apply ? '' : ' (세기만 함, 바꾸려면 --apply)'}`)
if (!apply) process.exit(0)

let changed = 0
let failed = 0
for (const id of exposed) {
  // 누구에게도 알려 주지 않을 값이다. 들어오려면 관리자가 임시 비밀번호를 새로 발급한다
  const { error: updateError } = await admin.auth.admin.updateUserById(id, {
    password: randomBytes(32).toString('base64url'),
  })
  if (updateError) {
    failed += 1
    console.error(`실패 ${id.slice(0, 8)}: ${updateError.message}`)
  } else {
    changed += 1
  }
}

console.log(`바꿈 ${changed}명, 실패 ${failed}명`)
process.exit(failed > 0 ? 1 : 0)
