# FAST PATH — 목록 심층분석 "단일 H1 문서 1그룹으로 뭉침" 해소

## 작업
명확한 구조(## 섹션 다수)의 긴 문서가 항목별로 안 쪼개지고 통째로 1그룹이 되던 문제 해소.

## 원인 (진단 확정)
1. 그룹핑 AI가 세션 상속 모델(gemini-3.1-pro-preview)로 호출 → 그 모델 쿼터 429 → AI 판정 실패.
2. 결정론 폴백 `fallbackCutSpec`이 최소 레벨(minLevel)로 절단 → 문서 전체가 단일 H1 제목 아래 있으면
   레벨1=1그룹으로 문서 전체가 뭉침(실측: 506줄 1그룹).

## 수정
- `lib/ai-chat/grouping/cut-groups.ts` `fallbackCutSpec` — "2개 이상으로 갈라지는 가장 얕은 레벨"로 절단(단일 H1이면 레벨2로).
- `app/(member)/ai-chat/analyze/grouping-actions.ts` `makeAiCaller` — 세션 모델 실패 시 org 기본 모델(flash-lite)로 1회 폴백 → AI 판정 성공.

## 검증
- 단위 1건 추가(단일 H1 → level 2). tsc/design 통과.
- 실브라우저: 단일 H1 + 5섹션 문서 → "요구사항정의서로 판정됨 · 4개 그룹" (이전 "AI 판정 실패 · 1그룹").

## 영향
- 반환 계약·기존 그룹핑 로직 불변, 유실 0 유지.
