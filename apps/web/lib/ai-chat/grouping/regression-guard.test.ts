// 회귀 가드 — 이번 재정의의 계약이 코드에서 조용히 무너지는 것을 정적 스캔으로 차단한다.
//
// 왜 정적 스캔인가: 기능 테스트는 "지금 동작"을 보증하지만, 누군가 나중에 옛 경로를 되살리거나
// 배선을 빠뜨리는 것은 막지 못한다. 이번 사고들이 정확히 그 유형이었다:
//   - 지시가 추출에 전달되지 않는데 아무도 몰랐다(3세대 내내)
//   - 마이그 161이 적용 안 된 채 코드만 나갔다 / 163 번호가 두 계열에서 충돌했다
//   - 에러 원문을 삼켜 원인 규명에 DB 직접 조회가 필요했다
// 정말 필요한 예외는 같은 줄에 `// guard-ok` 주석으로 표시한다.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const WEB_ROOT = process.cwd()
const ANALYZE_DIR = join(WEB_ROOT, 'app/(member)/ai-chat/analyze')
const GROUPING_DIR = join(WEB_ROOT, 'lib/ai-chat/grouping')
const MIGRATIONS_DIR = join(WEB_ROOT, '../../supabase/migrations')

function listFiles(dir: string, exts: string[]): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name)
      if (statSync(p).isDirectory()) {
        if (name === '__fixtures__' || name === 'node_modules') continue
        walk(p)
        continue
      }
      if (exts.some((e) => name.endsWith(e))) out.push(p)
    }
  }
  walk(dir)
  return out
}

const read = (p: string): string => readFileSync(p, 'utf8')

/**
 * 가드 1 — 평탄화 추출 재유입 차단.
 * `parseListItems`/`mergeExtractedItems`(구 무손실 평탄화)는 그룹핑 경로에 절대 들어오면 안 된다.
 * 141개 파편 사고의 직접 원인이 이 두 함수였다.
 */
test('가드: 평탄화 추출(parseListItems/mergeExtractedItems)이 그룹핑 경로에 재유입되지 않는다', () => {
  const offenders: string[] = []
  for (const file of listFiles(GROUPING_DIR, ['.ts', '.tsx'])) {
    if (file.endsWith('regression-guard.test.ts')) continue
    const src = read(file)
    src.split('\n').forEach((line, i) => {
      if (line.includes('guard-ok')) return
      if (/\b(parseListItems|mergeExtractedItems)\b/.test(line)) {
        offenders.push(`${file.replace(WEB_ROOT, '')}:${i + 1}`)
      }
    })
  }
  assert.deepEqual(
    offenders,
    [],
    `그룹핑 모듈에 평탄화 추출이 재유입됐다(141개 파편 사고 재현 위험):\n${offenders.join('\n')}`,
  )
})

/**
 * 가드 2 — 지시(command) 배선 유지.
 * 사용자 지시가 유형판정·절단 프롬프트에 도달하지 않으면 이번 재정의 전체가 무효다.
 * 3세대 내내 이 배선이 없었고 아무도 알아채지 못했다.
 */
test('가드: 지시(command)가 유형판정·절단 프롬프트에 주입된다', () => {
  const classify = read(join(GROUPING_DIR, 'classify-doc.ts'))
  const cut = read(join(GROUPING_DIR, 'cut-groups.ts'))
  const pipeline = read(join(GROUPING_DIR, 'pipeline.ts'))

  assert.match(classify, /buildClassifyPrompt\s*\([^)]*command/s, 'buildClassifyPrompt가 command를 받아야 한다')
  assert.match(cut, /buildCutPrompt\s*\([^)]*command/s, 'buildCutPrompt가 command를 받아야 한다')

  // 파이프라인이 실제로 command를 두 프롬프트 빌더에 넘기는지
  assert.match(pipeline, /buildClassifyPrompt\(text,\s*command\)/, 'pipeline이 classify에 command를 전달해야 한다')
  assert.match(pipeline, /buildCutPrompt\(tree,[^)]*command\)/, 'pipeline이 cut에 command를 전달해야 한다')

  // 서버액션이 command를 받아 파이프라인에 넘기는지
  const actions = read(join(ANALYZE_DIR, 'grouping-actions.ts'))
  assert.match(
    actions,
    /runGrouping\(text,\s*command/,
    'analyzeDocument가 command를 runGrouping에 전달해야 한다 — 빠지면 지시가 항목화에 무영향',
  )
})

/**
 * 가드 3 — 마이그레이션 번호 중복 차단.
 * migrate.sh는 번호 prefix로 적용 여부를 추적한다. 같은 번호가 둘이면 **에러 없이 조용히 스킵**된다.
 * (실사고: 브랜치의 163_ai_analysis_templates 와 163_market_prices_observation_original 충돌)
 * 기존 부채(014/058/059/090)는 이번 범위 밖이라 baseline으로 허용하고, 신규 중복만 차단한다.
 */
const KNOWN_DUPLICATE_BASELINE = new Set(['014', '058', '059', '090'])

test('가드: 마이그레이션 번호가 중복되지 않는다(기존 부채 제외)', () => {
  const byNumber = new Map<string, string[]>()
  for (const name of readdirSync(MIGRATIONS_DIR)) {
    if (!name.endsWith('.sql')) continue
    const num = name.split('_')[0]
    byNumber.set(num, [...(byNumber.get(num) ?? []), name])
  }
  const newDuplicates = [...byNumber.entries()]
    .filter(([num, files]) => files.length > 1 && !KNOWN_DUPLICATE_BASELINE.has(num))
    .map(([num, files]) => `${num}: ${files.join(', ')}`)

  assert.deepEqual(
    newDuplicates,
    [],
    `마이그레이션 번호가 중복됐다 — migrate.sh가 에러 없이 조용히 스킵한다:\n${newDuplicates.join('\n')}`,
  )
})

/**
 * 가드 4 — 에러 은폐 차단.
 * DB 오류 분기에서 원문을 로그에 남기지 않고 고정 문자열만 반환하면, 이번 161 사고처럼
 * 화면에도 서버 로그에도 원인이 남지 않아 규명이 불가능해진다.
 */
test('가드: analyze 서버액션의 DB 오류 분기가 원문을 로그에 남긴다', () => {
  const offenders: string[] = []
  for (const file of listFiles(ANALYZE_DIR, ['.ts'])) {
    if (!file.endsWith('-actions.ts')) continue
    const src = read(file)
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      if (line.includes('guard-ok')) return
      // `if (error) return { ok: false, error: '...' }` 형태 = 로깅 없는 즉시 반환
      if (/if\s*\(\s*\w*[Ee]rr\w*\s*(\|\||\))/.test(line) && /return\s*\{\s*ok:\s*false/.test(line)) {
        // 같은 줄에서 끝나는 1줄 반환만 위험(블록이면 다음 줄에 logDbError가 올 수 있음)
        offenders.push(`${file.replace(WEB_ROOT, '')}:${i + 1}  ${line.trim().slice(0, 90)}`)
      }
    })
  }
  // 권한/검증 실패(auth.error, 입력 검증)는 DB 오류가 아니므로 제외
  const dbOffenders = offenders.filter((o) => !/auth\.error|권한이 없습니다/.test(o))
  assert.deepEqual(
    dbOffenders,
    [],
    `DB 오류를 로그 없이 삼키는 분기가 있다(원인 규명 불가로 이어짐):\n${dbOffenders.join('\n')}`,
  )
})
