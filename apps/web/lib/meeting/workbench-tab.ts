/**
 * 회의 작업대가 **처음 보여 줄 탭** — SSOT
 *
 * **왜 이 파일이 생겼나** (사용자 지적 2026-08-31):
 * *"작성된 내용이 먼저 나와야 하는곳에서는 녹음 전사가 갑자기 나오고"*
 *
 * 실측: `/crm/today` 의 미팅 줄이 `?wb=transcript` 를 **조건 없이** 붙이고 있었다
 * (`components/crm/MeetingIntakeBox.tsx`). 그래서 사용자가 193자를 써 둔 회의를 눌러도
 * **빈 전사 탭**이 열렸다. 내용은 바로 옆 「작성」 탭에 그대로 있었다.
 *
 * 링크에서 쿼리를 빼면 `SegmentedTabs` 가 첫 탭(작성)을 고른다 — 대부분은 그게 맞다.
 * 그런데 **녹음만 한 회의**는 본문이 비어 있고 전사에 다 들어 있다. 그때 작성 탭이 열리면
 * 같은 사고가 방향만 바꿔 재발한다. 그래서 "무엇이 있는가"로 정한다.
 *
 * **컴포넌트 밖에 두는 이유**(완료 조건 E-6): 이 판정이 틀리면 화면은 멀쩡한데
 * 늘 엉뚱한 탭이 열린다. `useEffect` 안의 식으로 두면 실브라우저 말고는 검증 수단이 없다.
 */

/** 작업대의 세 층. `MeetingWorkbench` 의 탭 id 와 같아야 한다 */
export const WORKBENCH_TABS = ['memo', 'transcript', 'digest'] as const

export type WorkbenchTab = (typeof WORKBENCH_TABS)[number]

export function isWorkbenchTab(v: unknown): v is WorkbenchTab {
  return typeof v === 'string' && (WORKBENCH_TABS as readonly string[]).includes(v)
}

/** 이 회의에 실제로 무엇이 들어 있나 — 서버가 판정해서 내려준다 */
export interface WorkbenchMaterial {
  /** 사람이 쓴 본문이 있나 (`meeting_notes.body_plain` 이 비어 있지 않은가) */
  hasBody: boolean
  /** 기계가 받아적은 전사가 있나 (`meeting_transcript_segment` 에 한 줄이라도 있는가) */
  hasTranscript: boolean
}

/**
 * 주소에 `?wb=` 가 **없을 때** 열 탭.
 *
 * 순서에 뜻이 있다:
 *   ① 사람이 쓴 것이 있으면 그것부터 — 사용자가 방금 쓴 것을 못 찾는 일이 없어야 한다
 *   ② 없고 전사만 있으면 전사 — 녹음만 한 회의는 거기가 내용이다
 *   ③ 둘 다 없으면 작성 — 빈 화면에서 할 일은 "쓰기"다(빈 전사 탭은 할 일이 없다)
 *
 * 「정리」는 **기본값이 되지 않는다.** 정리는 결과물이라 그것만 열면 원문을 볼 수 없고,
 * 사용자가 확인하려는 것은 대개 "내가 적은 게 제대로 있나"다.
 */
export function pickDefaultWorkbenchTab(m: WorkbenchMaterial): WorkbenchTab {
  if (m.hasBody) return 'memo'
  if (m.hasTranscript) return 'transcript'
  return 'memo'
}

/**
 * 본문이 실제로 내용을 가졌나 — 빈 리치텍스트를 "있다"로 세지 않는다.
 *
 * Tiptap 은 비어 있어도 `<p></p>` 를 남긴다. 그래서 `body_html` 의 길이로 재면
 * **한 글자도 안 쓴 회의가 늘 작성 탭**으로 열린다(그건 맞지만 판정은 틀린 것이다 —
 * ②가 영원히 발동하지 않아 녹음만 한 회의도 빈 작성 탭을 본다).
 * plain 으로 재고, 공백만 있는 것도 빈 것으로 본다.
 */
export function hasBodyContent(bodyPlain: string | null | undefined): boolean {
  return Boolean(bodyPlain && bodyPlain.trim().length > 0)
}
