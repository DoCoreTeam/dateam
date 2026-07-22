import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runGrouping, runRegroup, regroupWithSpec, type JsonAiCaller } from './pipeline.ts'
import { docTypeFromCommand, buildClassifyPrompt } from './classify-doc.ts'
import { parseCutResult, fallbackCutSpec, serializeOutline } from './cut-groups.ts'
import { buildStructureTree } from './structure-tree.ts'

const FIXTURES = join(import.meta.dirname, '__fixtures__')
const planDoc = readFileSync(join(FIXTURES, 'plan-doc.md'), 'utf8')
const reqDoc = readFileSync(join(FIXTURES, 'requirements-doc.md'), 'utf8')

/** 고정 응답 AI — 프롬프트 내용과 무관하게 지정한 객체를 돌려준다. */
function fakeAi(...responses: (Record<string, unknown> | null)[]): JsonAiCaller {
  let i = 0
  return async () => responses[Math.min(i++, responses.length - 1)] ?? null
}

test('지시에 유형이 명시되면 AI 호출 없이 지시가 이긴다', async () => {
  let aiCalls = 0
  const ai: JsonAiCaller = async () => {
    aiCalls++
    return { mode: 'level', level: 2 }
  }
  const r = await runGrouping(reqDoc, '요구사항정의서니까 요구사항 단위로 묶어', ai)

  assert.equal(r.docType, 'requirements')
  assert.equal(r.docTypeSource, 'instruction')
  // 유형판정 AI콜은 생략되고 절단 1회만 호출된다
  assert.equal(aiCalls, 1)
})

test('지시가 없으면 AI 판정 결과를 쓴다', async () => {
  const r = await runGrouping(reqDoc, '', fakeAi({ docType: 'requirements', reason: 't' }, { mode: 'level', level: 2 }))
  assert.equal(r.docType, 'requirements')
  assert.equal(r.docTypeSource, 'ai')
})

test('★ 동일 문서 + 다른 지시 → 그룹 경계가 실제로 달라진다', async () => {
  // 지시 A: 레벨 절단 (유형 키워드 없는 지시 → 유형판정 AI콜이 소비됨)
  const coarse = await runGrouping(planDoc, '크게 묶어', fakeAi({ docType: 'plan' }, { mode: 'level', level: 2 }))

  // 지목 대상은 실제로 살아남은 콘텐츠 그룹에서 고른다 — front-matter 메타 노드를 고르면
  // isFullyMeta에 걸려 0개가 되므로(메타는 그룹이 될 수 없다) 테스트가 의미를 잃는다.
  const targetId = coarse.groups[0].id

  // 지시 B: 특정 노드만 지목 — 유형 키워드가 없어야 응답 순서가 A와 동일하다
  const picked = await runGrouping(
    planDoc,
    '이 부분만 봐줘',
    fakeAi({ docType: 'plan' }, { mode: 'nodes', nodeIds: [targetId] }),
  )

  assert.ok(coarse.groups.length > 0, '레벨 절단 결과가 비어 있으면 안 됨')
  assert.equal(picked.groups.length, 1, '노드 지목은 지목한 수만큼')
  assert.notEqual(
    coarse.groups.length,
    picked.groups.length,
    '지시가 달라졌는데 그룹 수가 같으면 지시가 지배하지 않는 것',
  )
})

test('★ 141개 사고 원문에서 파편이 나오지 않고 메타가 분리된다', async () => {
  const r = await runGrouping(planDoc, '', fakeAi({ docType: 'plan' }, { mode: 'level', level: 2 }))

  assert.ok(r.groups.length < 20, `그룹이 ${r.groups.length}개 — 파편화 회귀`)
  assert.equal(r.coverage.unassignedLines.length, 0, '미귀속 줄은 0이어야 한다')

  const metaKeys = r.meta.map((m) => m.key).join(',')
  assert.match(metaKeys, /버전/, '문서 버전이 메타로 분리되어야 한다')

  // 메타 문자열이 그룹 제목으로 새어나가면 안 된다
  const titles = r.groups.map((g) => g.title).join('\n')
  assert.doesNotMatch(titles, /^문서 버전/m)
  assert.doesNotMatch(titles, /^작성일/m)
})

