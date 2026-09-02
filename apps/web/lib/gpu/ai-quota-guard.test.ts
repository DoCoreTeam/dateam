// GPU 경로가 공용 AI 안전망 밖으로 다시 나가지 못하게 잠근다 (v0.7.678)
//
// 무엇이 있었나(실측 2026-09-02 15:02~15:04 KST):
//   `/pricing/gpu?tab=intake` 에 PDF 견적서를 넣었더니 1~2.4초 만에 실패했다.
//   서버 로그는 `gemini stream 429`. 화면은 「AI 분석 중 오류가 발생했습니다」.
//   원인은 PDF 가 아니라 **무료 티어 한도**였다 —
//   quotaId `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, quotaValue **20**.
//   그 20회는 같은 화면이 스스로 발사한 자동 수집(`GpuPricingClient.tsx` → market/refresh)이
//   URL 12개를 훑으며 먼저 썼고, 가격은 0건 갱신됐다.
//
//   같은 순간 `gemini-3.6-flash`·`3.7-flash`·`flash-lite-latest` 는 살아 있었다.
//   회의노트·CI 는 멀쩡했다 — 그쪽은 `lib/ai/gemini-call.ts`(재시도·모델 폴백·다른 공급자)를 쓰고,
//   GPU 만 자기 fetch 를 갖고 있었기 때문이다.
//
// 이 파일이 막는 것: 그 자기 fetch 가 되돌아오는 것, 그리고 실패 원인이 다시 뭉개지는 것.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '../..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const HELPERS = 'lib/gpu/extract-helpers.ts'
const STREAM = 'app/api/pricing/gpu/review/stream/route.ts'
const REFRESH = 'app/api/pricing/gpu/market/refresh/route.ts'
const PIPELINE = 'lib/gpu/extract-pipeline.ts'

describe('GPU 경로는 공용 AI 호출부를 쓴다', () => {
  it('★ 자기 fetch 로 generateContent 를 직접 부르지 않는다 — 그 자리에만 안전망이 없었다', () => {
    const src = read(HELPERS)
    const raw = src.split('\n')
      .map((line, i) => ({ line, no: i + 1 }))
      .filter(({ line }) => /fetch\s*\(/.test(line) && /generateContent|GEMINI_API_BASE\}\/models/.test(line))
    assert.deepEqual(
      raw.map((r) => `${HELPERS}:${r.no}`), [],
      'extract-helpers 가 Gemini 를 직접 부르면 재시도·모델 폴백·시간 제한이 다시 사라진다',
    )
  })

  it('★ 두 호출기가 공용부에 위임한다 — 시그니처는 그대로라 호출부는 안 고쳐도 된다', () => {
    const src = read(HELPERS)
    assert.match(src, /from '\.\.\/ai\/gemini-call\.ts'/, '공용부를 import 해야 한다')
    // 갈래마다 확인한다 — 한쪽만 위임하고 다른 쪽을 끊어 놓으면 그 경로만 조용히 안전망 밖이 된다.
    const need: Record<string, string[]> = {
      callGeminiOnce: ['callGeminiJson', 'callGeminiText'],   // jsonMode 참/거짓 두 갈래
      callGeminiStream: ['callGeminiJson'],
    }
    for (const [fn, must] of Object.entries(need)) {
      const body = src.split(`export async function ${fn}`)[1]?.split('\nexport ')[0] ?? ''
      assert.ok(body, `${fn} 이 있어야 한다`)
      for (const m of must) assert.ok(body.includes(m), `${fn} 의 ${m} 갈래가 공용부를 거쳐야 한다`)
    }
  })

  it('★ 두 번째 공급자 키를 읽어 넘긴다 — 사슬이 전부 막혔을 때 갈 곳이 있어야 한다', () => {
    const helpers = read(HELPERS)
    assert.match(helpers, /groq_api_key|stt_api_key/, 'getGeminiConfig 가 폴백 키를 읽어야 한다')
    assert.match(read(STREAM), /fallbackApiKey:\s*config\.fallbackApiKey/, '통합입력이 폴백 키를 넘겨야 한다')
    assert.match(read(REFRESH), /fallbackApiKey/, '자동 수집도 폴백 키를 넘겨야 한다')
  })

  it('★ 관측 추출도 같은 안전망을 탄다 — 여기만 빠지면 자동 수집이 또 죽는다', () => {
    assert.match(read(STREAM), /geminiCaller/, '통합입력이 안전망 태운 호출기를 주입해야 한다')
    assert.match(read(REFRESH), /geminiCaller:/, '자동 수집이 안전망 태운 호출기를 주입해야 한다')
  })
})

