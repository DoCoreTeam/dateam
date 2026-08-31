// lib/ci/relation-contract.test.ts — 삭제 릴레이션 계약 가드
//
// 이 가드가 막는 것: **선언만 하고 안 거는 것.**
//   relation-contract.ts가 "채널→게시물은 소유(owns)"라고 선언해도, 마이그레이션이
//   실제로 ON DELETE CASCADE를 걸지 않으면 아무 일도 안 일어난다. 그리고 그 어긋남은
//   **채널을 지워 보기 전까지 아무도 모른다** — 실제로 그래서 게시물 55건이 남았다.
//
// 정적으로 검사할 수 있는 것만 여기서 본다. 실제 데이터가 새고 있는지는
// `pnpm ci:orphans`(운영 DB 접속)가 따로 센다 — 둘 다 필요하다.

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CI_RELATIONS, CI_PARENT_TABLE, ownedBy, referencedBy, polymorphicRefs, orphanProbes,
  type CiRelationParent, type CiRelation,
} from './relation-contract.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..', '..')
/**
 * 계약을 거는 SQL 은 **한 파일에만 있지 않다.**
 *
 * 208 이 처음 걸었고, 그 뒤 새 표가 생길 때마다 그 표의 마이그레이션이 자기 몫을 건다.
 * 208 만 읽으면 나중에 더한 트리거가 «선언만 하고 안 걸었다»로 잘못 잡힌다 —
 * 그러면 다음 사람은 가드를 고치는 대신 **계약에서 선언을 지운다.** 그게 최악이다.
 */
const MIGRATIONS = [
  '208_ci_delete_contract.sql',
  '239_ci_signal_candidates.sql',
].map((f) => join(repoRoot, 'supabase', 'migrations', f))
const DELETE_TS = join(here, 'queries', 'delete.ts')

const migrationSql = MIGRATIONS.map((f) => readFileSync(f, 'utf8')).join('\n')
const deleteTs = readFileSync(DELETE_TS, 'utf8')

const PARENTS = Object.keys(CI_RELATIONS) as CiRelationParent[]

/** 공백을 하나로 눌러 SQL을 한 줄로 본다 — 줄바꿈 위치가 판정을 흔들지 않게. */
const flatSql = migrationSql.replace(/\s+/g, ' ').toLowerCase()

// ── 계약 자체의 무결성 ────────────────────────────────────────

test('모든 관계는 owns·refs·work 중 하나로 분류돼 있다 — 미분류를 남기지 않는다', () => {
  for (const parent of PARENTS) {
    for (const r of CI_RELATIONS[parent]) {
      assert.ok(
        r.kind === 'owns' || r.kind === 'refs' || r.kind === 'work',
        `${parent}.${r.table}.${r.column}의 종류가 셋 중 하나가 아니다: ${r.kind}`,
      )
    }
  }
})

test('폴리모픽(FK 불가)은 work로만 분류한다 — owns로 두면 FK를 건 줄 착각한다', () => {
  // 왜: discriminator가 있다는 건 한 컬럼이 여러 부모를 가리킨다는 뜻이고, 그러면 FK를
  // 걸 수 없다. 그걸 owns로 적으면 "CASCADE가 걸려 있겠지"라고 읽혀 트리거를 빠뜨린다.
  for (const parent of PARENTS) {
    for (const r of CI_RELATIONS[parent]) {
      if (!r.discriminator) continue
      assert.equal(r.kind, 'work',
        `${r.table}.${r.column}은 폴리모픽인데 '${r.kind}'로 분류됐다 — FK를 걸 수 없으므로 work여야 한다`)
    }
  }
})

test('같은 (테이블, 컬럼, 구분값)을 두 번 선언하지 않는다', () => {
  for (const parent of PARENTS) {
    const seen = new Set<string>()
    for (const r of CI_RELATIONS[parent]) {
      const key = `${r.table}.${r.column}.${r.discriminator?.value ?? '-'}`
      assert.ok(!seen.has(key), `${parent}에 ${key}이 두 번 선언됐다`)
      seen.add(key)
    }
  }
})

