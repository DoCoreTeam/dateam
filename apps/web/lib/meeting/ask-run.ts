import 'server-only'

/**
 * 이 회의에 묻기 — 서버 실행.
 *
 * 순서가 곧 권한이다.
 * 1 노트와 전사와 정리본은 **부른 사람의 권한(RLS)** 으로 읽는다 — 못 보면 여기서 끝(없음과 같은 대답)
 * 2 키는 판을 보는 resolveProviderKey 가 고르고, 서비스롤은 그 뒤 모델 이름을 읽을 때만 쓴다
 * 3 AI 답은 lib/meeting/ask 가 근거를 검증한 것만 돌려준다
 */

import { createAdminClient } from '@/lib/supabase/server'
import { callGeminiJson } from '@/lib/ai/gemini-call'
import { DEFAULT_GEMINI_MODEL } from '@/lib/ai/gemini-model'
import { messageFor, resolveProviderKey } from '@/lib/ai/provider-key-source'
import { htmlToPlain } from '@/lib/html-to-plain'
import { listTranscriptSegments } from '@/lib/meeting/transcript'
import { listMeetingDigests } from '@/lib/meeting/digest-run'
import { buildAskPrompt, parseAskAnswer, type AskAnswer } from '@/lib/meeting/ask'

export type AskFailure = 'not_found' | 'empty' | 'no_key'

export class AskError extends Error {
  readonly code: AskFailure
  constructor(code: AskFailure, message: string) {
    super(message)
    this.name = 'AskError'
    this.code = code
  }
}

const ASK_TIMEOUT_MS = 90_000
const ASK_OVERALL_TIMEOUT_MS = 150_000

export async function runMeetingAsk(input: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  noteId: string
  userId: string
  question: string
}): Promise<AskAnswer> {
  const { supabase, noteId, userId, question } = input

  const { data: note, error } = await supabase
    .from('meeting_notes')
    .select('id, body_plain, body_html')
    .eq('id', noteId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error || !note) throw new AskError('not_found', '회의노트를 찾을 수 없습니다.')

  const memo = (note.body_plain as string | null)?.trim() || htmlToPlain(note.body_html as string | null)
  const segments = await listTranscriptSegments(supabase, noteId)
  const digest = (await listMeetingDigests(supabase, noteId))[0]?.digest ?? null
  if (!memo.trim() && segments.length === 0) {
    throw new AskError('empty', '물어볼 기록이 아직 없어요. 메모를 쓰거나 녹음을 해 주세요.')
  }

  // 키는 판(운영 개발)을 보는 한 자리에서만 고른다 — 직접 읽으면 개발 판이 운영 키를 집는다
  const choice = await resolveProviderKey('gemini')
  if (!choice.apiKey) throw new AskError('no_key', messageFor(choice) ?? 'AI 키가 없어 물어볼 수 없어요.')
  // 모델 이름만 META 에서 — 서비스롤은 노트를 사람 권한으로 읽은 뒤에만 쓴다
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const { data: metaRow } = await admin.from('org_content').select('value').eq('key', 'META').single()
  const meta = (metaRow?.value as Record<string, unknown>) ?? {}
  const model = (typeof meta.gemini_model === 'string' ? meta.gemini_model : '') || DEFAULT_GEMINI_MODEL

  const { prompt, partial } = buildAskPrompt({
    question, memo,
    segments: segments.map((s) => ({ id: s.id, speaker: s.speaker, text: s.text })),
    digest,
  })
  const res = await callGeminiJson({
    prompt,
    apiKey: choice.apiKey,
    model,
    feature: 'meeting/ask',
    actorId: userId,
    capability: 'answer',
    temperature: 0.1,
    timeoutMs: ASK_TIMEOUT_MS,
    overallTimeoutMs: ASK_OVERALL_TIMEOUT_MS,
  })
  return parseAskAnswer(res.value, {
    knownIds: new Set(segments.map((s) => s.id)),
    memo,
    digest,
    partial,
  })
}
