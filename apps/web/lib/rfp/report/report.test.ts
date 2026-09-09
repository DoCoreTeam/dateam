/**
 * 리포트 스키마·태스크·라우팅 가드 (설계서 3.6.1, 3.6.2)
 *
 * 여기서 잠그는 것 셋
 * - 최상위 11칸과 값 노드 공통 6속성이 스키마에 있는가
 * - 태스크가 자기 분류 섹션을 골라 넣는가
 * - 관련 섹션이 컨텍스트 60% 를 넘으면 나누는가
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  REPORT_TOP_KEYS, VALUE_NODE_KEYS, emptyValue, makeValue, emptyReport,
  validateValueNode, validateReport, valueNodeJsonSchema, MIN_QUOTE_CHARS,
  type ReportMeta,
} from './schema.ts'
import {
  EXTRACT_TASKS, TASK_IDS, taskById, COMMON_RULES, buildInstruction,
} from './tasks.ts'
import {
  routeSections, planFallback, renderBatch, estimateTokens, tasksForCategory,
  CONTEXT_BUDGET_RATIO,
} from './routing.ts'
import { makeBlock, makeDocument } from '../ir/build.ts'
import type { IrDocument, IrMeta, IrSection, SectionCategory } from '../ir/types.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_SRC = readFileSync(path.join(HERE, 'schema.ts'), 'utf8')

const IR_META: IrMeta = {
  fileRole: 'main', format: 'hwp', pageCount: 1,
  parser: 'rhwp', parserVersion: '0.8.6', qualityScore: 80, warnings: [],
}

const META: ReportMeta = {
  analysisMode: 'base', baseVendor: 'v1', crossVendors: [], fallbackApplied: false,
  costKrw: 0, durationMs: 0, parserQuality: 80, generatedAt: '2026-09-09T00:00:00Z',
  aiNotice: 'AI 생성 결과, 검토 필요', docClass: 'public',
}

/** 분류별 섹션과 본문으로 문서를 만든다 */
function 문서(rows: { category: SectionCategory; chars: number }[]): IrDocument {
  const blocks = rows.map((r, i) => makeBlock('f1', i, {
    type: 'paragraph', text: '가'.repeat(r.chars), sectionId: `s${i}`, pageNo: 1,
    sourceRef: { kind: 'hwp', sectionIdx: 0, paraIdx: i },
  }))
  const sections: IrSection[] = rows.map((r, i) => ({
    sectionId: `s${i}`, level: 1, title: `${r.category} 장`, number: `제${i + 1}장`,
    parentId: null, category: r.category, pageStart: 1, pageEnd: 1,
    blockIds: [blocks[i].blockId], orderNo: i,
  }))
  return makeDocument({ meta: IR_META, blocks, sections })
}

// 스키마

test('최상위 11칸이 값으로 남아 있다', () => {
  assert.equal(REPORT_TOP_KEYS.length, 11)
  assert.deepEqual([...REPORT_TOP_KEYS], [
    'overview', 'scope', 'schedule', 'budget', 'constraints',
    'checklist', 'evaluation', 'anomalies', 'fit', 'comparisons', 'meta',
  ])
})

test('11칸이 타입 선언에도 있다', () => {
  // 값 배열만 보면 타입을 지워도 통과한다
  const body = SCHEMA_SRC.match(/export interface Report \{([\s\S]*?)\n\}/)?.[1] ?? ''
  for (const k of REPORT_TOP_KEYS) {
    assert.match(body, new RegExp(`\\b${k}:`), `Report 에 ${k} 가 없다`)
  }
})

test('값 노드 공통 속성이 6종이다', () => {
  assert.equal(VALUE_NODE_KEYS.length, 6)
  assert.deepEqual([...VALUE_NODE_KEYS], ['value', 'evidence', 'confidence', 'grounding', 'vendor', 'verification'])
  assert.deepEqual(Object.keys(emptyValue()).sort(), [...VALUE_NODE_KEYS].sort())
})

test('빈 값 노드의 기본은 미확인이다', () => {
  // 기본을 확인으로 두면 전부 확인으로 보인다
  assert.equal(emptyValue().grounding, 'unconfirmed')
  assert.equal(emptyValue().verification, 'single')
  assert.deepEqual(emptyValue().evidence, [])
})