test('사용자에게 보이는 라벨에 테이블 이름을 쓰지 않는다 — 확인창은 사람이 읽는다', () => {
  for (const parent of PARENTS) {
    for (const r of CI_RELATIONS[parent]) {
      if (!r.countForUser) continue
      assert.ok(!/\bci_[a-z_]+\b/.test(r.label),
        `${parent}의 라벨에 테이블 이름이 들어 있다: "${r.label}"`)
    }
  }
})

// ── 계약 ↔ 마이그레이션 SQL 대조 ──────────────────────────────

test('owns로 선언한 관계는 마이그레이션이 실제로 CASCADE를 건다', () => {
  // 이 단정이 이 파일의 존재 이유다. 선언과 DB가 갈리면 화면은 계약대로 말하는데
  // 데이터는 옛 규칙대로 움직인다 — 채널 삭제 사고가 정확히 그 상태였다.
  const missing: string[] = []
  for (const parent of PARENTS) {
    for (const r of CI_RELATIONS[parent]) {
      if (r.kind !== 'owns') continue
      // 마이그 208이 다시 거는 것만 검사한다. 원래 표를 만들 때부터 CASCADE였던 것은
      // 그 표의 마이그레이션에 있으므로 여기서 요구하지 않는다.
      const rebindsHere = flatSql.includes(`alter table ${r.table} `)
        && flatSql.includes(`foreign key (${r.column})`)
      if (!rebindsHere) continue
      const hasCascade = new RegExp(
        `foreign key \\(${r.column}\\) references ${CI_PARENT_TABLE[parent]}\\(id\\) on delete cascade`,
      ).test(flatSql)
      if (!hasCascade) missing.push(`${r.table}.${r.column} → ${CI_PARENT_TABLE[parent]}`)
    }
  }
  assert.deepEqual(missing, [], `owns로 선언했는데 CASCADE가 아니다: ${missing.join(', ')}`)
})

test('refs로 선언한 관계를 마이그레이션이 CASCADE로 바꾸지 않는다', () => {
  // 반대 방향의 사고 — 정리한다고 전부 CASCADE로 밀면 **게시 실적·학습 근거가 사라진다.**
  const wrong: string[] = []
  for (const parent of PARENTS) {
    for (const r of CI_RELATIONS[parent]) {
      if (r.kind !== 'refs') continue
      const pattern = new RegExp(
        `foreign key \\(${r.column}\\) references ${CI_PARENT_TABLE[parent]}\\(id\\) on delete cascade`,
      )
      if (pattern.test(flatSql)) wrong.push(`${r.table}.${r.column}`)
    }
  }
  assert.deepEqual(wrong, [], `refs로 선언했는데 CASCADE가 걸렸다: ${wrong.join(', ')}`)
})

test('폴리모픽 참조는 전부 DB 트리거가 지운다 — 코드만 믿지 않는다', () => {
  // 왜 DB여야 하나: 코드는 실제로 잊었다. 손으로 치운 작업 20건이 하루 만에 다시 20건
  // 생겼다(2026-08-18 실측). 코드는 잊을 수 있고 DB는 잊지 않는다.
  const uncovered: string[] = []
  for (const parent of PARENTS) {
    for (const r of polymorphicRefs(parent)) {
      const d = r.discriminator!
      // 트리거 함수 본문에 이 테이블·구분값·컬럼을 지우는 문장이 있어야 한다
      const pattern = new RegExp(
        `delete from ${r.table} where ${d.column} = '${d.value}' and ${r.column} = old\\.id`,
      )
      if (!pattern.test(flatSql)) uncovered.push(`${r.table}(${d.value}).${r.column}`)
    }
  }
  assert.deepEqual(uncovered, [], `트리거가 지우지 않는 폴리모픽 참조: ${uncovered.join(', ')}`)
})

