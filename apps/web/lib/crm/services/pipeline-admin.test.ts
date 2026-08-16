// 영업 단계 관리 (dacrm 통합기획서 Phase 1-6)
//
// **왜 이 가드가 있는가**: 파이프라인 API 에 `GET` 하나만 있어서
// 시드로 박힌 "KDC 제품"을 **제품 안에서 지울 방법이 없었다.** 개발자를 불러야 했다.
// 통상의 CRM(Pipedrive)은 이걸 설정 안에서 전부 한다 — 그게 2~3일 도입의 조건이다.
//
// 그리고 지우기는 **막는 것이 먼저다.** 딜이 걸린 파이프라인·단계를 지우면
// 그 딜이 보드 어디에도 안 뜬다 — 사람은 딜이 삭제된 줄 안다.
//
// 실측(브라우저): 만들기→이름변경→단계추가(성사 앞에 정확히)→순서변경(성사·실패는 자동으로 뒤로)
// →단계삭제(번호 빈틈없이 재정렬)→딜 걸린 것 삭제 거부→치운 뒤 삭제 성공.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_STAGES, MAX_PIPELINES, MAX_STAGES } from './pipeline-admin.ts'

const SRC = readFileSync(new URL('./pipeline-admin.ts', import.meta.url), 'utf8')
const UI = readFileSync(
  new URL('../../../app/(crm)/crm/process/ProcessClient.tsx', import.meta.url), 'utf8')

test('★ 기본 단계에 성사·실패가 반드시 있다 — 없으면 딜을 닫을 곳이 없어 영원히 열려 있다', () => {
  assert.ok(DEFAULT_STAGES.some((s) => s.kind === 'WON'), '성사 칸이 없다')
  assert.ok(DEFAULT_STAGES.some((s) => s.kind === 'LOST'), '실패 칸이 없다')
  assert.ok(DEFAULT_STAGES.some((s) => s.kind === 'OPEN'), '진행 칸이 없다')
})

test('성사·실패가 마지막 두 자리다 — 성사 오른쪽에 뭔가 있으면 "더 가야 하나"로 읽힌다', () => {
  const kinds = DEFAULT_STAGES.map((s) => s.kind)
  assert.equal(kinds[kinds.length - 2], 'WON')
  assert.equal(kinds[kinds.length - 1], 'LOST')
})

test('빈 파이프라인을 주지 않는다 — 처음부터 단계를 짜라는 건 도움이 아니라 숙제다', () => {
  assert.ok(DEFAULT_STAGES.length >= 4, `기본 단계가 너무 적다: ${DEFAULT_STAGES.length}`)
  assert.ok(SRC.includes('DEFAULT_STAGES'), '기본 단계를 안 쓴다')
})

test('★ 사용자가 단계를 지정해도 성사·실패는 붙인다 — 빼면 딜이 안 닫힌다', () => {
  assert.ok(SRC.includes("{ name: '성사', kind: 'WON' as const }"), '성사를 강제로 안 붙인다')
  assert.ok(SRC.includes("{ name: '실패', kind: 'LOST' as const }"), '실패를 강제로 안 붙인다')
})

test('★ 딜이 걸린 파이프라인은 못 지운다 — 지우면 그 딜이 보드에서 사라진 것처럼 보인다', () => {
  assert.ok(SRC.includes('다른 곳으로 옮기거나 닫은 뒤에 지울 수 있습니다'), '딜을 확인하지 않는다')
  assert.ok(/crmDeal\.count\(\{ where: \{ pipelineId: id \} \}\)/.test(SRC), '딜 수를 안 센다')
})

test('★ 딜이 걸린 단계도 못 지운다 (실측: "딜 1건이 이 단계에 있어요")', () => {
  assert.ok(SRC.includes('다른 단계로 옮긴 뒤에 지울 수 있습니다'), '단계의 딜을 확인하지 않는다')
})

test('★ 성사·실패 칸은 못 지운다 (실측: 400 거부)', () => {
  assert.ok(SRC.includes("if (s.kind !== 'OPEN')"), '종류를 안 본다')
  assert.ok(SRC.includes('딜을 닫을 곳이 없어집니다'), '이유를 안 말한다')
})

test('★ 마지막 파이프라인·마지막 진행 단계는 남긴다 — 없으면 딜을 만들 곳이 사라진다', () => {
  assert.ok(SRC.includes('마지막 영업 단계는 지울 수 없어요'), '마지막 파이프라인을 지울 수 있다')
  assert.ok(SRC.includes('진행 단계가 하나는 있어야 해요'), '마지막 진행 단계를 지울 수 있다')
})

test('기본 파이프라인을 지우면 다른 것이 기본이 된다 — 기본이 없으면 새 딜이 갈 곳을 잃는다', () => {
  assert.ok(SRC.includes('if (p.isDefault)'), '기본 여부를 안 본다')
  assert.ok(SRC.includes('data: { isDefault: true }'), '다른 것을 기본으로 안 올린다')
})

test('기본은 언제나 하나뿐이다 — 둘이면 새 딜이 어디로 갈지 코드마다 다르게 읽는다', () => {
  assert.ok(SRC.includes('updateMany({ where: { isDefault: true }, data: { isDefault: false } })'),
    '기존 기본을 안 내린다')
})

test('★ 순서를 바꿔도 성사·실패는 뒤로 간다 (실측: 앞으로 보내도 6·7번으로 복귀)', () => {
  assert.ok(SRC.includes("kindOf.get(id) === 'OPEN'"), '종류별로 안 나눈다')
  assert.ok(SRC.includes('const final = [...opens, ...wons, ...losts]'), '순서를 강제하지 않는다')
})

