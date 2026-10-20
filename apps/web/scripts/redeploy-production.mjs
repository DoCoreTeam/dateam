#!/usr/bin/env node
// scripts/redeploy-production.mjs — 운영 배포가 ERROR 면 같은 커밋을 다시 굽는다
//
// Vercel 빌드가 「Linting and checking validity of types」에서 멈춰 45분 상한에 잘리는 일이
// 2026-10-19~20 사이 다섯 번 있었다. 같은 커밋의 로컬 빌드는 통과했다(코드 무관).
// 사람이 직접 돌린다: node apps/web/scripts/redeploy-production.mjs
// 토큰은 앱과 같은 자리(org_content META)에서 읽고 출력에 싣지 않는다.

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
for (const p of [join(WEB, '.env.local'), join(WEB, '..', '..', '.env.local')]) {
  if (!existsSync(p)) continue
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

const { createClient } = await import('@supabase/supabase-js')
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const { data } = await sb.from('org_content').select('value').eq('key', 'META').single()
const meta = data?.value ?? {}
const q = meta.vercel_team_id ? `teamId=${encodeURIComponent(meta.vercel_team_id)}` : ''
const headers = { Authorization: `Bearer ${meta.vercel_api_token}`, 'Content-Type': 'application/json' }

const list = await (await fetch(`https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(meta.vercel_project_id)}&target=production&limit=1&${q}`, { headers })).json()
const last = list.deployments?.[0]
if (!last || last.state !== 'ERROR') {
  console.log(`[redeploy] 마지막 운영 배포가 ERROR 가 아닙니다 (${last?.state ?? '없음'}), 할 일 없음`)
  process.exit(0)
}
const res = await fetch(`https://api.vercel.com/v13/deployments?forceNew=1&${q}`, {
  method: 'POST', headers, body: JSON.stringify({ name: last.name, deploymentId: last.uid, target: 'production' }),
})
const body = await res.json()
console.log(res.ok ? `[redeploy] 다시 굽기 시작 ${body.id}, 확인은 pnpm deploy:state` : `[redeploy] Vercel 이 ${res.status} 로 답했습니다: ${body.error?.message ?? ''}`)
