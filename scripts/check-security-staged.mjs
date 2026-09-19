#!/usr/bin/env node
/**
 * 커밋 직전 보안 확인 — 스테이지된 것만 본다
 *
 * 왜 여기인가: 테스트는 커밋 뒤에야 돌고, CI 는 그보다 더 뒤다.
 * 비밀은 한 번 커밋되면 지워도 기록에 남는다. 그래서 들어가기 전에 막는다.
 * (버전 규칙도 같은 이유로 .githooks/commit-msg 가 막는다)
 *
 * 세 가지만 본다. 넓게 잡으면 오탐이 나고, 오탐이 나면 사람이 훅을 끈다.
 *   1) 비밀 모양 문자열
 *   2) 표를 만들면서 RLS 를 안 켠 마이그레이션
 *   3) .env 파일을 통째로 커밋하려는 것
 *
 * 활성화: git config core.hooksPath .githooks
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const staged = execSync('git diff --cached --name-only --diff-filter=ACM', { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)

const problems = []

// ── 1) 비밀 모양 — 추가된 줄만 본다 (기존 줄까지 보면 남의 옛 코드에 걸린다)
const SECRET = /(sk-[A-Za-z0-9]{24,}|AIza[A-Za-z0-9_-]{30,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/
for (const f of staged) {
  if (!/\.(ts|tsx|js|mjs|jsx|json|sql|md|ya?ml)$/.test(f)) continue
  let diff = ''
  try { diff = execSync(`git diff --cached -U0 -- "${f}"`, { encoding: 'utf8' }) } catch { continue }
  for (const line of diff.split('\n')) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue
    if (SECRET.test(line)) problems.push(`비밀 모양 문자열: ${f}\n    ${line.slice(1, 90).trim()}`)
  }
}

// ── 2) 표를 만들면서 RLS 를 안 켠 마이그레이션
for (const f of staged.filter((x) => /^supabase\/migrations\/.*\.sql$/.test(x))) {
  let sql = ''
  try { sql = readFileSync(f, 'utf8') } catch { continue }
  const body = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ')
  const created = [...body.matchAll(/CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:public\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)/gi)]
    .map((m) => m[1].replace(/^public\./i, '').replace(/"/g, '').toLowerCase())
  if (!created.length) continue
  const enabled = new Set(
    [...body.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?((?:public\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)\s+(?:FORCE\s+)?ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi)]
      .map((m) => m[1].replace(/^public\./i, '').replace(/"/g, '').toLowerCase()),
  )
  const missing = created.filter((t) => !enabled.has(t))
  if (missing.length) {
    problems.push(
      `RLS 없이 만든 표: ${f}\n    ${missing.join(', ')}\n` +
        `    ALTER TABLE public.<표> ENABLE ROW LEVEL SECURITY; 를 같은 파일에 넣는다.\n` +
        `    CREATE TABLE AS 로 뜬 사본도 예외가 아니다 (원본 잠금이 안 따라온다)`,
    )
  }
}

// ── 3) .env 통째 커밋
for (const f of staged) {
  if (/(^|\/)\.env(\.|$)/.test(f) && !/\.example$/.test(f)) problems.push(`.env 파일을 커밋하려 한다: ${f}`)
}

if (problems.length) {
  console.error('[보안] 커밋 차단 — ' + problems.length + '건')
  problems.forEach((p) => console.error('  · ' + p))
  console.error('\n규칙은 LOOP.md 7절, 재는 방법은 docs/policy/security.md')
  process.exit(1)
}
console.log(`✅ 보안 가드 통과 — 스테이지 ${staged.length}개 파일, 비밀 0 · RLS 누락 0`)
