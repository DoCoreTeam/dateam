// POST /api/crm/quotes/text-fill — 견적 옆 편집기의 글을 표로
//
// **저장하지 않는다.** 화면이 결과(ops, fixes)를 초안에 얹고 사람이 저장한다.
// 규칙이 먼저 읽고 못 읽은 조각만 AI 에게 간다. AI 가 안 돼도 규칙 결과는 돌아간다.
import type { NextRequest } from 'next/server'
import { withCrmApi, readJson } from '@/lib/crm/api/handler'
import { fillQuoteFromText, parseTextFillInput, reviewQuoteText } from '@/lib/crm/services/quote-text-fill'
import { jsonSafe } from '@/lib/crm/services/json-safe'
import { loadGpuPriceLookup } from '@/lib/crm/services/gpu-price-ref-load'

export const maxDuration = 120

export async function POST(req: NextRequest) {
  return withCrmApi('MEMBER', async ({ session }) => {
    const input = parseTextFillInput(await readJson(req))
    // 「AI로 한 번 더 보기」 — 사람이 누를 때만 온다. 자동 정리는 이 길을 안 탄다
    if (input.mode === 'review') return jsonSafe(await reviewQuoteText(session.workspaceId, session.memberId, input))
    // GPU 이용 줄의 정상가는 GPU 가격표의 판매가 — 서비스롤 읽기는 이 사람 확인(MEMBER) 뒤에만
    return jsonSafe(await fillQuoteFromText(session.workspaceId, session.memberId, input, { gpuPrice: () => loadGpuPriceLookup() }))
  })
}