test('빈 리포트가 11칸을 다 갖는다', () => {
  const r = emptyReport(META)
  assert.deepEqual(validateReport(r), [])
  assert.deepEqual(Object.keys(r).sort(), [...REPORT_TOP_KEYS].sort())
})

test('칸이 빠진 리포트를 잡는다', () => {
  const { budget, ...빠짐 } = emptyReport(META)
  assert.deepEqual(validateReport(빠짐), ['리포트에 budget 가 없다'])
})

test('근거 없이 확인으로 표시하면 잡는다', () => {
  const node = makeValue(500_000_000, { grounding: 'confirmed' })
  // 모델이 「확인했다」고 말하는 것만으로 화면에 확인 배지가 뜨면 안 된다
  assert.ok(validateValueNode(node).includes('근거 없이 확인으로 표시했다'))
})

test('짧은 인용은 근거로 안 받는다', () => {
  const node = makeValue(1, {
    grounding: 'confirmed',
    evidence: [{ documentFileId: 'f', blockId: 'b', pageNo: 1, quote: '짧다' }],
  })
  assert.ok(validateValueNode(node).some((p) => p.includes(`${MIN_QUOTE_CHARS}자`)))
})

test('제대로 된 값 노드는 문제 0건이다', () => {
  const node = makeValue(500_000_000, {
    grounding: 'confirmed',
    confidence: 0.9,
    vendor: 'gemini-2.5-pro',
    evidence: [{ documentFileId: 'f', blockId: 'b', pageNo: 3, quote: '가'.repeat(MIN_QUOTE_CHARS) }],
  })
  assert.deepEqual(validateValueNode(node), [])
})

test('확신도가 0~1 을 벗어나면 잡는다', () => {
  assert.ok(validateValueNode(makeValue(1, { confidence: 1.5 })).some((p) => p.includes('0~1')))
  assert.deepEqual(validateValueNode(makeValue(1, { confidence: null })), [])
})

test('모델에 넘길 JSON Schema 가 6속성을 필수로 건다', () => {
  const s = valueNodeJsonSchema({ type: 'number' })
  assert.deepEqual(s.required, [...VALUE_NODE_KEYS])
  const props = s.properties as Record<string, Record<string, unknown>>
  const ev = props.evidence.items as Record<string, Record<string, unknown>>
  assert.equal((ev.properties as Record<string, Record<string, unknown>>).quote.minLength, MIN_QUOTE_CHARS)
})

// 태스크

test('추출 태스크가 9종이다', () => {
  assert.equal(EXTRACT_TASKS.length, 9)
  assert.deepEqual([...TASK_IDS], [
    'overview', 'scope', 'schedule', 'budget', 'constraints',
    'checklist', 'evaluation', 'anomalies', 'requirements',
  ])
  assert.equal(new Set(TASK_IDS).size, 9, '태스크 ID 가 겹친다')
})

test('태스크마다 관련 분류와 뽑을 필드가 있다', () => {
  for (const t of EXTRACT_TASKS) {
    assert.ok(t.categories.length > 0, `${t.id} 에 관련 분류가 없다`)
    assert.ok(t.fields.length > 0, `${t.id} 에 뽑을 필드가 없다`)
  }
})

test('예산 태스크가 설계서대로 예산·입찰안내·개요를 본다', () => {
  assert.deepEqual([...taskById('budget').categories], ['budget', 'bid_guide', 'overview'])
})

test('모르는 태스크는 조용히 넘어가지 않는다', () => {
  assert.throws(() => taskById('없는것' as never), /모르는 태스크/)
})

test('공통 규칙에 지어내기 금지와 인용 의무가 있다', () => {
  const joined = COMMON_RULES.join(' ')
  assert.match(joined, /원문에 없는 내용을 만들지 않는다/)
  assert.match(joined, /40자 이상/)
  // 명예훼손 위험 때문에 단정 문장을 만들지 않는다
  assert.match(joined, /경쟁 제한 의심/)
})

test('프롬프트 앞머리에 규칙이 전부 들어간다', () => {
  const p = buildInstruction(taskById('budget'))
  for (const r of COMMON_RULES) assert.ok(p.includes(r), `규칙이 빠졌다: ${r}`)
  assert.match(p, /totalAmount/)
})

test('한 분류가 여러 태스크에 쓰인다', () => {
  assert.ok(tasksForCategory(EXTRACT_TASKS, 'bid_guide').length >= 3)
  assert.deepEqual(tasksForCategory(EXTRACT_TASKS, 'evaluation'), ['constraints', 'evaluation', 'anomalies'].filter((id) =>
    EXTRACT_TASKS.find((t) => t.id === id)?.categories.includes('evaluation')))
})

