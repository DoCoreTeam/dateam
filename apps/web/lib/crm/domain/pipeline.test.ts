import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PIPELINE_LABEL_MAX,
  PIPELINE_LABEL_ERROR_TEXT,
  validatePipelineName,
  normalizePipelineName,
  sortPipelines,
  selectablePipelines,
  defaultPipelineId,
  stageSignature,
  duplicateStageGroups,
  duplicateStageNote,
  parseWinProbability,
  canSetWinProbability,
  WIN_PROBABILITY_ERROR_TEXT,
} from './pipeline.ts'

const ROOT = join(process.cwd())
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const P = (over: Partial<{ id: string; name: string; isDefault: boolean; isActive: boolean; position: number }> = {}) => ({
  id: over.id ?? 'p1', name: over.name ?? 'GPU 인프라',
  isDefault: over.isDefault ?? false, isActive: over.isActive ?? true,
  position: over.position ?? 1,
})

const S = (name: string, kind = 'OPEN', position = 1) => ({ name, kind, position })

/* ────────────────────── 이름 ────────────────────── */

test('이름이 비면 저장하지 않는다', () => {
  assert.equal(validatePipelineName('', []), 'EMPTY')
  assert.equal(validatePipelineName('   ', []), 'EMPTY')
  assert.equal(validatePipelineName(null, []), 'EMPTY')
})

test('이름이 상한을 넘으면 저장하지 않는다', () => {
  assert.equal(validatePipelineName('가'.repeat(PIPELINE_LABEL_MAX), []), null)
  assert.equal(validatePipelineName('가'.repeat(PIPELINE_LABEL_MAX + 1), []), 'TOO_LONG')
})

test('같은 이름은 공백·대소문자가 달라도 중복이다', () => {
  assert.equal(validatePipelineName('GPU 인프라', ['gpu  인프라']), 'DUPLICATE')
  assert.equal(validatePipelineName('  공공  ', ['공공']), 'DUPLICATE')
  assert.equal(validatePipelineName('공공', ['민간']), null)
})

test('연속 공백은 하나로 줄인다 — 「GPU  인프라」와 「GPU 인프라」가 둘이 되면 안 된다', () => {
  assert.equal(normalizePipelineName(' GPU   인프라 '), 'GPU 인프라')
})

test('오류 문장이 셋 다 있고 사과하지 않는다', () => {
  for (const k of ['EMPTY', 'TOO_LONG', 'DUPLICATE'] as const) {
    const msg = PIPELINE_LABEL_ERROR_TEXT[k]
    assert.ok(msg.length > 0)
    assert.ok(!msg.includes('죄송'), `사과하지 않는다: ${msg}`)
  }
})

/* ────────────────────── 순서·고르기 ────────────────────── */

test('★ 접은 것은 목록 아래로 내려가되 사라지지 않는다 — 사라지면 다시 켤 길이 없다', () => {
  const rows = [
    P({ id: 'off', name: 'MSP', isActive: false, position: 1 }),
    P({ id: 'on', name: '공공', isActive: true, position: 9 }),
  ]
  assert.deepEqual(sortPipelines(rows).map((r) => r.id), ['on', 'off'])
  assert.equal(sortPipelines(rows).length, 2)
})

test('기본 파이프라인은 켜진 것들 중 맨 앞이다 — 새 딜이 어디서 시작하는지 먼저 보인다', () => {
  const rows = [
    P({ id: 'a', name: '공공', position: 1 }),
    P({ id: 'b', name: 'GPU 인프라', isDefault: true, position: 9 }),
  ]
  assert.deepEqual(sortPipelines(rows).map((r) => r.id), ['b', 'a'])
})

test('★ 딜 폼은 켜진 것 + 이 딜이 이미 쓰는 것을 보여 준다 — 뒤엣것을 빼면 값이 조용히 날아간다', () => {
  const rows = [
    P({ id: 'on', name: '공공' }),
    P({ id: 'off', name: 'MSP', isActive: false }),
  ]
  assert.deepEqual(selectablePipelines(rows, null).map((r) => r.id), ['on'])
  assert.deepEqual(selectablePipelines(rows, 'off').map((r) => r.id), ['on', 'off'])
})

