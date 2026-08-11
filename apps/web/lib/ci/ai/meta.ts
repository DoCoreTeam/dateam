// lib/ci/ai/meta.ts — 외부 API 키 조회 (기존 org_content META 재사용)
// 설계: 00-integration-decisions.md §2-1
// CI가 별도 키 저장소를 만들지 않는다. 키 이중 관리는 회전 누락의 원인이다.

import { createAdminClient } from '@/lib/supabase/server'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CiExternalKeys {
  geminiApiKey: string
  geminiModel: string
  youtubeApiKey: string | undefined
}

/**
 * org_content(key='META')에서 키를 읽는다.
 * 실패하거나 키가 없으면 빈 값을 돌려준다 — 커넥터가 폴백 경로로 내려간다.
 */
export async function getGeminiMeta(): Promise<CiExternalKeys> {
  try {
    const adminClient = createAdminClient() as any
    const { data } = await adminClient
      .from('org_content').select('value').eq('key', 'META').single()

    const meta = (data?.value ?? {}) as Record<string, unknown>
    return {
      geminiApiKey: typeof meta.gemini_api_key === 'string' ? meta.gemini_api_key : '',
      geminiModel: typeof meta.gemini_model === 'string' ? meta.gemini_model : 'gemini-2.0-flash',
      youtubeApiKey: typeof meta.youtube_api_key === 'string' && meta.youtube_api_key
        ? meta.youtube_api_key
        : undefined,
    }
  } catch {
    return { geminiApiKey: '', geminiModel: 'gemini-2.0-flash', youtubeApiKey: undefined }
  }
}
