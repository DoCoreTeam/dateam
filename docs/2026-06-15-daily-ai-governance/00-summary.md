# 일일 AI 품질개선 + 자가학습 거버넌스 일반화 + 주간 후속 — 작업 요약

작성 2026-06-15 · v0.7.112 · HEAVY · 도메인=AI 프롬프트 거버넌스/일일·주간

## 배경 (🟦 DC-ANA×2)
- 일일 AI 저장이 과분할(병합규칙 부재)·오분류(어미패턴 의존+사용자 분류맥락 미주입).
- 자가학습(synthesize/eval/autoActivate/monitor/golden-set)이 **GPU 추출 전용** — 일일 경로엔 배선·eval·품질신호 전무.

## 작업 (A+B 전부)
즉효: D-5(일일 프롬프트 개선)·E-1(confirmed 재취합 가드)·E-2(prevWeekStart 추출+테스트).
일반화: D-1(eval 도메인 spec화)·D-4(하드코딩 프롬프트 ai_prompts 이관)·D-3(일일 golden-set)·D-2(outcome 신호)·배선(일일 자가합성).

## 수정/신설 (요지)
- lib/week.ts(순수, prevWeekStart) + 테스트 / org-actions import
- 마이그093: daily.analyze-work 프롬프트 갱신(병합규칙·{EXISTING_TODAY}·분류예시) / analyze-work 라우트 변수 주입
- OrgWeeklyView: confirmed 재취합 확인 모달
- prompt-governance: evalPromptCandidate(content, spec) + PROMPT_EVAL_SPECS
- 마이그094: weekly.* / daily.to-weekly 프롬프트 seed → lib들 DB우선·상수폴백
- lib/daily-golden-set.ts + evalDailyExtraction + 테스트
- 마이그095: ai_prompt_outcomes + 일일 저장후 편집 비율 기록 → degraded 신호 → 일일 자가합성 배선

## 제약
- GPU 거버넌스 무회귀(일반화는 GPU 기본값 보존). 마이그 롤백 가능. 계산식 무관. push 금지.

## 완료조건
- D-1~5·E-1·E-2 전부 + tsc0/test/design/lint + 🟥 DC-QA/SEC/REV + Playwright(일일 과분할 개선·confirmed 가드)