test('그룹 bodyRaw는 원문 슬라이스 그대로다 (재작성 금지)', async () => {
  const r = await runGrouping(planDoc, '', fakeAi({ docType: 'plan' }, { mode: 'level', level: 2 }))
  for (const g of r.groups) {
    assert.equal(
      g.bodyRaw,
      planDoc.slice(g.sourceSpan.start, g.sourceSpan.end),
      `그룹 ${g.id}의 bodyRaw가 원문 슬라이스와 다르다`,
    )
  }
})

test('AI가 전부 실패해도 결정론 폴백으로 그룹핑이 완료된다', async () => {
  const r = await runGrouping(planDoc, '', fakeAi(null))
  assert.equal(r.docType, 'other', 'AI 실패 시 other로 폴백')
  assert.ok(r.cut.fallback, '절단도 폴백 표시')
  assert.ok(r.groups.length > 0, '폴백이어도 그룹은 나와야 한다')
  assert.equal(r.coverage.unassignedLines.length, 0, '폴백이어도 유실 0')
})

test('AI가 환각 nodeId를 주면 걸러내고 폴백한다', () => {
  const tree = buildStructureTree(planDoc)
  const d = parseCutResult({ mode: 'nodes', nodeIds: ['존재하지-않는-id', '9.9.9'] }, tree)
  assert.ok(d.fallback, '유효 id가 0개면 폴백해야 한다')
  assert.deepEqual(d.spec, fallbackCutSpec(tree))
})

test('재그룹핑은 원문을 바꾸지 않고 절단만 다시 한다', async () => {
  const first = await runGrouping(planDoc, '', fakeAi({ docType: 'plan' }, { mode: 'level', level: 2 }))
  const again = await runRegroup(planDoc, '더 잘게 쪼개', 'plan', fakeAi({ mode: 'level', level: 3 }))

  assert.equal(again.coverage.unassignedLines.length, 0, '재그룹핑 후에도 유실 0')
  for (const g of again.groups) {
    assert.equal(g.bodyRaw, planDoc.slice(g.sourceSpan.start, g.sourceSpan.end))
  }
  assert.ok(first.groups.length > 0 && again.groups.length > 0)
})

test('regroupWithSpec은 AI 없이 재조립한다', () => {
  const r = regroupWithSpec(planDoc, { level: 2 })
  assert.ok(r.groups.length > 0)
  assert.equal(r.coverage.unassignedLines.length, 0)
})

test('docTypeFromCommand — 지시 키워드 매핑', () => {
  assert.equal(docTypeFromCommand('요구사항 단위로'), 'requirements')
  assert.equal(docTypeFromCommand('회의록 형태로 정리해'), 'meeting-note')
  assert.equal(docTypeFromCommand('리스크 레지스터로'), 'risk-register')
  assert.equal(docTypeFromCommand('로드맵으로 바꿔'), 'roadmap')
  assert.equal(docTypeFromCommand('그냥 정리해줘'), null)
  assert.equal(docTypeFromCommand(''), null)
})

test('절단 프롬프트에 지시와 아웃라인이 실제로 포함된다', () => {
  const tree = buildStructureTree(planDoc)
  const outline = serializeOutline(tree)
  assert.ok(outline.length > 0, '아웃라인이 비어 있으면 AI가 판단할 근거가 없다')

  const prompt = buildClassifyPrompt(planDoc, '리스크 관점으로 봐줘')
  assert.match(prompt, /리스크 관점으로 봐줘/, '지시가 프롬프트에 주입되어야 한다')
})