describe('실패 원인을 뭉개지 않는다', () => {
  it('★ 한도 초과를 「AI 분석 중 오류」로 덮지 않는다 — 사용자가 PDF 를 의심하게 된다', () => {
    const src = read(STREAM)
    assert.match(src, /GeminiCallError/, '원인을 아는 실패는 원인을 말해야 한다')

    // 파일 어딘가에 userMessage 가 있는 것만으로는 부족하다 — **오류를 내보내는 그 자리**가
    //   원인을 말해야 한다. 다른 곳(전사 실패 고지)에도 같은 표현이 있어서 느슨하면 통과해 버린다.
    const tail = src.slice(src.lastIndexOf('} catch (e) {'))
    assert.ok(tail.includes("send('error'"), '마지막 catch 가 오류 이벤트를 보내는 자리여야 한다')
    assert.match(
      tail, /instanceof GeminiCallError[\s\S]{0,200}?\.userMessage/,
      '오류를 내보내기 전에 원인을 아는 실패인지 먼저 봐야 한다',
    )
  })

  it('★ AI 를 못 부른 것을 「AI 가 거절함」으로 적지 않는다 — 8/27 에도 이렇게 묻혔다', () => {
    const src = read(PIPELINE)
    assert.match(src, /aiFailure/, '호출 실패를 별도 칸에 담아야 한다')
    assert.doesNotMatch(
      src, /reason:\s*'invalid_type',\s*detail:\s*`AI 구조화 관측 실패/,
      '어떤 예외든 invalid_type 으로 뭉개면 원인이 영영 안 보인다',
    )
    assert.match(read(REFRESH), /ai_error/, '자동 수집 요약에 호출 실패가 따로 남아야 한다')
  })

  it('★ 전사 실패를 조용히 넘기지 않는다 — 원본 0행이면 누락 검사가 꺼진 채 결과가 나온다', () => {
    const src = read(STREAM)
    assert.match(src, /transcribe_failed/, '전사를 건너뛰었으면 화면에 말해야 한다')
  })

  it('모델을 갈아탄 사실을 화면에 알린다 — 조용히 바꾸면 왜 결과가 다른지 아무도 모른다', () => {
    assert.match(read(STREAM), /ai_model_switched/, '대체 사실을 progress 로 보내야 한다')
  })
})

describe('시간 제한', () => {
  it('★ 호출 상한이 함수 상한(maxDuration)보다 짧다 — 플랫폼이 죽이면 아무 말도 못 한다', () => {
    const src = read(STREAM)
    const maxDuration = Number(src.match(/export const maxDuration = (\d+)/)?.[1])
    const budget = Number(src.match(/ROUTE_AI_BUDGET_MS = ([\d_]+)/)?.[1]?.replace(/_/g, ''))
    assert.ok(Number.isFinite(maxDuration), 'maxDuration 선언이 있어야 한다')
    assert.ok(Number.isFinite(budget), '요청 단위 AI 예산을 명시해야 한다')
    assert.ok(budget < maxDuration * 1000, `AI 예산(${budget}ms)이 함수 상한(${maxDuration * 1000}ms)보다 짧아야 한다`)

    // 호출마다 **남은** 예산을 준다 — 상수를 그대로 주면 단계가 3개일 때 합이 3배가 된다.
    //   v0.7.683 부터 배분은 lib/gpu/ai-budget(SSOT)이 한다(본 추출 몫 예약).
    assert.match(src, /overallTimeoutMs:\s*aiStageBudgetMs\(stage,\s*aiDeadline - Date\.now\(\)\)/,
      '앞 단계가 쓴 시간을 빼고 남은 예산을 단계 배분 SSOT 로 넘겨야 한다')
  })
})
