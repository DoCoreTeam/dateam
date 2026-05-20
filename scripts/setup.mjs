/**
 * newAX 초기 셋업 스크립트
 * 사용법: node scripts/setup.mjs
 *        (루트 .env.local 또는 apps/web/.env.local 에서 키 자동 로드)
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function loadEnv() {
  const paths = [join(ROOT, '.env.local'), join(ROOT, 'apps/web/.env.local')]
  const env = {}
  for (const p of paths) {
    if (!existsSync(p)) continue
    const lines = readFileSync(p, 'utf8').split('\n')
    for (const line of lines) {
      const m = line.match(/^([^#=]+)=(.*)$/)
      if (m) env[m[1].trim()] = m[2].trim()
    }
  }
  return env
}

const env = loadEnv()
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('❌ .env.local 에서 다음 키를 찾을 수 없습니다:')
  console.error('   NEXT_PUBLIC_SUPABASE_URL')
  console.error('   SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const ADMIN_EMAIL = 'michaelkim@data-alliance.com'
const ADMIN_TEMP_PASSWORD = '1234'
const ADMIN_NAME = 'Michael Kim'

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function createAdminUser() {
  console.log(`👤 admin 계정 생성: ${ADMIN_EMAIL}`)

  const { data: existing, error: listError } = await supabase.auth.admin.listUsers()
  if (listError) {
    console.error('❌ service_role 키가 유효하지 않습니다:', listError.message)
    process.exit(1)
  }

  const alreadyExists = existing?.users?.find((u) => u.email === ADMIN_EMAIL)
  let userId

  if (alreadyExists) {
    console.log('   → 이미 존재하는 계정입니다 — 프로필만 업데이트합니다')
    userId = alreadyExists.id
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email: ADMIN_EMAIL,
      password: ADMIN_TEMP_PASSWORD,
      email_confirm: true,
      user_metadata: { name: ADMIN_NAME },
    })
    if (error) {
      console.error('❌ 유저 생성 실패:', error.message)
      process.exit(1)
    }
    userId = data.user.id
    console.log('   → 계정 생성 완료 (id:', userId, ')')
  }

  // handle_new_user 트리거 실행 대기
  await new Promise((r) => setTimeout(r, 1500))

  console.log('🗂️  profiles 테이블에 admin 설정 중...')
  const { error: profileError } = await supabase
    .from('profiles')
    .upsert({ id: userId, name: ADMIN_NAME, role: 'admin', must_change_password: true })

  if (profileError) {
    console.error('')
    console.error('⚠️  profiles 테이블 업데이트 실패 (마이그레이션 미실행)')
    console.error('   오류:', profileError.message)
    console.error('')
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.error('📋 STEP 1 — Supabase SQL Editor에서 실행하세요:')
    console.error('   https://tsnlplkslfcwtchzdaai.supabase.co → SQL Editor')
    console.error('   파일: supabase/migrations/001_initial_schema.sql')
    console.error('')
    console.error('📋 STEP 2 — SQL 실행 후 이 스크립트를 다시 실행하세요:')
    console.error('   node scripts/setup.mjs')
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    process.exit(1)
  }

  console.log('✅ admin 프로필 설정 완료')
  return true
}

async function main() {
  console.log('🚀 newAX 초기 셋업 시작\n')
  await createAdminUser()
  console.log('\n✅ 셋업 완료!')
  console.log(`   로그인 → ${ADMIN_EMAIL} / ${ADMIN_TEMP_PASSWORD}`)
  console.log('   최초 로그인 시 비밀번호 변경 화면으로 자동 이동합니다\n')
}

main().catch((e) => {
  console.error('❌ 오류:', e.message)
  process.exit(1)
})
