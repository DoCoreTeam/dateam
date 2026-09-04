/**
 * 옛 경로로 만든 정리를 정리본으로 **보여 준다** — 표에 쓰지 않고.
 *
 * **왜 필요한가** (실측 2026-09-05, 운영 DB 직접 조회):
 *   회의 38건 중 `meeting_notes.summary` 에 정리가 든 것이 **22건**인데
 *   `meeting_note_digest` 표에는 **6건**뿐이다. 차이 **16건**은 옛 경로
 *   (「AI 분석」 → `/api/ai/meeting-summarize` → `summary` 컬럼)로 만든 것이다.
 *
 *   그런데 화면의 정리 패널은 **표만 읽는다.** 그래서 그 16건은 정리를 이미 했는데
 *   **「아직 정리하지 않았어요」라고 말한다.** 목록의 「요약」 칸에는 같은 정리가 보인다 —
 *   사용자가 목록에서 요약을 읽고 들어가면 그 글이 사라진다.
 *
 * **왜 백필(표에 INSERT)이 아니라 읽기 폴백인가.**
 *   백필은 운영 데이터를 건드리는 일이라 승인이 필요하고, 승인을 기다리는 동안
 *   16건은 계속 거짓말을 한다. 읽기에서 메우면 **DB를 한 글자도 안 건드리고** 지금 닫힌다
 *   (M-12 "형태를 바꾼다"). 되돌리기는 이 파일을 안 부르면 끝이라 위험이 0이다.
 *
 *   그리고 이 폴백은 백필을 하더라도 **계속 옳다** — 앞으로 어떤 경로가 `summary` 만
 *   채우더라도 화면은 그걸 본다. 백필은 일회성이고 폴백은 계약이다.
 *
 * **순수 함수로 두는 이유**(완료 조건 E-6): 이 판정이 틀리면 화면은 멀쩡한데
 * 있는 정리가 안 보이거나 없는 정리가 보인다. 둘 다 실브라우저로만 잡히면 너무 늦다.
 */

import type { DigestResult, DigestSources } from './digest.ts'
import { parseSummaryOutline, parseDecisionLines } from './summary-structure.ts'

/** `listMeetingDigests` 가 돌려주는 것과 같은 모양이어야 화면이 구분 없이 그린다 */
export interface LegacyDigestVersion {
  seq: number
  createdAt: string
  model: string | null
  sources: DigestSources | null
  digest: DigestResult
}

/**
 * 옛 정리본의 순번.
 *
 * **0인 이유**: 실제 정리본은 1부터 쌓인다(`meeting_note_digest.seq`). 옛 것에 1을 주면
 * 나중에 진짜 1번이 생겼을 때 **같은 번호가 둘**이 되고, 사용자가 "1번 정리"라고 부를 때
 * 어느 쪽인지 알 수 없다. 0은 "표에 없는 것"을 뜻하는 자리로 비어 있다.
 */
export const LEGACY_DIGEST_SEQ = 0

/** 이 정리본이 옛 경로 산물인가 — 화면이 출처를 밝힐 수 있게 */
export function isLegacyDigest(v: { seq: number }): boolean {
  return v.seq === LEGACY_DIGEST_SEQ
}

/**
 * `summary`/`decisions` 평문을 정리본 한 판으로 옮긴다.
 *
 * 옛 경로는 안건 구조를 **자료로는** 안 만들었지만 평문 안에는 담아 뒀다
 * (`[안건]⏎- 사실`). 그 형식을 되읽어 구조로 돌려준다 — `runMeetingDigest` 의
 * 전사 없는 경로도 같은 파서를 쓰므로, 화면은 두 경우를 **구분 없이** 같은 부품으로 그린다.
 *
 * 지어내지 않는 것: `outcome`·`nextStep` 은 빈 문자열이다. 옛 요약의 첫 문장을
 * 결론인 척 넣으면 **없는 것을 있다고 말하는 것**이다(§0-2 근거 부족 문형).
 *
 * @returns 담을 내용이 없으면 `null` — 호출부는 「아직 정리하지 않았어요」를 그린다
 */
