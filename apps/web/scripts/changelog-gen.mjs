#!/usr/bin/env node
// 사용자향 업데이트 내역 자동 생성기 (SSOT) — 배포=게시.
//
// 동작: root package.json version vs entries.ts 최신 version 비교 → 올랐으면
//   git log(`vX.Y.Z: … claude`)에서 누락 구간 커밋을 버전별로 모아 →
//   Gemini가 "사용자 체감 변경"만 선별·친절어로 작성 → entries.ts 맨 위에 프리펜드.
//
// 멱등: 새로 추가할 사용자향 노트가 없으면 파일을 건드리지 않는다(=CI 커밋 없음).
// 무 LLM 신규도입: 기존 앱과 동일 generativelanguage REST(gemini-2.0-flash).
// 키 소스(SSOT): 앱과 동일하게 DB org_content(key='META').value.gemini_api_key 를
//   서비스롤로 조회(env GEMINI_API_KEY 폴백). → 새 시크릿 불필요(gcube와 동일 secrets 재사용).
//
// 실행:
//   node apps/web/scripts/changelog-gen.mjs            # 누락 구간 전체(첫 실행=백필)
//   node apps/web/scripts/changelog-gen.mjs --dry-run  # 미리보기(파일 미수정)
// env(택1): SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL  또는  GEMINI_API_KEY

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url)) // apps/web/scripts
const WEB = join(__dirname, '..') // apps/web
const ROOT = join(__dirname, '../../..') // repo root
const ENTRIES_PATH = join(WEB, 'lib/changelog/entries.ts')
const PKG_PATH = join(ROOT, 'package.json')
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta'
const VALID_KINDS = new Set(['feature', 'fix', 'improve'])
const DRY_RUN = process.argv.includes('--dry-run')
const ENV_KEYS = [
  'GEMINI_API_KEY', 'GEMINI_MODEL',
  'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
]

// ── 로컬 편의: .env.local에서 필요한 키 자동 로드(CI는 secrets로 주입되므로 무영향) ──
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

// 'a.b.c' 비교 — 양수면 v1>v2 (entries.ts cmpVersion과 동일 규약).
function cmpVersion(v1, v2) {
  const a = v1.split('.').map((n) => parseInt(n, 10) || 0)
  const b = v2.split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < 3; i++) { const d = (a[i] ?? 0) - (b[i] ?? 0); if (d !== 0) return d }
  return 0
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
}

// 앱 SSOT와 동일: DB org_content META에서 gemini 키/모델 조회(서비스롤). env 폴백.
async function getGeminiConfig() {
  let apiKey = ''
  let model = ''
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const svc = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (url && svc) {
    try {
      const { createClient } = await import('@supabase/supabase-js')
      const sb = createClient(url, svc, { auth: { persistSession: false } })
      const { data } = await sb.from('org_content').select('value').eq('key', 'META').single()
      const meta = (data?.value ?? {})
      if (typeof meta.gemini_api_key === 'string') apiKey = meta.gemini_api_key
      if (typeof meta.gemini_model === 'string') model = meta.gemini_model
    } catch (e) {
      console.warn('[changelog] DB META 조회 실패 — env 폴백 시도:', e.message)
    }
  }
  apiKey = apiKey || process.env.GEMINI_API_KEY || ''
  model = model || process.env.GEMINI_MODEL || 'gemini-2.0-flash'
  if (!apiKey) {
    throw new Error('Gemini 키 없음 — DB org_content META.gemini_api_key 또는 GEMINI_API_KEY 필요. ' +
      '(CI: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY 시크릿 등록)')
  }
  return { apiKey, model }
}

// entries.ts에 이미 존재하는 버전 + 최신 버전.
function readExistingVersions() {
  const src = readFileSync(ENTRIES_PATH, 'utf8')
  const versions = [...src.matchAll(/version:\s*'([\d.]+)'/g)].map((m) => m[1])
  const latest = versions.length ? [...versions].sort((a, b) => cmpVersion(b, a))[0] : '0.0.0'
  return { src, versions: new Set(versions), latest }
}