/**
 * 회귀 테스트 — 실측 사고(2026-07-21): 문서가 "# 제목"으로 시작하면 front-matter 메타가
 * 첫 그룹 본문에 흡수됐다. 골든 픽스처 3종이 모두 제목 없는 문서라 못 잡았다.
 * 실제 문서 대부분은 제목으로 시작하므로 이 케이스가 오히려 기본값에 가깝다.
 */
const TITLED_DOC = `# 신규 채용 플랫폼 요구사항 정의서

- 문서 버전: v2.3.1
- 작성일: 2026-07-21
- 작성자: 김도현
- 상태: 검토중

## 요구사항 1. 지원자 계정 관리
- 소셜 로그인 지원
- 이메일 인증 필수

## 요구사항 2. 채용공고 관리
- 공고 등록/수정
- 상태: 초안/게시/마감 3단계

## 변경 이력
- v2.3.1 (2026-07-21): 심사 보강
`

test('★ 제목(H1)으로 시작하는 문서에서도 front-matter 메타가 그룹에 흡수되지 않는다', async () => {
  const r = await runGrouping(TITLED_DOC, '', fakeAi({ docType: 'requirements' }, { mode: 'level', level: 2 }))

  const metaKeys = r.meta.map((m) => m.key).join(',')
  assert.match(metaKeys, /문서 버전/, '문서 버전이 메타로 분리되어야 한다')
  assert.match(metaKeys, /작성일/, '작성일이 메타로 분리되어야 한다')
  assert.match(metaKeys, /작성자/, '작성자가 메타로 분리되어야 한다')

  const allBodies = r.groups.map((g) => g.bodyRaw).join('\n')
  assert.doesNotMatch(allBodies, /^- 문서 버전:/m, '메타가 그룹 본문에 흡수되면 안 된다')
  assert.doesNotMatch(allBodies, /^- 작성자:/m, '메타가 그룹 본문에 흡수되면 안 된다')

  // 본문 중간의 "- 상태: 초안/게시/마감 3단계"는 메타가 아니라 그룹 내용이어야 한다
  assert.match(allBodies, /상태: 초안\/게시\/마감/, '본문 내 유사 문자열은 메타로 오분류되면 안 된다')

  assert.equal(r.coverage.unassignedLines.length, 0, '유실 0 유지')
})

/**
 * 회귀 — 제타클론 사고: H1 없이 front-matter 메타로 시작하는 문서의 제목이
 * "- 문서 버전: v0.1.0"으로 잡혀 목록에서 식별 불가했다.
 * 프로젝트명 메타를 제목으로 승격해야 한다. titleFrom은 grouping-actions 내부이므로
 * 여기서는 파이프라인이 프로젝트명 메타를 실제로 추출하는지만 검증(제목 승격의 재료 확인).
 */
const ZETA_DOC = `- 문서 버전: v0.1.0
- 작성일: 2026-07-20
- 상태: 초안 (Draft)
- 프로젝트명: 미정 (가칭 "제타 클론")

## 1. 개요
이 문서는 신규 서비스의 기획 방향을 정리한다.

## 2. 목표
- 사용자 확보 10만 명
`

test('H1 없는 문서에서 프로젝트명 메타가 추출된다(제목 승격 재료)', async () => {
  const r = await runGrouping(ZETA_DOC, '', fakeAi({ docType: 'plan' }, { mode: 'level', level: 2 }))
  const projectMeta = r.meta.find((m) => /프로젝트\s*명/.test(m.key))
  assert.ok(projectMeta, '프로젝트명이 doc_meta로 분리되어야 한다')
  assert.match(projectMeta!.value, /제타 클론/, '프로젝트명 값에 실제 이름이 담겨야 한다')
  // "- 문서 버전" 줄이 그룹 제목으로 새지 않았는지
  const titles = r.groups.map((g) => g.title).join('\n')
  assert.doesNotMatch(titles, /문서 버전/)
})
