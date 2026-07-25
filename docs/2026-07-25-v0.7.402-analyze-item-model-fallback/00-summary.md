# FAST PATH — 목록 심층분석 항목 심화가 세션 모델(429)로 멈추고 실패하던 문제

## 원인
Fix B(v0.7.401)는 그룹핑 AI만 org 기본 모델로 폴백했다. 항목 심화(runner)·취합은 여전히
세션 상속 모델(gemini-3.1-pro-preview=쿼터 429)로 호출 → 4회 백오프 재시도(~100s) 끝에 실패,
그동안 "분석중"에서 멈춤.

## 수정
- `lib/ai-chat/analyze-core.ts` — 공용 `streamChatWithFallback(params, fallbackModel)` 추가:
  세션 모델 실패 시 org 기본 모델로 1회 폴백. `refineGroupItem`·`synthesizeItems`가 사용.
  `RefineGroupParams`·`synthesizeItems`에 `fallbackModel` 추가.
- `lib/ai-chat/analyze-runner.ts` / `analyze-runner-worker.ts` — runItem ctx에 `fallbackModel = geminiConfig.model` 전달.
- `app/(member)/ai-chat/analyze/analyze-item-actions.ts` — on-demand 취합도 `fallbackModel = cfg.model` 전달.

## 검증 (실브라우저, 직접)
채팅 모델 = gemini-3.1-pro-preview(429) 유지한 채 3섹션 문서 분석 →
"완료 3 · 분석중 0 · 실패 0 · 전체 3 · 완료", 종합 커버리지 3/3. 항목 내용 충실.
(이전: 항목이 분석중에서 멈추고 실패)

## 영향
- 반환 계약 불변, 유실0 유지. 세션 모델이 정상이면 폴백 미발동(동작 동일).
