#!/usr/bin/env node
/**
 * scripts/retranscribe-part.mjs — 전사에 실패한 녹음 구간 하나를 다시 줄 세운다
 *
 * ## 왜 필요했나 (실측 2026-09-30)
 *
 * 52분짜리 회의의 한 구간(30~40분)이 `FAILED` 로 남았다. 사유는 업체가 준 400 이고
 * 내용은 `prompt length must be 896 characters or fewer` 였다. 전사에 꼭 필요하지도 않은
 * **힌트** 하나 때문에 10분치 소리가 회의록에서 빠졌다.
 *
 * 그 힌트 문제는 고쳤다(`lib/stt/provider.ts` — 거절당하면 힌트를 빼고 다시 보낸다).
 * 그런데 **이미 FAILED 로 굳은 구간은 아무도 다시 집지 않는다** — 드레인은 `UPLOADED` 만 집는다.
 * 소리는 서버에 그대로 있는데(오디오 청소는 `TRANSCRIBED` 만 지운다) 영영 글자가 안 된다.
 * 그 구간을 다시 줄 세우는 자리가 여기다.
 *
 * ## 되돌리는 법
 *
 *   이 스크립트는 한 행의 `status` 를 `FAILED` → `UPLOADED` 로 바꾸고 `error` 를 비운다.
 *   되돌리려면 같은 행의 `status` 를 `FAILED` 로 다시 쓰면 된다. 출력에 그 SQL 을 찍는다.
 *   **오디오와 전사 글자는 건드리지 않는다.**
 *
 * ## 쓰는 법
 *
 *   node scripts/retranscribe-part.mjs --note <noteId> --part <구간번호>
 *   node scripts/retranscribe-part.mjs --id <partId>
 *   node scripts/retranscribe-part.mjs --note ... --part ... --apply     실제로 바꾼다
 *
 * `--apply` 가 없으면 **아무것도 안 바꾸고** 무엇을 바꿀지만 보여 준다.
 * 대상은 반드시 인자로 받는다 — 조건 없는 일괄 갱신을 만들지 않는다(LOOP.md 7절 S2).
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = join(WEB, '..', '..')

function loadEnv() {
  for (const p of [join(WEB, '.env.local'), join(ROOT, '.env.local')]) {
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}

function arg(name) {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? null : process.argv[at + 1]
}

function fail(msg) {
  console.error(`[retranscribe] ${msg}`)
  process.exit(1)
}

loadEnv()
const SB = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const SVC = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SB || !SVC) fail('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 를 찾지 못했습니다 (.env.local)')

const headers = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' }
const rest = (path) => `${SB}/rest/v1/meeting_recording_part${path}`

const partId = arg('id')
const noteId = arg('note')
const partIdx = arg('part')
const apply = process.argv.includes('--apply')

// **대상을 안 주면 아무것도 안 한다.** 조건 없는 갱신을 만들 수 있는 길을 두지 않는다
let filter
if (partId) filter = `id=eq.${encodeURIComponent(partId)}`
else if (noteId && partIdx !== null) {
  filter = `note_id=eq.${encodeURIComponent(noteId)}&part_idx=eq.${encodeURIComponent(partIdx)}`
} else {
  fail('대상을 지정해 주세요: --id <partId> 또는 --note <noteId> --part <구간번호>')
}

const rows = await (await fetch(
  rest(`?${filter}&select=id,note_id,part_idx,status,retry_count,error,drive_file_id,audio_deleted_at,duration_sec`),
  { headers },
)).json()

if (!Array.isArray(rows) || rows.length === 0) fail('그런 구간이 없습니다')
if (rows.length > 1) fail(`구간이 ${rows.length}개 걸렸습니다 — 하나만 지정해 주세요`)

const r = rows[0]
console.log(`[retranscribe] 구간 ${r.part_idx} (${r.duration_sec}초) · 상태 ${r.status} · 시도 ${r.retry_count}`)
if (r.error) console.log(`[retranscribe] 지난 사유: ${r.error}`)

// 소리가 없으면 다시 줄 세워 봐야 같은 실패다. 사실대로 말하고 멈춘다
if (!r.drive_file_id) fail('이 구간에는 올라온 소리가 없습니다 — 다시 세워도 전사할 것이 없습니다')
if (r.audio_deleted_at) fail(`소리가 ${r.audio_deleted_at} 에 지워졌습니다 — 되살릴 수 없습니다`)
if (r.status === 'TRANSCRIBED') fail('이미 전사된 구간입니다 — 다시 세우면 같은 글자가 두 벌이 됩니다')

if (!apply) {
  console.log('[retranscribe] --apply 를 붙이면 status 를 UPLOADED 로 되돌리고 시도 횟수를 0 으로 둡니다')
  process.exit(0)
}

const res = await fetch(rest(`?id=eq.${encodeURIComponent(r.id)}`), {
  method: 'PATCH',
  headers: { ...headers, Prefer: 'return=representation' },
  body: JSON.stringify({ status: 'UPLOADED', error: null, retry_count: 0, claimed_at: null }),
})
if (!res.ok) fail(`되돌리지 못했습니다 (${res.status}) ${await res.text()}`)

console.log(`[retranscribe] 구간 ${r.part_idx} 를 전사 대기(UPLOADED)로 되돌렸습니다`)
console.log('[retranscribe] 되돌리려면:')
console.log(`  update meeting_recording_part set status='${r.status}', retry_count=${r.retry_count} where id='${r.id}';`)
console.log('[retranscribe] 드레인이 다음 판에 집습니다 (크론 또는 /api/meeting-notes/jobs/transcribe)')