test('★ 화면이 보낸 목록에 빠진 단계가 있어도 잃지 않는다 — 옛 목록을 보낼 수 있다', () => {
  assert.ok(SRC.includes('const missing = stages.map((s) => s.id).filter'), '빠진 것을 안 챙긴다')
})

test('★ position 유니크를 피해 자리를 비운다 — 안 그러면 순서변경이 제약 위반으로 죽는다', () => {
  assert.ok(SRC.includes('async function shiftPositions'), '자리 비우기가 없다')
  assert.ok(SRC.includes('position: -(i + 1)'), '음수로 밀지 않는다')
})

test('삭제 뒤 번호를 다시 매긴다 — 빈 번호가 남으면 다음 추가에서 자리가 어긋난다', () => {
  assert.ok(/deleteStage[\s\S]*shiftPositions/.test(SRC), '삭제 후 재정렬이 없다')
})

test('상한이 있다 — 파이프라인이 넘치면 탭이, 단계가 넘치면 보드가 화면을 넘어간다', () => {
  assert.ok(MAX_PIPELINES > 0 && MAX_PIPELINES <= 20, `파이프라인 상한이 이상하다: ${MAX_PIPELINES}`)
  assert.ok(MAX_STAGES > 0 && MAX_STAGES <= 20, `단계 상한이 이상하다: ${MAX_STAGES}`)
  assert.ok(SRC.includes('count >= MAX_PIPELINES'), '파이프라인 상한을 안 본다')
  assert.ok(SRC.includes('stages.length >= MAX_STAGES'), '단계 상한을 안 본다')
})

test('★ 지우기 전에 무엇이 걸려 있는지 세어 준다 — 개수를 모르면 확인할 방법이 없다', () => {
  assert.ok(SRC.includes('export async function pipelineUsage'), '파이프라인 사용 현황이 없다')
  assert.ok(SRC.includes('export async function stageUsage'), '단계 사용 현황이 없다')
  assert.ok(UI.includes('/api/crm/pipelines/${p.id}`)'), '화면이 미리 세어 보지 않는다')
})

test('★ 바꾸는 것은 관리자만 — 화면에서만 숨기면 API 로 새어 나간다', () => {
  const list = readFileSync(
    new URL('../../../app/api/crm/pipelines/route.ts', import.meta.url), 'utf8')
  const one = readFileSync(
    new URL('../../../app/api/crm/pipelines/[id]/route.ts', import.meta.url), 'utf8')
  const st = readFileSync(
    new URL('../../../app/api/crm/stages/route.ts', import.meta.url), 'utf8')

  assert.ok(list.includes("withCrmApi('ADMIN'"), '아무나 파이프라인을 만들 수 있다')
  assert.equal((one.match(/withCrmApi\('ADMIN'/g) ?? []).length, 2, 'PATCH·DELETE 중 열린 것이 있다')
  assert.equal((st.match(/withCrmApi\('ADMIN'/g) ?? []).length, 2, '단계 추가·순서가 열려 있다')
})

test('★ 모든 변경이 기록에 남는다 — 단계가 바뀌면 그 뒤 모든 딜의 흐름이 바뀐다', () => {
  for (const a of [
    'pipeline.created', 'pipeline.renamed', 'pipeline.deleted', 'pipeline.default_changed',
    'stage.added', 'stage.renamed', 'stage.deleted', 'stage.reordered',
  ]) {
    assert.ok(SRC.includes(`action: '${a}'`), `${a} 를 기록하지 않는다`)
  }
})

test('★ 화면에 실제로 편집 수단이 있다 — API 만 있으면 아무도 못 쓴다', () => {
  assert.ok(UI.includes('addPipeline'), '만들기가 없다')
  assert.ok(UI.includes('renamePipeline'), '이름 바꾸기가 없다')
  assert.ok(UI.includes('removePipeline'), '지우기가 없다')
  assert.ok(UI.includes('addStage'), '단계 추가가 없다')
  assert.ok(UI.includes('moveStage'), '순서 바꾸기가 없다')
  assert.ok(UI.includes('makeDefault'), '기본 지정이 없다')
})

test('한글 조합 중 엔터로 만들어지지 않는다 — "파트너"를 치다가 만들어지면 안 된다', () => {
  assert.ok(UI.includes('isEnterKey(e)'), 'IME SSOT 를 쓰지 않는다')
})

test('★ 메뉴에서 찾을 수 있는 자리에 있다 — 매일 쓰는 것 사이에 끼어 있으면 못 찾는다', () => {
  const layout = readFileSync(new URL('../../../app/(crm)/layout.tsx', import.meta.url), 'utf8')
  // [설정] 그룹 안에 있어야 한다 — 처음 한 번 정하고 가끔 손보는 것이다
  // (예전엔 [기록] 그룹에 "프로세스"라는 이름으로 8번째에 있었다)
  const admin = layout.slice(layout.indexOf("label: '설정'"))
  assert.ok(admin.includes("href: '/crm/process'"), '설정 그룹에 없다')
  assert.ok(layout.includes("label: '영업 단계'"), '이름이 "프로세스"인 채다')
  // 그룹 이름과 항목 이름이 같으면 같은 말이 두 번 나온다
  assert.ok(!layout.includes("label: '기록', icon: <History"), '항목 이름이 그룹과 겹친다')
})