test('★ 접힌 것을 기본값으로 주지 않는다 — 고를 수 없는 값이 미리 들어가면 저장에서야 안다', () => {
  const rows = [
    P({ id: 'off', name: 'MSP', isActive: false, isDefault: false, position: 1 }),
    P({ id: 'on', name: '공공', isActive: true, position: 2 }),
  ]
  assert.equal(defaultPipelineId(rows, null), 'on')
})

test('지금 보고 있는 것은 접혀 있어도 유지한다 — 접는 순간 화면이 튀면 안 된다', () => {
  const rows = [P({ id: 'off', isActive: false }), P({ id: 'on', name: '공공' })]
  assert.equal(defaultPipelineId(rows, 'off'), 'off')
})

test('하나도 없으면 null — 없는 id 를 지어내지 않는다', () => {
  assert.equal(defaultPipelineId([], null), null)
})

/* ────────────────────── 단계 구성이 같은 것 찾기 ────────────────────── */

test('★ 실측 앵커: MSP·SI·솔루션·컨설팅은 단계 구성이 글자까지 같다 (운영 DB 2026-09-09)', () => {
  const base = [S('리드', 'OPEN', 1), S('상담', 'OPEN', 2), S('제안', 'OPEN', 3),
    S('협상', 'OPEN', 4), S('성사', 'WON', 5), S('실패', 'LOST', 6)]
  const rows = [
    { ...P({ id: 'msp', name: 'MSP' }), stages: base },
    { ...P({ id: 'si', name: 'SI' }), stages: base },
    { ...P({ id: 'sol', name: '솔루션' }), stages: base },
    { ...P({ id: 'con', name: '컨설팅' }), stages: base },
    {
      ...P({ id: 'gpu', name: 'GPU 인프라' }),
      stages: [S('리드', 'OPEN', 1), S('요구사항 파악', 'OPEN', 2), S('견적·제안', 'OPEN', 3),
        S('기술검증(PoC)', 'OPEN', 4), S('계약 협상', 'OPEN', 5), S('수주', 'WON', 6), S('실주', 'LOST', 7)],
    },
  ]
  const dupes = duplicateStageGroups(rows)
  assert.deepEqual(dupes.get('msp')!.slice().sort(), ['SI', '솔루션', '컨설팅'].sort())
  assert.equal(dupes.has('gpu'), false, 'GPU 인프라는 혼자다 — 복제본이 아니다')
})

test('단계 순서가 다르면 다른 구성이다 — 순서가 곧 파이프라인을 나누는 이유다', () => {
  const rows = [
    { ...P({ id: 'a' }), stages: [S('리드', 'OPEN', 1), S('제안', 'OPEN', 2)] },
    { ...P({ id: 'b' }), stages: [S('제안', 'OPEN', 1), S('리드', 'OPEN', 2)] },
  ]
  assert.equal(duplicateStageGroups(rows).size, 0)
})

test('단계 이름의 앞뒤 공백·대소문자는 같은 것으로 본다', () => {
  assert.equal(stageSignature([S('리드 ', 'OPEN', 1)]), stageSignature([S('리드', 'OPEN', 1)]))
})

test('단계가 없는 파이프라인끼리 「같다」고 말하지 않는다 — 빈 것끼리는 뜻이 없다', () => {
  const rows = [{ ...P({ id: 'a' }), stages: [] }, { ...P({ id: 'b' }), stages: [] }]
  assert.equal(duplicateStageGroups(rows).size, 0)
})

test('배지 문구는 상대 이름을 그대로 말한다 · 없으면 배지를 만들지 않는다', () => {
  assert.equal(duplicateStageNote(['SI', '솔루션']), 'SI · 솔루션 와 단계 구성이 같아요')
  assert.equal(duplicateStageNote([]), null)
})

