import test from 'node:test'
import assert from 'node:assert/strict'
import { SEED_PIPELINES, SEED_WORKSPACE, SEED_OWNER, WORKSPACE_ID } from './seed-data.ts'

/**
 * 시드 데이터를 DB 에 넣기 전에 잡는다.
 * DB 에 넣고 나서 알면 운영 DB 에 잘못된 행이 이미 들어간 뒤다.
 */

test('★ 새 워크스페이스는 파이프라인 하나로 시작한다 — 안 쓰는 것이 화면을 차지하면 안 된다', () => {
  /**
   * 예전엔 TASKS T0-07 대로 4종(GPU 인프라·파트너십·공공·KDC 제품)을 넣었다.
   * 그런데 실사용에서 **3개가 딜 0건인 채** 딜 화면 탭 3칸과 리포트 3블록을 차지했고,
   * 사용자가 "KDC 제품이라니 전혀 연관없는 내용"이라고 지적했다.
   *
   * 4개를 주고 3개를 지우게 하는 것보다 1개로 시작해 필요한 만큼 늘리는 편이 낫다
   * ([관리 → 영업 단계]에서 직접 만들 수 있으므로 늘리는 비용이 거의 없다).
   */
  assert.equal(SEED_PIPELINES.length, 1, '기본 파이프라인이 하나가 아니다')
  // 특정 사업 이름이 아니라 중립적인 이름이어야 한다 — 남의 회사에도 맞아야 하는 기본값이다
  assert.equal(SEED_PIPELINES[0].name, '영업')
})

test('모든 파이프라인이 WON 1개와 LOST 1개를 갖는다', () => {
  // 없으면 보드에서 won/lost 드롭 대상이 없어 딜을 성사 처리할 수 없다(명세 6.3)
  for (const p of SEED_PIPELINES) {
    assert.equal(p.stages.filter((s) => s.kind === 'WON').length, 1, `${p.name} WON`)
    assert.equal(p.stages.filter((s) => s.kind === 'LOST').length, 1, `${p.name} LOST`)
  }
})

test('WON·LOST 는 마지막 두 자리에 온다 (보드 컬럼 순서)', () => {
  for (const p of SEED_PIPELINES) {
    const kinds = p.stages.map((s) => s.kind)
    assert.deepEqual(kinds.slice(-2), ['WON', 'LOST'], `${p.name} 의 끝 두 스테이지`)
    assert.equal(kinds.slice(0, -2).every((k) => k === 'OPEN'), true, `${p.name} 중간에 WON/LOST 가 섞였다`)
  }
})

test('스테이지 position 은 파이프라인 안에서 1부터 연속이다', () => {
  // crm_stage 에 @@unique([pipelineId, position]) 가 있다. 중복이면 시드가 실패한다
  for (const p of SEED_PIPELINES) {
    assert.deepEqual(
      p.stages.map((s) => s.position),
      p.stages.map((_, i) => i + 1),
      `${p.name} position`,
    )
  }
})

test('id 가 전부 고유하다 (겹치면 두 번째 실행에서 덮어쓴다)', () => {
  const ids = [
    ...SEED_PIPELINES.map((p) => p.id),
    ...SEED_PIPELINES.flatMap((p) => p.stages.map((s) => s.id)),
  ]
  assert.equal(new Set(ids).size, ids.length, '중복 id 가 있다')
})

test('기본 파이프라인은 정확히 1개다', () => {
  assert.equal(SEED_PIPELINES.filter((p) => p.isDefault).length, 1)
})

test('파이프라인 이름이 고유하다 (@@unique([workspaceId, name]))', () => {
  const names = SEED_PIPELINES.map((p) => p.name)
  assert.equal(new Set(names).size, names.length)
})

test('워크스페이스 기본값이 한국 기준이다', () => {
  assert.equal(SEED_WORKSPACE.id, WORKSPACE_ID)
  assert.equal(SEED_WORKSPACE.defaultCurrency, 'KRW')
  assert.equal(SEED_WORKSPACE.timezone, 'Asia/Seoul')
})

test('소유자 hostUserId 가 uuid 형식이다 (호스트 profiles.id)', () => {
  assert.match(SEED_OWNER.hostUserId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  assert.equal(SEED_OWNER.role, 'OWNER')
})

test('기본 파이프라인의 단계는 진행 5 + 성사 1 + 실패 1', () => {
  const total = SEED_PIPELINES.reduce((n, p) => n + p.stages.length, 0)
  assert.equal(total, 7)
  const open = SEED_PIPELINES[0].stages.filter((s) => s.kind === 'OPEN').length
  assert.equal(open, 5, '진행 단계 수가 바뀌었다')
})
