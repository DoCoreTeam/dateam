# AI 분석 시 임시저장 제거 — v0.7.254 (FAST)
작업: 통합입력에서 AI 분석을 실행하면 임시저장(복원 draft) 제거 → 새로고침 시 복원배너 안 뜸. 분석 안 누르면 draft 유지(복원).
대상: QuoteRegisterTab handleAnalyze — res.ok 직후 rawTextDraft.clear()(persist만 제거, textarea 값·결과는 유지).
이유: 이미 분석한 입력이 새로고침 때 복원 권유되는 혼란 제거.
검증: tsc0·next build.
