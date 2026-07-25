# FAST PATH Summary — 목록 심층분석 "틀에 갇힌 출력" 해소 (지시 주도 골격 가변)

## 작업
항목 심층분석 결과가 항상 `본문 → 근거 → 가정 → 미결 질문` 고정 골격으로만 나오던 것을,
**사용자 지시(command)가 있으면 지시한 형식 그대로 자유 서술**(근거/가정/미결질문 래퍼·JSON 스키마 없음),
**지시가 없으면 현행 복원 골격 유지**로 분기.

## 원인 (진단 확정)
- 활성 경로 = `refineGroupItem`(analyze-core.ts) → `renderRefineMarkdown`(refine-group.ts:142).
- `renderRefineMarkdown`이 모든 그룹 결과에 무조건 `근거/가정/미결 질문` 3섹션을 덧붙임.
- `buildRefinePrompt`가 `{markdown,evidence,assumptions,openQuestions}` JSON 스키마를 강제.
- `command`는 "최우선"이라면서 본문 내용에만 영향, 바깥 골격은 지시와 무관하게 고정 → "틀에 갇힘".

## 대상 파일
- `apps/web/lib/ai-chat/grouping/refine-group.ts` — `buildFreeRefinePrompt`·`freeRefineOrFallback` 신설(자유 서술 모드).
- `apps/web/lib/ai-chat/analyze-core.ts` — `refineGroupItem`에 command 유무 분기.

## 이유
사용자가 "회의록 형식으로 / 1페이지 요약으로" 등 지시해도 같은 틀로 수렴 → 지시가 골격까지 지배하도록.

## 영향 / 유실0
- 반환 계약 `{resultText, parseOk, usage}` 불변 → runner-worker·조립(⑦)·synth 무변경.
- 자유 모드도 유실0 보존: AI 빈 응답 시 `group.bodyRaw`로 폴백.
- command 없는 세션(기존 다수)은 동작 완전 동일(회귀 없음).
