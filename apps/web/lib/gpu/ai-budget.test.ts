import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  aiStageBudgetMs, AI_MAIN_RESERVE_MS, AI_PRE_STAGE_CAP_MS, AI_MIN_CALL_MS,
} from './ai-budget.ts'
import { scopeSchemaDigest, isGpuScopedTable } from './schema-scope.ts'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const STREAM = 'app/api/pricing/gpu/review/stream/route.ts'
const HELPERS = 'lib/gpu/extract-helpers.ts'
const CALL = 'lib/ai/gemini-call.ts'

describe('예산 배분 — 본 추출이 굶지 않는다', () => {
  it('★ 앞 단계는 본 추출 몫을 넘어 쓰지 못한다 — 이것이 4회 연속 실패의 구조였다', () => {
    // 50초가 통째로 남아 있어도 앞 단계는 단계 상한까지만 가져간다.
    assert.equal(aiStageBudgetMs('pre', 50_000), AI_PRE_STAGE_CAP_MS)
    // 앞 단계가 두 번 돌아 28초가 남아도, 예약분(25초)을 넘겨 쓰지 않는다.
    assert.equal(aiStageBudgetMs('pre', 28_000), 3_000)
  })

  it('★ 본 추출은 남은 것을 전부 받는다 — 마지막 주자라 아낄 이유가 없다', () => {
    assert.equal(aiStageBudgetMs('main', 26_400), 26_400)
    assert.equal(aiStageBudgetMs('main', 50_000), 50_000)
  })

  it('★ 앞 단계를 다 쓰고도 본 추출에 예약분이 남는다 — 실측 6.0초가 재발하지 않는다', () => {
    let left = 50_000
    for (const _ of [1, 2, 3]) left -= aiStageBudgetMs('pre', left) // 전사·분류·재분류
    assert.ok(left >= AI_MAIN_RESERVE_MS - 3_000, `본 추출 몫 ${left}ms — 예약분이 지켜지지 않았다`)
    assert.ok(left > 17_000, `실측 최댓값(17.0초)보다 커야 개선이다 — 지금 ${left}ms`)
  })

  it('어떤 단계도 0을 받지 않는다 — 0이면 부르자마자 죽어 이유조차 못 남긴다', () => {
    for (const left of [0, -50_000, 100, AI_MAIN_RESERVE_MS]) {
      assert.ok(aiStageBudgetMs('pre', left) >= AI_MIN_CALL_MS)
      assert.ok(aiStageBudgetMs('main', left) >= AI_MIN_CALL_MS)
    }
  })

  it('★ 라우트가 이 계산을 실제로 쓴다 — 만들고 안 부르면 없는 규칙이다', () => {
    const src = read(STREAM)
    assert.match(src, /overallTimeoutMs:\s*aiStageBudgetMs\(stage,\s*aiDeadline - Date\.now\(\)\)/,
      '남은 예산을 단계 배분 SSOT 로 넘겨야 한다')
    assert.ok(src.includes("gopts('pre')"), '앞 단계는 pre 로 표시해야 한다')
  })

  it('★ 앞 단계·본 단계가 실제로 갈려 있다 — 전부 main 이면 예약이 무의미하다', () => {
    const src = read(STREAM)
    const pre = src.match(/gopts\('pre'\)/g)?.length ?? 0
    const main = src.match(/gopts\(\)/g)?.length ?? 0
    assert.ok(pre >= 3, `앞 단계가 ${pre}곳뿐이다 — 전사·분류·관측이 빠졌다`)
    assert.ok(main >= 2, `본 단계가 ${main}곳뿐이다 — 추출·재추출이 빠졌다`)
  })

  it('★ 재분류 호출에도 안전망이 걸려 있다 — 여기만 시간 제한·폴백이 통째로 없었다', () => {
    const src = read(STREAM)
    const i = src.indexOf("step: 'reclassify'")
    assert.ok(i > 0, '재분류 단계가 있어야 한다')
    const block = src.slice(i, i + 900)
    assert.match(block, /gopts\(/, '재분류가 공용 옵션 없이 모델을 직접 부르면 안 된다')
  })
})

describe('스키마 범위 — 프롬프트에 남의 표를 싣지 않는다', () => {
  const DIGEST = [
    'TABLE gpu_products (id uuid, model_name text)',
    '  → FOREIGN KEY (id) REFERENCES x(id)',
    'TABLE ci_channels (id uuid, handle text)',
    '  · CHECK ((platform = ANY (ARRAY[\'youtube\'::text])))',
    'TABLE supply_quotes (id uuid, price numeric)',
    'TABLE _bak_ci_channels_20260811 (id uuid)',
    'TABLE gpu_products_dedup_backup_20260622 (id uuid)',
  ].join('\n')

  it('★ GPU 도메인만 남는다 — 실측 253개 중 쓰는 것은 23개였다', () => {
    const out = scopeSchemaDigest(DIGEST)
    assert.match(out, /TABLE gpu_products /)
    assert.match(out, /TABLE supply_quotes /)
    assert.doesNotMatch(out, /TABLE ci_channels /)
  })

  it('★ 딸린 제약이 남의 표에 붙지 않는다 — 줄 단위로 거르면 이 사고가 난다', () => {
    const out = scopeSchemaDigest(DIGEST)
    assert.match(out, /FOREIGN KEY \(id\) REFERENCES x\(id\)/, 'GPU 표의 FK 는 남아야 한다')
    assert.doesNotMatch(out, /youtube/, '남의 표의 CHECK 가 따라오면 안 된다')
  })

  it('★ 백업·스냅샷 표는 뺀다 — 이름이 비슷한 표 둘이면 AI 가 어디 넣을지 헷갈린다', () => {
    const out = scopeSchemaDigest(DIGEST)
    assert.doesNotMatch(out, /_bak_/)
    assert.doesNotMatch(out, /dedup_backup/)
    assert.equal(isGpuScopedTable('gpu_products_dedup_backup_20260622'), false)
    assert.equal(isGpuScopedTable('gpu_products'), true)
  })

  it('형식이 바뀌면 원본을 그대로 돌려준다 — 잘못 걸러 빈 스키마를 보내지 않는다', () => {
    assert.equal(scopeSchemaDigest('형식이 다른 무언가'), '형식이 다른 무언가')
    assert.equal(scopeSchemaDigest(''), '')
  })

  it('한 줄도 못 건지면 원본을 쓴다 — 허용목록이 현실과 어긋나도 기능이 죽지 않는다', () => {
    const only = 'TABLE ci_channels (id uuid)\nTABLE profiles (id uuid)'
    assert.equal(scopeSchemaDigest(only), only)
  })

  it('★ 다이제스트 로더가 실제로 좁혀서 넘긴다 — 만들고 안 쓰면 130KB 가 그대로 간다', () => {
    assert.match(read(HELPERS), /scopeSchemaDigest\(data\)/, 'loadSchemaDigest 가 좁힌 값을 써야 한다')
  })
})

describe('폴백 승급 — 시간 초과는 같은 모델을 또 부르지 않는다', () => {
  it('★ timeout 이면 재시도하지 않고 다음 모델로 간다 — 사슬이 있는데 한 번도 못 갔다', () => {
    const src = read(CALL)
    const i = src.indexOf("if (out.reason === 'timeout')")
    assert.ok(i > 0, 'timeout 전용 분기가 있어야 한다')
    // 그 분기가 백오프(sleep)보다 **앞**에 있어야 실제로 건너뛴다.
    assert.ok(i < src.indexOf('await sleep(1_000 * 2 ** attempt)'),
      'timeout 분기가 재시도 백오프 뒤에 있으면 아무 효과가 없다')
    assert.match(src.slice(i, i + 200), /break/, '다음 모델로 넘어가야 한다')
  })

  it('한도(429)의 같은 규칙이 유지된다 — 새 분기가 기존 동작을 덮지 않는다', () => {
    assert.match(read(CALL), /if \(out\.reason === 'quota'\)[\s\S]{0,160}break/)
  })

  it('네트워크·서버 오류는 여전히 재시도한다 — 과교정하면 일시 장애에 약해진다', () => {
    const src = read(CALL)
    assert.match(src, /if \(attempt < MAX_RETRIES_PER_MODEL\)[\s\S]{0,120}await sleep/,
      '재시도 경로 자체는 남아 있어야 한다')
  })
})
