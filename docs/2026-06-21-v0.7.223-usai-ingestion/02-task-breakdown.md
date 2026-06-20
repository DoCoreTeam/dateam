# 02 — 태스크 분해

## Phase 0 — DOC-FIRST (이 문서들)
- [x] 5종 기획 문서

## Phase 1 — 코어 모듈 (순수, Gemini 불요 — 단위테스트 우선)
- [ ] T1 `lib/gpu/intake-grid.ts` — 전 시트 좌표격자 + 병합 보존 (+ test)
- [ ] T2 `lib/gpu/normalize-money.ts` — 통화/단위/gpu_count 선언적 lookup 정규화 SSOT (+ test)
- [ ] T3 `lib/gpu/intake-reconcile.ts` — 형식불변 정합·산술검사 (+ test)
- [ ] T4 `lib/gpu/intake-verify.ts` — 자기일관성·신뢰도 라우팅 (+ test)
- [ ] T5 `lib/gpu/grid-compress.ts` — anchor 압축(토큰 절감) (+ test)

## Phase 2 — AI 단계 (프롬프트 + 오케스트레이션)
- [ ] T6 프롬프트 `gpu.intake-discover` (블록발견+역할+분류) — ai_prompts 마이그레이션
- [ ] T7 프롬프트 `gpu.intake-extract-block` (블록별 추출+provenance) — 마이그레이션
- [ ] T8 `lib/gpu/usai-orchestrate.ts` — 1→7 단계 오케스트레이터(자가합성 루프 재사용)
- [ ] T9 catalog route를 USAI로 전환 (feature flag USAI_INGEST)
- [ ] T10 validate.ts ENUMS 정합(channel 'catalog', target source_type)

## Phase 3 — 골든셋 & 검증
- [ ] T11 골든셋 표본 등재: 타겟xlsx(기대 T4=0.81 등) + gcube(정상) + 변형 fixture 2종
- [ ] T12 `golden-eval` 확장 — 9개 실패모드 회귀 케이스
- [ ] T13 Playwright E2E — throwaway 계정, 타겟xlsx 업로드 → 검토대기 정상 표시 실측

## Phase 4 — 마무리
- [ ] T14 DC-QA / DC-SEC / DC-REV 병렬 평가
- [ ] T15 GATE 1-5 (tsc/lint/test/build/design:check)
- [ ] T16 버전 0.7.223 + 4파일 동기화 + git commit (push 금지)

## 의존
T1·T2 → T3 → T4 → T8. T5는 T8 전. T6·T7는 T8 전. T9는 T8·T10 후. T11~13은 T9 후.