// 라우팅

test('태스크가 자기 분류 섹션만 골라 넣는다', () => {
  const doc = 문서([
    { category: 'budget', chars: 100 },
    { category: 'evaluation', chars: 100 },
    { category: 'bid_guide', chars: 100 },
  ])
  const plan = routeSections(doc, taskById('budget'), 100_000)
  assert.equal(plan.split, false)
  // 예산 태스크에 평가 기준 장을 넣을 이유가 없다
  const cats = plan.batches[0].map((r) => r.section.category)
  assert.deepEqual(cats, ['budget', 'bid_guide'])
})

test('관련이 큰 분류가 앞에 온다', () => {
  const doc = 문서([
    { category: 'overview', chars: 50 },
    { category: 'bid_guide', chars: 50 },
    { category: 'budget', chars: 50 },
  ])
  const plan = routeSections(doc, taskById('budget'), 100_000)
  // 나눠야 할 때 관련이 적은 것이 뒤 묶음으로 밀려야 한다
  assert.deepEqual(plan.batches[0].map((r) => r.section.category), ['budget', 'bid_guide', 'overview'])
})

test('컨텍스트 60% 를 넘으면 나눈다', () => {
  const doc = 문서([
    { category: 'budget', chars: 600 },
    { category: 'bid_guide', chars: 600 },
    { category: 'overview', chars: 600 },
  ])
  // 세 섹션 합이 약 1620 토큰. 컨텍스트 2000 의 60% 인 1200 을 넘는다
  const plan = routeSections(doc, taskById('budget'), 2000)
  assert.equal(plan.budgetTokens, Math.floor(2000 * CONTEXT_BUDGET_RATIO))
  assert.equal(plan.split, true)
  assert.ok(plan.batches.length >= 2)
  for (const b of plan.batches) {
    const sum = b.reduce((n, r) => n + r.tokens, 0)
    assert.ok(sum <= plan.budgetTokens || b.length === 1, '한 묶음이 예산을 넘었다')
  }
})

test('60% 안이면 한 묶음이다', () => {
  const doc = 문서([{ category: 'budget', chars: 100 }])
  const plan = routeSections(doc, taskById('budget'), 100_000)
  assert.equal(plan.split, false)
  assert.equal(plan.batches.length, 1)
})

test('관련 섹션이 하나도 없으면 그렇게 말한다', () => {
  const plan = routeSections(문서([{ category: 'forms', chars: 100 }]), taskById('budget'), 10_000)
  assert.equal(plan.empty, true)
  assert.deepEqual(plan.batches, [])
})

test('빈 섹션은 넣지 않는다', () => {
  const doc = 문서([{ category: 'budget', chars: 0 }])
  // 제목만 있어도 넣는다 — 제목 자체가 근거가 된다
  const plan = routeSections(doc, taskById('budget'), 10_000)
  assert.equal(plan.empty, false)
})

test('묶음 본문에 섹션 ID 가 들어간다', () => {
  const doc = 문서([{ category: 'budget', chars: 50 }])
  const text = renderBatch(routeSections(doc, taskById('budget'), 10_000).batches[0])
  // 모델이 근거를 댈 때 이 값을 되돌려준다
  assert.match(text, /\[섹션 s0 제1장 budget 장\]/)
})

test('토큰 어림이 글자 수에 비례한다', () => {
  assert.ok(estimateTokens('가'.repeat(100)) > estimateTokens('가'.repeat(50)))
  assert.equal(estimateTokens(''), 0)
})

// 전체 문맥 보조 패스

test('못 찾은 필드가 있으면 한 번 더 묻는다', () => {
  const t = taskById('budget')
  const p = planFallback(t, new Set(['totalAmount']), false)
  assert.equal(p.needed, true)
  assert.ok(p.fields.includes('vatIncluded'))
})

test('보조 패스는 한 번뿐이다', () => {
  const t = taskById('budget')
  // 못 찾는 필드마다 전체 문서를 태우면 한 케이스에 수십만 원이 든다
  assert.equal(planFallback(t, new Set(), true).needed, false)
})

test('다 찾았으면 보조 패스를 안 돈다', () => {
  const t = taskById('budget')
  assert.equal(planFallback(t, new Set(t.fields), false).needed, false)
})
