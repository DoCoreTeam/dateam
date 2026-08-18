// lib/ci/media/policy.ts — "이 게시물의 영상을 읽을 것인가" 판단 (순수 함수)
//
// 영상 토큰은 텍스트보다 압도적으로 비싸다. 실측: 32초 숏츠 1건 = VIDEO 4,997토큰.
// 그러니 "전부 읽는다"도 "안 읽는다"도 답이 아니다. **읽어서 얻는 것이 있는 것부터** 읽는다.
//
// 판단의 축은 하나다: **이 게시물은 지금 증거가 굶고 있는가.**
//   숏폼  설명문이 없는 것이 정상이다(실측 423건 중 227건). 영상 말고는 증거가 없다 → 항상 읽는다
//   롱폼  설명문이 대개 충실하고 영상이 길어 토큰이 크다 → 증거가 부족하거나 성과가 특별할 때만
//   이미지·글  읽을 영상이 없다 → 대상이 아니다

import type { CiContentFormat } from '../types.ts'

/** 롱폼에서 "설명이 부실하다"고 보는 길이. 이보다 짧으면 영상을 봐야 안다. */
export const THIN_CAPTION_CHARS = 120

/**
 * 롱폼 영상 길이 상한(초). 1시간짜리를 읽으면 한 건에 수십만 토큰이 나간다.
 * 20분까지만 읽고, 그보다 길면 커버 이미지로 내려간다.
 */
export const LONG_FORM_MAX_SEC = 20 * 60

/** 성과가 특별하면 설명문이 충실해도 읽는다 — "왜 터졌나"는 영상 안에 있다. */
export const HOT_INDEX = 1.5

/**
 * 이미 시도한 기록. 없으면 null(한 번도 안 읽음).
 *
 * **행의 존재와 읽어냄은 다른 일이다.** 실패해도 행은 남기기 때문이다(왜 못 읽었는지를
 * 화면이 말해야 하므로). 그 둘을 같은 것으로 보면 쿼터 초과 한 번에 영구히 포기하게 된다
 * — 실측 2026-08-18: 57건 중 32건이 429로 실패한 뒤 재시도 대상에서 통째로 빠졌다.
 */
export interface AnalyzedRecord {
  /** 실제로 건진 것이 있는가 (대사·자막·주제 중 하나라도) */
  hasEvidence: boolean
  /** 지금까지 시도한 횟수 */
  attempts: number
}

export interface UnderstandDecisionInput {
  format: CiContentFormat
  captionLength: number
  durationSec: number | null
  /** 평소 대비 배수. 아직 안 났으면 null */
  outlierIndex: number | null
  /** 이미 시도한 기록. 한 번도 안 읽었으면 null */
  analyzed: AnalyzedRecord | null
}

/**
 * 실패한 영상을 다시 시도하는 횟수 상한.
 *
 * 상한이 없으면 비공개·삭제된 영상에 매 적재마다 돈을 태운다.
 * 3인 이유: 쿼터 초과는 보통 다음 회차에 풀리고, 세 번 연속 실패하면 일시적 문제가 아니다.
 */
export const MAX_ATTEMPTS = 3

export interface UnderstandDecision {
  should: boolean
  /** 왜 읽는지·왜 안 읽는지. 화면과 잡 이력이 그대로 쓴다 */
  reason: string
}

/**
 * 읽을지 정한다.
 *
 * 이 함수가 없으면 판단이 잡 핸들러·백로그·화면 세 곳에 흩어지고,
 * "왜 이건 분석됐고 저건 안 됐나"에 아무도 답할 수 없게 된다.
 */
export function shouldUnderstand(input: UnderstandDecisionInput): UnderstandDecision {
  // ① 읽을 영상이 있는 형식인가
  if (input.format === 'image' || input.format === 'text') {
    return { should: false, reason: '영상이 없는 형식입니다' }
  }

  // ② 이미 건졌으면 끝이다
  const prev = input.analyzed
  if (prev?.hasEvidence) return { should: false, reason: '이미 영상을 읽었습니다' }

  // ③ 읽을 **가치**가 있는가.
  //
  //    순서가 중요하다: 가치 판정이 재시도 판정보다 **먼저**다.
  //    거꾸로 두면 "지난번에 못 읽었으니 다시 시도" 가 길이 상한을 우회해
  //    41분짜리 영상에 매번 토큰을 쏟는다(실측으로 잡은 순서 버그).
  const worth = worthReading(input)
  if (!worth.should) return worth

  // ④ 가치는 있다. 남은 것은 시도 횟수뿐이다.
  if (prev) {
    if (prev.attempts >= MAX_ATTEMPTS) {
      return { should: false, reason: `${MAX_ATTEMPTS}번 시도했지만 영상을 읽지 못했습니다` }
    }
    return {
      should: true,
      reason: `지난번에 읽지 못해 다시 시도합니다 (${prev.attempts + 1}/${MAX_ATTEMPTS})`,
    }
  }
  return worth
}

/** 읽어서 얻는 것이 있는가. 시도 횟수는 보지 않는다 — 그건 상위에서 따로 본다. */
function worthReading(input: UnderstandDecisionInput): UnderstandDecision {
  // 숏폼 — 영상 말고는 증거가 없다. 길이 상한도 걸지 않는다(숏폼은 원래 짧다).
  if (input.format === 'short') {
    return { should: true, reason: '숏폼은 설명문이 없어 영상이 유일한 증거입니다' }
  }

  // 롱폼·라이브
  if (input.durationSec != null && input.durationSec > LONG_FORM_MAX_SEC) {
    return {
      should: false,
      reason: `${Math.round(LONG_FORM_MAX_SEC / 60)}분을 넘는 영상은 읽지 않습니다`,
    }
  }
  if (input.captionLength < THIN_CAPTION_CHARS) {
    return { should: true, reason: '설명문이 짧아 영상에서 내용을 확인합니다' }
  }
  if (input.outlierIndex != null && input.outlierIndex >= HOT_INDEX) {
    return { should: true, reason: `평소 대비 ${input.outlierIndex}배라 왜 통했는지 영상에서 확인합니다` }
  }

  return { should: false, reason: '설명문으로 충분히 파악됩니다' }
}

/**
 * 한 번에 읽을 상한.
 *
 * 15건 일괄 수집 뒤 한꺼번에 터지는 비용을 막는다(크리에이티브 분석과 같은 이유).
 * 밀린 것은 다음 적재 때 이어서 읽으므로 영원히 안 읽히지는 않는다.
 */
export const MEDIA_MAX_PER_PASS = 8

/**
 * 이 실패가 **그 영상의 문제인가, 우리 쪽 문제인가.**
 *
 * 이 구분이 없으면 쿼터가 마른 동안 돌아간 모든 게시물이 시도 횟수를 소진하고
 * 영구 포기 상태가 된다 — 영상에는 아무 문제가 없는데도.
 * (실측 2026-08-18: 429 한 번에 32건이 한꺼번에 실패했다. 그 32건은 전부 정상 영상이다)
 *
 * 우리 쪽 문제면 **시도로 세지 않고**, 그 회차를 통째로 멈춘다 —
 * 어차피 다음 건도 같은 이유로 실패하므로 계속 두드려봐야 실패만 쌓인다.
 */
export function isServiceFailure(error: string | null | undefined): boolean {
  if (!error) return false
  return /\(429\)|429|quota|rate limit|일시적|시간 안에 오지 않았습니다|호출하지 못했습니다|키가 설정되지 않았습니다|키가 없어|\(5\d\d\)/i.test(error)
}