// git log에서 `vX.Y.Z: 메시지 claude` 커밋을 버전별로 수집(누락 구간만).
function collectMissingCommits(lastVersion, currentVersion) {
  const SEP = '\x1f' // unit separator — 커밋 메시지에 등장 불가
  const raw = git(['log', '--no-merges', '--date=short', `--pretty=format:%ad${SEP}%s`])
  const byVersion = new Map() // version -> { date, messages:Set }
  for (const line of raw.split('\n')) {
    const [date, subject = ''] = line.split(SEP)
    const m = subject.match(/^v(\d+\.\d+\.\d+):\s*(.+?)\s*(?:claude)?\s*$/i)
    if (!m) continue
    const version = m[1]
    if (cmpVersion(version, lastVersion) <= 0) continue        // 이미 게시됨
    if (cmpVersion(version, currentVersion) > 0) continue       // 현재 버전 초과(미래)
    const body = m[2].replace(/\s*\[skip changelog\]\s*/gi, '').trim()
    if (!body) continue
    if (!byVersion.has(version)) byVersion.set(version, { date, messages: new Set() })
    byVersion.get(version).messages.add(body)
    // git log는 최신이 먼저 → 첫 등장 date가 그 버전의 대표일로 유지
  }
  return [...byVersion.entries()]
    .map(([version, e]) => ({ version, date: e.date, messages: [...e.messages] }))
    .sort((a, b) => cmpVersion(b.version, a.version)) // 최신이 위
}

function buildPrompt(groups) {
  const blocks = groups
    .map((g) => `## v${g.version} (${g.date})\n${g.messages.map((m) => `- ${m}`).join('\n')}`)
    .join('\n\n')
  return `너는 B2B 업무 SaaS의 "사용자향 업데이트 내역" 작성자다. 아래는 버전별 개발자 커밋 메시지다.
로그인한 일반 사용자가 화면에서 직접 체감하는 변경만 골라, 귀엽고 친절한 비즈니스 한국어로 다시 써라.

[포함 ✅] 새 사용자 기능 · 사용자가 겪던 버그 수정 · 눈에 보이는 개선(속도/UI/편의)
[제외 ❌] 어드민 전용 · 백엔드/DB/인프라 · 리팩터/테스트/CI · 버전범프 · 내부검증/문구 · GPU 가격엔진 내부로직 등 사용자 비노출
[톤] "~했어요/~돼요" 체. 개발 용어·내부 표현·영문 약어 금지. 과장 금지.

[출력 형식] 반드시 아래 JSON만 출력(설명·코드펜스 금지):
{"notes":[{"version":"0.7.210","title":"이 업데이트 한 줄 요약","items":[{"kind":"feature|fix|improve","emoji":"한 글자 이모지","headline":"친절한 한 줄","detail":"1~2문장: 무엇이 되고 왜 좋은지"}]}]}

규칙:
- version은 반드시 입력에 등장한 버전 문자열 중 하나만 사용. 입력에 없는 버전 생성 금지.
- 사용자 체감 변경이 전혀 없는 버전은 notes에서 생략.
- 여러 버전의 비슷한 변경은 가장 높은 버전 하나로 합쳐도 됨.
- kind는 정확히 feature/fix/improve 중 하나. emoji는 내용에 맞는 1개.

[입력]
${blocks}`
}