export function legacyDigestVersion(input: {
  summary: string | null | undefined
  decisions: string | null | undefined
  /** 이 정리가 언제 것인지. 옛 경로는 정리 시각을 안 남겨 노트 수정 시각이 가장 가깝다 */
  updatedAt: string | null | undefined
  /** 지금 재료의 크기 — 「내용이 바뀜」 판정에 쓴다. 옛 것은 당시 크기를 모른다 */
  memoChars?: number
}): LegacyDigestVersion | null {
  const summary = (input.summary ?? '').trim()
  const decisions = (input.decisions ?? '').trim()
  if (!summary && !decisions) return null

  return {
    seq: LEGACY_DIGEST_SEQ,
    createdAt: input.updatedAt ?? new Date(0).toISOString(),
    /**
     * 모델을 모른다 — 옛 경로는 안 남겼다. `null` 이 정직한 답이고,
     * 아무 모델 이름이나 적으면 나중에 "왜 이 결과가 이런가"를 물을 때 **틀린 답**을 준다.
     */
    model: null,
    /**
     * `sources` 도 모른다. 그런데 여기서 **지금** 재료 크기를 적어 넣으면 안 된다 —
     * 그러면 「내용이 바뀜」 판정이 영원히 "안 바뀜"이 되어(당시 값 = 지금 값)
     * 낡은 정리를 최신인 것처럼 보여 준다. 모르는 것은 `null` 로 둔다.
     */
    sources: null,
    digest: {
      outcome: '',
      nextStep: '',
      /*
        평문을 구조로 되돌린다 — 옛 경로도 `[안건]⏎- 사실` 형식으로 저장돼 있다(v0.7.689).
        판정은 `summary-structure.ts` 하나가 한다: 여기서 다시 짜면 두 벌이 되고,
        한쪽만 고쳐진 순간 같은 정리본이 저장 경로에 따라 다르게 보인다.
      */
      agenda: parseSummaryOutline(summary).map((a) => ({
        title: a.title,
        facts: a.facts.map((text) => ({ text, origin: 'memo' as const, segmentIds: [] })),
      })),
      decisions: parseDecisionLines(decisions).map((text) => ({
        text, origin: 'memo' as const, segmentIds: [],
      })),
      conflicts: [],
    },
  }
}

/**
 * 이 회의에 **읽을 정리가 있나** — 표를 뒤지지 않고 판정한다.
 *
 * `meeting_notes.summary` 는 정리본의 「지금 값」 사본이라(마이그 221), 정리가 있으면
 * 여기가 차 있다. 표를 한 번 더 조회하면 노트를 열 때마다 왕복이 하나 는다.
 *
 * **판정 규칙이 `legacyDigestVersion` 과 같아야 한다** — 다르면 「정리 있다」고 해 놓고
 * 패널은 「아직 정리하지 않았어요」를 그린다. 그래서 같은 함수로 판정한다.
 */
export function hasDigestContent(
  summary: string | null | undefined,
  decisions: string | null | undefined,
): boolean {
  return legacyDigestVersion({ summary, decisions, updatedAt: null }) !== null
}

/**
 * 표에서 읽은 정리본 목록에 옛 것을 **메운다.**
 *
 * 표에 하나라도 있으면 옛 것은 넣지 않는다 — 다시 정리한 순간 옛 것은 이미
 * 대체됐고(같은 `summary` 컬럼을 덮어썼다), 나란히 두면 **같은 글이 두 번** 보인다.
 */
export function withLegacyFallback(
  versions: LegacyDigestVersion[],
  legacy: () => LegacyDigestVersion | null,
): LegacyDigestVersion[] {
  if (versions.length > 0) return versions
  const one = legacy()
  return one ? [one] : []
}