test('owns를 가진 부모마다 삭제 트리거가 걸려 있다', () => {
  const need = PARENTS.filter((p) => polymorphicRefs(p).length > 0)
  const missing = need.filter((p) => {
    const table = CI_PARENT_TABLE[p]
    return !flatSql.includes(`before delete on ${table}`)
  })
  assert.deepEqual(missing, [], `폴리모픽 참조가 있는데 트리거가 없다: ${missing.join(', ')}`)
})

// ── 계약 ↔ 삭제 코드 대조 ────────────────────────────────────

test('삭제 코드가 종류를 손으로 나열하지 않는다 — 계약에서 뽑아야 한다', () => {
  // 예전 코드: `if (kind === 'content' || kind === 'idea' || kind === 'brief')`
  // 이 형태가 채널을 빠뜨린 원인이다. 종류를 손으로 적는 순간 새 종류는 반드시 누락된다.
  assert.ok(
    deleteTs.includes('polymorphicRefs('),
    'delete.ts가 polymorphicRefs()를 쓰지 않는다 — 종류를 손으로 나열하는 코드로 되돌아갔다',
  )
  assert.ok(
    !/kind === 'content' \|\| kind === 'idea' \|\| kind === 'brief'/.test(deleteTs),
    'delete.ts에 손으로 나열한 종류 분기가 되살아났다',
  )
})

test('확인창 문구를 계약에서 뽑는다 — 화면이 계약과 다른 말을 할 수 없게', () => {
  assert.ok(
    deleteTs.includes('countRelations('),
    'delete.ts가 countRelations()로 확인창 목록을 만들지 않는다',
  )
  // 옛 문구가 되살아나면 즉시 잡는다. 이 문장이 사용자를 오해시킨 바로 그 문장이다.
  assert.ok(
    !deleteTs.includes('남아 있고 채널 연결만 끊깁니다'),
    'delete.ts에 "게시물은 남습니다" 안내가 되살아났다 — 지금 채널→게시물은 CASCADE다',
  )
})

// ── 고아 계측 쿼리 ────────────────────────────────────────────

test('고아 계측 쿼리가 owns·work 관계를 빠짐없이 덮는다', () => {
  const expected = PARENTS.flatMap((p) =>
    CI_RELATIONS[p].filter((r: CiRelation) => r.kind !== 'refs').length)
    .reduce((a, b) => a + b, 0)
  assert.equal(orphanProbes().length, expected,
    '계측 쿼리 수가 owns+work 관계 수와 다르다 — 어떤 관계가 계측에서 빠졌다')
})

test('고아 계측 쿼리는 refs를 세지 않는다 — 연결이 끊긴 것은 정상이다', () => {
  const refTables = PARENTS.flatMap((p) => referencedBy(p).map((r) => `${r.table}.${r.column}`))
  const probeLabels = orphanProbes().map((p) => p.label)
  for (const t of refTables) {
    // owns로도 선언된 같은 테이블·컬럼이 있을 수 있으므로 정확히 대조한다
    const isAlsoOwned = PARENTS.some((p) =>
      ownedBy(p).some((r) => `${r.table}.${r.column}` === t))
    if (isAlsoOwned) continue
    assert.ok(!probeLabels.some((l) => l.startsWith(t)),
      `refs인 ${t}이 고아 계측에 들어 있다 — 정상 상태를 실패로 잡는다`)
  }
})

test('계측 쿼리가 문법적으로 온전하다 — 조각난 SQL이 조용히 통과하지 않게', () => {
  for (const probe of orphanProbes()) {
    assert.match(probe.sql, /^select count\(\*\)::int as n from \w+ x where .+not exists \(select 1 from \w+ p where p\.id = x\.\w+\)$/,
      `계측 쿼리 모양이 깨졌다: ${probe.label}`)
  }
})