/* ────────────────────── 성사 확률 ────────────────────── */

test('★ 비울 수 있다 — 억지로 채우게 하면 사람이 없는 숫자를 지어낸다', () => {
  assert.equal(parseWinProbability(null), null)
  assert.equal(parseWinProbability(''), null)
  assert.equal(parseWinProbability('   '), null)
})

test('못 읽은 값(undefined)과 비운 값(null)을 구분한다 — 섞으면 안 건드린 칸이 지워진다', () => {
  assert.equal(parseWinProbability(undefined), undefined)
  assert.equal(parseWinProbability(null), null)
})

test('0~100 밖은 거절한다 — 잘못된 값이 예상 매출을 부풀리면 안 된다', () => {
  assert.equal(parseWinProbability(0), 0)
  assert.equal(parseWinProbability(100), 100)
  assert.equal(parseWinProbability(-1), undefined)
  assert.equal(parseWinProbability(101), undefined)
  assert.equal(parseWinProbability('쓰레기'), undefined)
})

test('문자열 숫자와 소수도 받는다 — 화면 입력은 언제나 문자열이다', () => {
  assert.equal(parseWinProbability('45'), 45)
  assert.equal(parseWinProbability('45.4'), 45)
  assert.equal(parseWinProbability(63.5), 64)
})

test('★ 성사·실패 칸에는 확률을 정하지 않는다 — 리포트도 그 둘은 건너뛴다', () => {
  assert.equal(canSetWinProbability('OPEN'), true)
  assert.equal(canSetWinProbability('WON'), false)
  assert.equal(canSetWinProbability('LOST'), false)
})

test('오류 문장이 무엇을 넣어야 하는지 말한다', () => {
  assert.ok(WIN_PROBABILITY_ERROR_TEXT.includes('0'))
  assert.ok(WIN_PROBABILITY_ERROR_TEXT.includes('100'))
})

/* ────────────────────── 배선 가드 ────────────────────── */

test('★ 설정에 파이프라인 카드가 실제로 꽂혀 있다 — 만들고 안 붙이면 없는 기능이다', () => {
  const page = read('app/(crm)/crm/settings/page.tsx')
  assert.ok(page.includes('<PipelineCard'), '설정 화면이 PipelineCard 를 그린다')
  assert.ok(
    page.indexOf('<PipelineCard') < page.indexOf('<BusinessTypeCard'),
    '딜을 만들 때 고르는 순서대로 — 파이프라인이 사업 유형보다 앞이다',
  )
})

test('★ 못 누를 버튼을 그리지 않는다 — 두 카드가 같은 방식으로 권한을 본다(§2-5)', () => {
  const page = read('app/(crm)/crm/settings/page.tsx')
  assert.ok(page.includes('hasCrmRole'), '서버에서 판정한다 — 화면이 스스로 정하지 않는다')
  // 한 카드만 받으면 두 카드가 서로 다른 규칙으로 그려진다 — 그게 §2-5 가 막는 상태다
  for (const card of ['PipelineCard', 'BusinessTypeCard']) {
    assert.ok(
      page.includes(`<${card} canEdit={canEdit} />`),
      `${card} 가 서버 판정을 그대로 받는다 — 화면이 true 로 굳히지 않는다`,
    )
    const src = read(`app/(crm)/crm/settings/${card}.tsx`)
    assert.ok(src.includes('canEdit'), `${card}.tsx 가 canEdit 를 받는다`)
  }
})

test('★ 영업 단계 화면이 파이프라인 편집을 다시 만들지 않는다 — 탭 두 줄이 그렇게 생겼다', () => {
  const src = read('app/(crm)/crm/process/ProcessClient.tsx')
  for (const gone of ['addPipeline', 'renamePipeline', 'removePipeline', 'makeDefault']) {
    assert.ok(!src.includes(`function ${gone}`), `${gone} 이 되살아나지 않았다`)
  }
  assert.ok(!src.includes('SegmentedTabs'), '파이프라인을 탭으로 세우지 않는다 — 층이 다르다')
  assert.ok(src.includes('ControlRow'), '딜 보드와 같은 도구 줄을 쓴다(§2-5)')
})

