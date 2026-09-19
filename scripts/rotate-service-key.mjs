#!/usr/bin/env node
/**
 * 서비스롤 키 회전 도우미
 *
 * **왜 이 파일이 있나**: 서비스롤 키는 RLS 를 통째로 지나간다. 이 키 하나가 새면
 * 2026-09-20 에 닫은 잠금이 전부 무의미해진다. 그런데 **돌리는 절차가 없었다** —
 * 절차가 없으면 "언젠가 돌려야지"로 남고, 그 언젠가는 오지 않는다.
 *
 * 이 스크립트는 키를 돌리지 않는다(그건 Supabase 화면에서 사람이 한다).
 * 대신 **어디를 바꿔야 하는지 지금 코드에서 직접 세어** 보여 주고,
 * 바꾼 뒤에 새 키가 실제로 도는지 확인한다. 손목록을 문서에 적으면 낡는다.
 *
 * 쓰는 법
 *   node scripts/rotate-service-key.mjs          — 바꿀 곳 목록
 *   node scripts/rotate-service-key.mjs --verify — 지금 키가 실제로 도는지 확인
 */
import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

const KEY = 'SUPABASE_SERVICE_ROLE_KEY'
const VERIFY = process.argv.includes('--verify')

function sh(cmd) {
  try { return execSync(cmd, { encoding: 'utf8' }) } catch { return '' }
}

if (!VERIFY) {
  console.log(`\n서비스롤 키 회전 — 바꿔야 하는 곳\n${'='.repeat(46)}\n`)

  console.log('① Supabase 화면에서 새 키 발급')
  console.log('   Project Settings → API Keys → service_role → Reveal / Generate new')
  console.log('   ⚠️ 새 키를 만들면 **옛 키는 즉시 죽는다.** ②③④를 먼저 준비하고 누른다.\n')

  console.log('② Vercel 환경변수')
  console.log(`   Project Settings → Environment Variables → ${KEY}`)
  console.log('   Production · Preview · Development 셋 다. 바꾼 뒤 **재배포해야** 적용된다.\n')

  const wf = sh(`grep -rl "${KEY}" .github/workflows 2>/dev/null`).split('\n').filter(Boolean)
  console.log(`③ GitHub Actions 비밀 (이 키를 쓰는 워크플로 ${wf.length}개)`)
  console.log('   Settings → Secrets and variables → Actions → SUPABASE_SERVICE_ROLE_KEY')
  wf.forEach((f) => console.log(`     · ${f}`))
  console.log()

  console.log('④ 내 컴퓨터')
  console.log('   apps/web/.env.local 의 해당 줄')
  console.log(`   지금 값 있음: ${existsSync('apps/web/.env.local') && readFileSync('apps/web/.env.local', 'utf8').includes(KEY) ? '예' : '아니오'}\n`)

  const code = sh(`grep -rl "${KEY}" --include="*.ts" --include="*.tsx" --include="*.mjs" apps/web/lib apps/web/app 2>/dev/null`)
    .split('\n').filter(Boolean)
  console.log(`⑤ 코드에서 이 키를 읽는 곳 ${code.length}곳 — **고칠 것은 없다.**`)
  console.log('   전부 환경변수에서 읽으므로 값만 바꾸면 된다. 여기 목록이 늘면 그때 다시 본다.')
  code.forEach((f) => console.log(`     · ${f}`))
  console.log()

  console.log('⑥ 바꾼 뒤')
  console.log('   node scripts/rotate-service-key.mjs --verify')
  console.log('   그리고 Vercel 재배포 후 화면에서 로그인 한 번.\n')
  process.exit(0)
}

// ── --verify: 지금 환경의 키가 실제로 도는가
const envPath = 'apps/web/.env.local'
if (!existsSync(envPath)) { console.error(`${envPath} 가 없다`); process.exit(1) }
const env = Object.fromEntries(
  readFileSync(envPath, 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)
const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env[KEY]
if (!url || !key) { console.error('URL 또는 키가 없다'); process.exit(1) }

// 서비스롤만 볼 수 있는 것을 하나 읽어 본다 (RLS 정책 0개인 표)
const res = await fetch(`${url}/rest/v1/public_request_throttle?select=bucket&limit=1`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
})
if (res.ok) {
  console.log('✅ 새 키가 돈다 — RLS 를 지나가는 읽기가 성공했다')
  console.log('   남은 것: Vercel 재배포 · GitHub Actions 한 번 돌려 보기')
} else {
  console.error(`❌ 키가 안 돈다 (HTTP ${res.status})`)
  console.error(`   ${(await res.text()).slice(0, 200)}`)
  process.exit(1)
}
