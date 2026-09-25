/**
 * **지식은 그때 알 수 있던 것만 쓰고, AI 는 설정을 못 바꾼다** (§15.2 · §15.3 · §16)
 *
 * 무엇을 세나
 *   ① Gemini 산출물을 `available_at` 없이 읽는 자리
 *   ② AI 가 설정을 직접 쓰는 길
 *   ③ 지식 호출이 기존 AI 계층을 안 지나는 자리
 *   ④ 알림 경로가 AI 를 기다리는 자리
 *   ⑤ 새 키 풀·새 예산·새 원장
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KNOWLEDGE_TABLES } from '../trading/knowledge/as-of.ts'
import { KNOWLEDGE_SURFACE, KNOWLEDGE_PURPOSES } from '../trading/knowledge/surface.ts'
import { AI_LANES } from '../ai/actor.ts'

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TRADING = join(WEB, 'lib', 'trading')
const TRADING_APP = join(WEB, 'app', '(member)', 'trading')

function walk(dir: string): string[] {
  let out: string[] = []
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { out = out.concat(walk(full)); continue }
    if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue
    if (name.endsWith('.test.ts')) continue
    out.push(full)
  }
  return out
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
}

/** `import` 줄을 지운다. **들여온 것은 부른 것이 아니다** */
function stripImports(src: string): string {
  return stripComments(src)
    .replace(/^\s*import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, ' ')
    .replace(/^\s*import\s+['"][^'"]+['"];?\s*$/gm, ' ')
}

function sources(): { file: string; src: string; raw: string }[] {
  return [...walk(TRADING), ...walk(TRADING_APP)].map((file) => {
    const raw = readFileSync(file, 'utf8')
    return { file: relative(WEB, file), src: stripImports(raw), raw: stripComments(raw) }
  })
}

test('★ 검사 대상이 있다 — 0개면 아래 단정은 언제나 초록이다', () => {
  const files = sources()
  assert.ok(files.length >= 60, `대상이 ${files.length}개뿐이다. 경로가 바뀌었는지 확인한다`)
  assert.ok(files.some((f) => f.src.includes('callKnowledge')), '지식 호출을 못 찾았다')
  assert.ok(files.some((f) => f.src.includes('applyAsOf')), 'as-of 적용을 못 찾았다')
})

// ── ① as-of ─────────────────────────────────────────────