/**
 * 주석을 걷어낸다.
 *
 * 이 파일들의 주석에는 「예전엔 「+ 새 영업 단계」라고 불렀다」처럼 **틀렸던 말을 인용한
 * 설명**이 들어 있다. 그건 위반이 아니라 위반의 기록이고, 지우면 다음 사람이 왜 이렇게
 * 됐는지 알 길이 없어진다. 가드가 봐야 할 것은 **사용자가 화면에서 읽는 글자**다.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
}

test('★ 파이프라인을 「영업 단계」라 부르지 않는다 — 이 자리가 15곳 오용의 진원이다', () => {
  const targets = [
    'app/(crm)/crm/process/ProcessClient.tsx',
    'app/(crm)/crm/process/page.tsx',
    'lib/crm/services/pipeline-admin.ts',
    'app/(crm)/crm/reports/ReportsClient.tsx',
  ]
  const banned = ['새 영업 단계', '영업 단계 만들기', '영업 단계를 찾지 못했습니다', '안 쓰는 영업 단계']
  for (const f of targets) {
    const src = stripComments(read(f))
    for (const b of banned) {
      assert.ok(!src.includes(b), `${f}: 「${b}」 — 파이프라인을 「영업 단계」라 부르고 있다`)
    }
  }
})

test('★ 성사 확률을 정할 자리가 화면에 있다 — 리포트는 「관리자가 정한 값」이라 부르는데 정할 곳이 0곳이었다', () => {
  const src = read('app/(crm)/crm/process/ProcessClient.tsx')
  assert.ok(src.includes('winProbabilityPct'), '화면이 그 값을 다룬다')
  // 임포트만 남고 호출이 사라지면 성사·실패 칸에도 입력칸이 뜬다 — 이름 등장으로는 못 잡는다
  assert.match(src, /canSetWinProbability\(\s*s\.kind\s*\)/,
    '단계마다 SSOT 로 판정한다 — 화면이 스스로 kind 를 비교하지 않는다')
  const api = read('app/api/crm/stages/[id]/route.ts')
  assert.ok(api.includes('setStageWinProbability'), '저장 경로가 실재한다')
  assert.ok(api.includes('parseWinProbability'), '화면과 서버가 같은 함수로 판정한다')
})

test('★ 접기가 딜 만들기까지 닿는다 — 접어 놓고 아무 일도 안 일어나면 없는 기능이다', () => {
  const form = read('app/(crm)/crm/deals/DealFormModal.tsx')
  assert.match(form, /selectablePipelines\(\s*pipelines/,
    '새 딜에서 접힌 파이프라인이 안 보인다 — 임포트만 있고 안 부르면 접기가 아무 일도 안 한다')
  const board = read('app/(crm)/crm/deals/DealBoard.tsx')
  assert.ok(board.includes('isActive'), '보드가 접힘을 안다')
  assert.ok(!board.includes('.filter((p) => p.isActive)'),
    '보드·표에서는 거르지 않는다 — 접힌 흐름에 이미 붙은 딜은 그대로 봬야 한다')
})

test('★ 마이그 245 가 추가 전용이다 — 기존 7개가 지금 상태 그대로여야 한다', () => {
  const sql = readFileSync(join(ROOT, '..', '..', 'supabase/migrations/245_crm_pipeline_active.sql'), 'utf8')
  assert.ok(/ADD COLUMN IF NOT EXISTS "isActive"/.test(sql), '칸을 더하기만 한다')
  assert.ok(/DEFAULT TRUE/i.test(sql), '기본값이 켜짐 — 기존 행이 안 바뀐다')
  assert.ok(!/DROP\s+(TABLE|COLUMN)(?!\s+"isActive")/i.test(sql.replace(/--[^\n]*/g, '')),
    '지우는 문장이 없다(되돌리기 주석 제외)')
})
