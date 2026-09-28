#!/usr/bin/env node
// scripts/deploy-state.mjs — **「빌드 성공」은 「배포 성공」이 아니다**
//
// ## 왜 이것이 필요했나 (실측 2026-09-28)
//
// 로컬 프로덕션 빌드는 통과했는데 Vercel 배포 v0.10.651 은 ERROR 였다
// (`std::bad_alloc` · `SIGABRT` — 빌드 머신 메모리 고갈). 아무도 그것을 안 봤고,
// 운영은 **여드레 전 판(v0.10.649)에 멈춘 채로** 그 뒤 여섯 판이 사용자에게 영영 안 갔다.
// 커밋을 아무리 쌓아도 배포가 ERROR 면 사용자 화면은 하나도 안 바뀐다.
//
// ## 무엇을 하나
//
// 최근 운영 배포의 상태(`readyState`)와, ERROR 면 그 사유(`errorStep`·`errorMessage`)를 찍는다.
// 하나라도 ERROR 면 **종료 코드 1** 로 끝나므로 사람이 눈으로 세지 않아도 된다.
//
// ## 비밀은 코드에 없다
//
// 토큰은 앱과 **같은 자리**(org_content META)에서 읽는다 — 앱이 `lib/vercel/config.ts` 로
// 읽는 그 키 이름 그대로다. 출력에도 토큰을 안 싣는다.
//
//   pnpm deploy:state          최근 5판
//   pnpm deploy:state --last 1 최근 1판만

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = join(WEB, '..', '..')
const ENV_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']

/** META 에 저장하는 키 이름. 앱의 lib/vercel/config.ts 와 같은 문자열이어야 한다 */
const META_KEYS = { token: 'vercel_api_token', projectId: 'vercel_project_id', teamId: 'vercel_team_id' }

function loadEnvLocal() {
  for (const p of [join(WEB, '.env.local'), join(ROOT, '.env.local')]) {
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/)
      if (m && ENV_KEYS.includes(m[1]) && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    }
  }
}

async function readMeta() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !svc) return null
  const { createClient } = await import('@supabase/supabase-js')
  const sb = createClient(url, svc, { auth: { persistSession: false } })
  const { data } = await sb.from('org_content').select('value').eq('key', 'META').single()
  return data?.value ?? null
}

function argNumber(flag, fallback) {
  const at = process.argv.indexOf(flag)
  if (at === -1) return fallback
  const n = Number(process.argv[at + 1])
  return Number.isFinite(n) && n > 0 ? n : fallback
}

async function main() {
  loadEnvLocal()
  const meta = await readMeta()
  if (!meta) {
    console.error('[deploy-state] Supabase 접속 정보가 없어 META 를 못 읽었습니다 (.env.local 확인)')
    process.exit(2)
  }
  const token = String(meta[META_KEYS.token] ?? '').trim()
  const projectId = String(meta[META_KEYS.projectId] ?? '').trim()
  const teamId = String(meta[META_KEYS.teamId] ?? '').trim()
  if (!token || !projectId) {
    console.error('[deploy-state] Vercel 연동이 안 돼 있습니다 — 시스템 설정 → 외부 연동에서 넣어 주세요')
    process.exit(2)
  }

  const limit = argNumber('--last', 5)
  const team = teamId ? `&teamId=${encodeURIComponent(teamId)}` : ''
  const url = `https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(projectId)}&target=production&limit=${limit}${team}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
  if (!res.ok) {
    // 토큰은 안 싣는다 — 상태 코드만으로 원인이 갈린다 (401 권한 · 404 프로젝트 · 429 한도)
    console.error(`[deploy-state] Vercel 이 ${res.status} 로 답했습니다`)
    process.exit(2)
  }
  const body = await res.json()
  const rows = body.deployments ?? []
  if (rows.length === 0) {
    console.log('[deploy-state] 운영 배포가 하나도 없습니다')
    return
  }

  let bad = 0
  for (const d of rows) {
    const when = new Date(d.created ?? 0).toISOString().slice(5, 16).replace('T', ' ')
    const state = d.state ?? d.readyState ?? '?'
    const title = (d.meta?.githubCommitMessage ?? '').split('\n')[0].slice(0, 60)
    console.log(`${when}  ${String(state).padEnd(8)} ${title}`)
    if (state === 'ERROR' || state === 'CANCELED') {
      bad += 1
      const one = await fetch(`https://api.vercel.com/v13/deployments/${d.uid}${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''}`,
        { headers: { Authorization: `Bearer ${token}` } })
      if (one.ok) {
        const detail = await one.json()
        if (detail.errorStep) console.log(`          단계: ${detail.errorStep}`)
        if (detail.errorMessage) console.log(`          사유: ${String(detail.errorMessage).slice(0, 200)}`)
      }
    }
  }

  if (bad > 0) {
    console.error(`\n[deploy-state] 운영 배포 ${bad}판이 안 떴습니다. 커밋은 쌓여도 사용자 화면은 안 바뀝니다`)
    process.exit(1)
  }
  console.log('\n[deploy-state] 최근 운영 배포가 전부 떴습니다')
}

main().catch((e) => {
  console.error('[deploy-state] 실패:', e instanceof Error ? e.message : e)
  process.exit(2)
})