async function callGemini(prompt, apiKey, model) {
  const res = await fetch(`${GEMINI_API_BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 },
    }),
  })
  if (!res.ok) throw new Error(`Gemini API error: ${res.status} ${res.statusText} — ${await res.text()}`)
  const json = await res.json()
  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? ''
  let parsed
  try { parsed = JSON.parse(text) } catch { throw new Error(`Gemini 응답 JSON 파싱 실패: ${text.slice(0, 400)}`) }
  return Array.isArray(parsed?.notes) ? parsed.notes : []
}

// TS 단일따옴표 문자열 리터럴(이스케이프).
function tsStr(s) {
  return `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`
}

function emitNote(n) {
  const items = n.items
    .map((it) => `      {
        kind: ${tsStr(it.kind)},
        emoji: ${tsStr(it.emoji)},
        headline: ${tsStr(it.headline)},
        detail: ${tsStr(it.detail)},
      },`)
    .join('\n')
  return `  {
    version: ${tsStr(n.version)},
    date: ${tsStr(n.date)},
    title: ${tsStr(n.title)},
    items: [
${items}
    ],
  },`
}

function prependNotes(src, notes) {
  const marker = 'export const CHANGELOG: ChangelogNote[] = ['
  const idx = src.indexOf(marker)
  if (idx === -1) throw new Error(`삽입 마커를 찾지 못함: ${marker}`)
  const eol = src.indexOf('\n', idx + marker.length)
  const before = src.slice(0, eol + 1)
  const after = src.slice(eol + 1)
  const block = notes.map(emitNote).join('\n') + '\n'
  return before + block + after
}

async function main() {
  loadEnvLocal()
  const currentVersion = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version
  const { src, versions: existing, latest } = readExistingVersions()

  if (cmpVersion(currentVersion, latest) <= 0) {
    console.log(`[changelog] 최신 게시본(${latest}) ≥ 현재(${currentVersion}) — 할 일 없음.`)
    return
  }

  const groups = collectMissingCommits(latest, currentVersion).filter((g) => !existing.has(g.version))
  if (groups.length === 0) {
    console.log(`[changelog] ${latest} 이후 사용자 커밋 없음 — 할 일 없음.`)
    return
  }
  console.log(`[changelog] 후보 버전 ${groups.length}개: ${groups.map((g) => g.version).join(', ')}`)

  const dateByVersion = new Map(groups.map((g) => [g.version, g.date]))
  const { apiKey, model } = await getGeminiConfig()
  console.log(`[changelog] Gemini(${model}) 호출…`)
  const aiNotes = await callGemini(buildPrompt(groups), apiKey, model)

  // 정제: 유효 버전·종류만, date는 git에서 주입(AI 날짜 환각 차단), 빈 노트 제거.
  const clean = aiNotes
    .filter((n) => n && typeof n.version === 'string' && dateByVersion.has(n.version) && !existing.has(n.version))
    .map((n) => ({
      version: n.version,
      date: dateByVersion.get(n.version),
      title: String(n.title || '업데이트').trim(),
      items: (Array.isArray(n.items) ? n.items : [])
        .filter((it) => it && it.headline)
        .map((it) => ({
          kind: VALID_KINDS.has(it.kind) ? it.kind : 'improve',
          emoji: String(it.emoji || '✨').trim(),
          headline: String(it.headline).trim(),
          detail: String(it.detail || '').trim(),
        })),
    }))
    .filter((n) => n.items.length > 0)
    .sort((a, b) => cmpVersion(b.version, a.version))

  if (clean.length === 0) {
    console.log('[changelog] AI 판단 결과 사용자향 변경 없음 — 게시 생략.')
    return
  }

  console.log(`[changelog] 게시 노트 ${clean.length}개: ${clean.map((n) => n.version).join(', ')}`)
  if (DRY_RUN) {
    console.log('--- DRY RUN (미리보기) ---')
    console.log(clean.map(emitNote).join('\n'))
    return
  }

  writeFileSync(ENTRIES_PATH, prependNotes(src, clean), 'utf8')
  console.log(`[changelog] entries.ts에 ${clean.length}개 블록 추가 완료.`)
}

main().catch((err) => {
  console.error('[changelog] 실패:', err.message)
  process.exit(1)
})