test('★ 지식 표를 읽는 자리가 전부 as-of 를 지난다', () => {
  const offenders: string[] = []
  for (const { file, src } of sources()) {
    for (const table of KNOWLEDGE_TABLES) {
      // 이 표에서 읽는가
      if (!new RegExp(`from\\('${table}'\\)[\\s\\S]{0,200}?\\.select\\(`).test(src)) continue
      // 그 자리가 as-of 를 지나는가. 읽는 파일에 `applyAsOf` 가 있어야 한다
      if (src.includes('applyAsOf(')) continue
      /**
       * 예외 둘. 둘 다 **시점 조회가 아니다**:
       *   · `.eq('id'` — 한 행을 집어 갱신한다. 「지금 그 행」을 보는 것이다
       *   · `.neq('status', 'done')` — 지금 할 일을 고른다. as-of 를 걸면 방금 넣은 자료를
       *     「아직 알 수 없는 것」으로 보고 영영 안 분석한다
       */
      if (/\.eq\('id'/.test(src)) continue
      if (/\.neq\('status', 'done'\)/.test(src)) continue
      offenders.push(`${file} — ${table}`)
    }
  }
  assert.deepEqual(offenders, [],
    `지식 표를 as-of 없이 읽는다 — 미래에 쓴 글이 과거 판단에 섞인다:\n  ${offenders.join('\n  ')}`)
})

test('★ 지식 표 여섯이 전부 `available_at` 을 갖고 기본값이 박혀 있다', () => {
  const sql = readFileSync(join(WEB, '..', '..', 'supabase', 'migrations', '285_trading_knowledge.sql'), 'utf8')
  const defaults = sql.match(/available_at\s+TIMESTAMPTZ NOT NULL DEFAULT now\(\)/g) ?? []
  assert.equal(defaults.length, KNOWLEDGE_TABLES.length)
  for (const t of KNOWLEDGE_TABLES) assert.ok(sql.includes(t), `${t} 가 마이그레이션에 없다`)
})

// ── ② AI 가 설정을 못 바꾼다 (§15.3) ─────────────────────

/** 설정을 쓰는 것이 허용된 자리. **여기 말고는 없다** */
const SETTING_WRITERS = [
  'lib/trading/settings/store.ts',
  // 사람이 후보를 받아들이는 자리. 사람 ID 가 필수다
  'lib/trading/knowledge/proposal.ts',
  // 사람이 화면에서 누르는 창구
  'app/(member)/trading/actions.ts',
]

test('★ AI 가 설정을 직접 쓰는 길이 0개다', () => {
  const offenders: string[] = []
  for (const { file, src } of sources()) {
    if (SETTING_WRITERS.includes(file)) continue
    if (/saveTradingSetting\s*\(/.test(src)) offenders.push(`${file} — saveTradingSetting`)
    if (/from\('trading_settings'\)[\s\S]{0,200}?\.(insert|update|upsert)\(/.test(src)) {
      offenders.push(`${file} — trading_settings 쓰기`)
    }
  }
  assert.deepEqual(offenders, [],
    `AI 가 닿는 자리에서 설정을 쓴다:\n  ${offenders.join('\n  ')}`)
})

test('★ 허용 목록이 죽지 않았다 — 실제로 쓰는 자리만 남아 있다', () => {
  const byFile = new Map(sources().map((s) => [s.file, s.src]))
  for (const f of SETTING_WRITERS) {
    const src = byFile.get(f)
    assert.ok(src !== undefined, `${f} 가 없다. 허용 목록을 고친다`)
    assert.ok(
      /saveTradingSetting\s*\(|from\('trading_settings'\)/.test(src),
      `${f} 는 이제 설정을 안 쓴다. 허용 목록에서 뺀다`,
    )
  }
})

test('★ 후보를 받아들이는 자리에 사람 ID 가 필수다', () => {
  const src = readFileSync(join(TRADING, 'knowledge', 'proposal.ts'), 'utf8')
  const fn = src.slice(src.indexOf('export async function decideProposal'))
  assert.ok(fn.includes('if (!input.actorUserId)'), '사람 없이 받아들여진다')
  assert.ok(fn.includes('changedBy: input.actorUserId'), '누가 바꿨는지가 안 남는다')
})

// ── ③④⑤ AI 계층 ─────────────────────────────────────────

test('★ 트레이딩이 Gemini 를 직접 두드리는 자리가 0개다', () => {
  const offenders: string[] = []
  for (const { file, src } of sources()) {
    if (/generativelanguage|x-goog-api-key|\?key=\$\{/.test(src)) offenders.push(file)
  }
  assert.deepEqual(offenders, [], `벤더 주소가 코드에 있다:\n  ${offenders.join('\n  ')}`)
})

test('★ 지식 호출이 표면 하나로 모인다', () => {
  assert.equal(KNOWLEDGE_SURFACE, 'trading_knowledge')
  assert.equal(KNOWLEDGE_PURPOSES.length, 6)
  const src = readFileSync(join(TRADING, 'knowledge', 'ai-call.ts'), 'utf8')
  assert.ok(src.includes("const expectedSurface: 'trading_knowledge'"),
    '표면 이름이 글자로 안 박혀 있다 — 갈려도 형 검사가 안 잡는다')
})

test('★ 벤더로 나가는 트레이딩 파일이 전부 AI_LANES 에 있다', () => {
  const lanes = new Set(AI_LANES.map((l) => l.file))
  const vendorFiles = sources()
    .filter(({ src }) => /chat\/completions|callGeminiText\s*\(|callGeminiJson\s*\(/.test(src))
    .map(({ file }) => file)
  assert.ok(vendorFiles.length >= 2, `벤더로 나가는 파일이 ${vendorFiles.length}개뿐이다`)
  const missing = vendorFiles.filter((f) => !lanes.has(f))
  assert.deepEqual(missing, [], `등재부에 없다:\n  ${missing.join('\n  ')}`)
})

test('★ 알림이 나가는 길에 AI 호출이 0개다 (M2 · §12)', () => {
  const NOTIFY_PATH = [
    'lib/trading/notify/outbox.ts', 'lib/trading/notify/outbox-policy.ts',
    'lib/trading/jobs/emit-signal.ts', 'lib/trading/signal/emit.ts',
    'lib/trading/signal/store.ts', 'lib/trading/jobs/watch.ts',
  ]
  const byFile = new Map(sources().map((s) => [s.file, s.raw]))
  for (const f of NOTIFY_PATH) {
    const raw = byFile.get(f)
    assert.ok(raw !== undefined, `${f} 가 없다. 목록을 고친다`)
    for (const banned of ['callKnowledge', 'callGeminiText', 'explainSignal', 'judgeExitShadow', 'knowledge/']) {
      assert.equal(raw.includes(banned), false,
        `${f} 가 ${banned} 에 닿는다 — 알림이 AI 를 기다리게 된다`)
    }
  }
})
