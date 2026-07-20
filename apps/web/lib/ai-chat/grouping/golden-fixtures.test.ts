// 골든 픽스처 회귀 테스트 — 141개 파편화 사고(plan-doc)를 포함한 실제 문서 3종에서
// 구조 트리 복원 → 메타 분리 → 그룹 절단 → 유실 0 검증까지 전체 파이프라인을 검증한다.
// 설계: docs/2026-07-20-v0.7.353-list-analysis-semantic-grouping/02-task-breakdown.md Phase 1

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildStructureTree } from './structure-tree.ts'
import { extractDocMeta } from './doc-meta.ts'
import { cutGroups } from './assemble-groups.ts'
import { checkCoverage } from './coverage-check.ts'

const FIXTURES_DIR = join(process.cwd(), 'lib/ai-chat/grouping/__fixtures__')

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8')
}

function runPipeline(text: string, level: number) {
  const tree = buildStructureTree(text)
  const { meta, metaLineNumbers } = extractDocMeta(text, tree)
  const groups = cutGroups(tree, { level }, { metaLineNumbers })
  const coverage = checkCoverage(text, groups, metaLineNumbers)
  return { tree, meta, metaLineNumbers, groups, coverage }
}

test('골든: requirements-doc.md — 미귀속 0줄, 그룹 수 = 요구사항 수(3)', () => {
  const text = loadFixture('requirements-doc.md')
  const { groups, coverage } = runPipeline(text, 2)

  assert.equal(coverage.ok, true)
  assert.deepEqual(coverage.unassignedLines, [])
  assert.equal(groups.length, 3)
  assert.deepEqual(
    groups.map((g) => g.title),
    ['요구사항 1. 사용자 인증', '요구사항 2. 결제 연동', '요구사항 3. 알림'],
  )
})

test('골든: meeting-note.md — 미귀속 0줄, 그룹 수 = 안건 수(3)', () => {
  const text = loadFixture('meeting-note.md')
  const { groups, coverage } = runPipeline(text, 2)

  assert.equal(coverage.ok, true)
  assert.deepEqual(coverage.unassignedLines, [])
  assert.equal(groups.length, 3)
  assert.deepEqual(
    groups.map((g) => g.title),
    ['안건 1. 프로젝트 진행 상황', '안건 2. 리스크 검토', '안건 3. 다음 액션'],
  )
})

test('골든: plan-doc.md — 141개 사고 재현·해소. 미귀속 0줄, 그룹 수 = 실제 섹션 수(3), 141 절대 아님', () => {
  const text = loadFixture('plan-doc.md')
  const { meta, metaLineNumbers, groups, coverage } = runPipeline(text, 2)

  // 유실 0 — 결정론 검증
  assert.equal(coverage.ok, true)
  assert.deepEqual(coverage.unassignedLines, [])

  // 그룹 수 = 개요/목표/로드맵 3개뿐. 변경 이력은 메타로 분리되어 그룹이 아니다.
  assert.equal(groups.length, 3)
  assert.notEqual(groups.length, 141)
  const titles = groups.map((g) => g.title)
  assert.deepEqual(titles, ['1. 개요', '2. 목표', '3. 로드맵'])
  assert.ok(!titles.some((t) => t.includes('변경')))

  // 로드맵 그룹의 bodyRaw에는 P0/P1/P2가 전부 통째로 포함된다(하위 노드 통합)
  const roadmap = groups[2]
  assert.ok(roadmap.bodyRaw.includes('### P0'))
  assert.ok(roadmap.bodyRaw.includes('### P1'))
  assert.ok(roadmap.bodyRaw.includes('### P2'))

  // 문서 메타 4건이 그룹이 아니라 doc_meta로 분리 보관됨
  const metaKeys = meta.map((m) => m.key)
  assert.ok(metaKeys.includes('문서 버전'))
  assert.ok(metaKeys.includes('작성일'))
  assert.ok(metaKeys.includes('상태'))
  assert.ok(metaKeys.includes('프로젝트명'))

  // 본문 중간의 "- 상태: 진행 중"(로드맵 P1 하위)은 메타로 오분류되지 않고 그룹에 귀속된다
  const lines = text.split('\n')
  const statusLineNo = lines.findIndex((l) => l.includes('상태: 진행 중'))
  assert.ok(statusLineNo > 0)
  assert.equal(metaLineNumbers.has(statusLineNo), false)
  assert.ok(roadmap.bodyRaw.includes('상태: 진행 중'))
})
