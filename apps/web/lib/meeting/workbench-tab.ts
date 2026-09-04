/**
 * 회의 작업대의 **층위** — SSOT
 *
 * ## 왜 이 파일이 다시 쓰였나 (2026-09-05, 사용자 지적)
 *
 * *"결국 우리가 봐야되는건 정리된 내용일텐데 … 정리가 가장 먼저 보여야 하는거 아냐?
 *  그리고 그러다 보니깐 이런식으로 동일 레벨의 탭으로 있는게 이상한데"*
 *
 * 뒤쪽 지적이 더 정확했다. **셋은 형제가 아니다.**
 *   작성 = 사람이 쓴 원문 · 녹음·전사 = 기계가 받아적은 원문 → **형제**
 *   정리 = 그 둘을 읽어서 만든 것                          → **자식**
 *
 * 탭은 「둘 중 하나를 고른다」가 성립할 때 쓰는 장치다. 자식을 형제 자리에 세우면
 * 세 가지가 동시에 깨진다 — 그리고 실제로 셋 다 깨져 있었다:
 *
 *   ① **기본 탭을 못 정한다.** 정리를 기본으로 열면 원문이 사라지고, 원문을 기본으로 열면
 *      결론이 숨는다. 그래서 이 파일의 예전 판은 **정리를 후보에서 빼는 것**으로 끝냈다
 *      (「정리는 기본값이 되지 않는다」). 그 코드가 이 진단의 증거였다.
 *   ② **결과물의 상태를 표시할 자리가 없다.** 탭 라벨은 분량을 적는 자리인데(218자·406줄)
 *      정리에 필요한 것은 분량이 아니라 **있음·없음·낡음**이다. 그래서 「방금」이라는
 *      임시 표시밖에 못 붙였고, 정리본이 있어도 탭만 봐선 알 수 없었다.
 *   ③ **만드는 버튼이 탭 안에 갇힌다.** 세 번째 탭을 눌러야 실행할 수 있으니 탭 밖에
 *      버튼을 또 만들었고(「AI 분석」), 두 버튼이 **서로 다른 곳에 쓰기 시작했다.**
 *      실측 16건이 그 결과다 — 정리가 저장됐는데 화면 어디에도 안 나왔다.
 *
 * ## 그래서 무엇이 바뀌나
 *
 * 정리는 **탭이 아니라 카드 본문**이 된다(항상 펼침). 작성·전사는 **「근거」 접기** 안에서
 * 둘 중 하나를 고른다. 새 내비게이션 장치를 만들지 않는다 — 탭은 그대로 남고 **둘로 줄 뿐**이며,
 * 진짜 형제끼리만 남는다(정책 §2-3-6 P-1·P-2).
 *
 * `?wb=memo` · `?wb=transcript` 주소는 **그대로 산다.** 진입 링크(`MeetingIntakeBox`)가
 * 이미 그 둘만 쓰고 있어 한 글자도 안 바뀐다 — 다만 이제 그 값이 붙어 있으면
 * 「근거를 펼친 채로 연다」는 뜻을 함께 갖는다.
 *
 * **컴포넌트 밖에 두는 이유**(완료 조건 E-6): 이 판정이 틀리면 화면은 멀쩡한데 늘 엉뚱한
 * 것이 열린다. `useEffect` 안의 식으로 두면 실브라우저 말고는 검증 수단이 없다.
 */

/** 근거의 두 층. `MeetingWorkbench` 의 탭 id 와 같아야 한다 */
export const EVIDENCE_TABS = ['memo', 'transcript'] as const

export type EvidenceTab = (typeof EVIDENCE_TABS)[number]

export function isEvidenceTab(v: unknown): v is EvidenceTab {
  return typeof v === 'string' && (EVIDENCE_TABS as readonly string[]).includes(v)
}

/** 이 회의에 실제로 무엇이 들어 있나 — 서버가 판정해서 내려준다 */
export interface WorkbenchMaterial {
  /** 사람이 쓴 본문이 있나 (`meeting_notes.body_plain` 이 비어 있지 않은가) */
  hasBody: boolean
  /** 기계가 받아적은 전사가 있나 (`meeting_transcript_segment` 에 한 줄이라도 있는가) */
  hasTranscript: boolean
}

/**
 * 근거를 펼쳤을 때 **어느 쪽**을 열까. 주소에 `?wb=` 가 없을 때만 쓴다.
 *
 * 순서에 뜻이 있다:
 *   ① 사람이 쓴 것이 있으면 그것부터 — 방금 쓴 것을 못 찾는 일이 없어야 한다
 *   ② 없고 전사만 있으면 전사 — 녹음만 한 회의는 거기가 내용이다
 *   ③ 둘 다 없으면 작성 — 빈 화면에서 할 일은 「쓰기」다(빈 전사 탭은 할 일이 없다)
 *
 * 예전 판(`pickDefaultWorkbenchTab`)과 **판정 규칙이 같다.** 달라진 것은 후보에서
 * 「정리」가 빠졌다는 점뿐인데, 예전에도 정리는 절대 반환되지 않았으므로
 * **동작은 한 글자도 안 바뀐다** — 세 갈래가 두 갈래로 줄어 판정이 단순해졌을 뿐이다.
 */
export function pickEvidenceTab(m: WorkbenchMaterial): EvidenceTab {
  if (m.hasBody) return 'memo'
  if (m.hasTranscript) return 'transcript'
  return 'memo'
}

/**
 * 「근거」를 **처음부터 펼쳐 둘까.**
 *
 * 정리가 있으면 접는다 — 결론을 읽으러 온 것이고, 근거는 *"그 말이 어디서 나왔나"* 를
 * 확인할 때 편다. 정리가 없으면 편다 — 그때 할 일은 **쓰거나 녹음하는 것**이고,
 * 접힌 근거만 보이는 화면에서는 적을 자리가 한 번 더 눌러야 나온다.
 *
 * **이 규칙이 모바일을 살린다.** 회의노트는 회의 «중»에 폰으로 여는 화면이다.
 * 그때는 정리가 아직 없으므로 근거가 펼쳐지고, 적을 자리가 스크롤 없이 바로 보인다.
 * 「정리는 항상 상설」을 문자 그대로 적용하면 정작 회의 중에 쓸 수 없는 화면이 된다.
 */
export function evidenceOpenByDefault(m: WorkbenchMaterial & { hasDigest: boolean }): boolean {
  return !m.hasDigest
}

/**
 * 본문이 실제로 내용을 가졌나 — 빈 리치텍스트를 「있다」로 세지 않는다.
 *
 * Tiptap 은 비어 있어도 `<p></p>` 를 남긴다. 그래서 `body_html` 의 길이로 재면
 * **한 글자도 안 쓴 회의가 늘 작성 탭**으로 열린다(그건 맞지만 판정은 틀린 것이다 —
 * 녹음만 한 회의도 빈 작성 탭을 본다).
 * plain 으로 재고, 공백만 있는 것도 빈 것으로 본다.
 */
export function hasBodyContent(bodyPlain: string | null | undefined): boolean {
  return Boolean(bodyPlain && bodyPlain.trim().length > 0)
}
