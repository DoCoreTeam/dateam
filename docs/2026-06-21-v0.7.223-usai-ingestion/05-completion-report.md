# 05 — 완료 보고 (v0.7.223)

## 결과
GPU 통합입력에 **USAI 7단계 AI주도 흡수 엔진** 구축 — 비정형 다중블록·미지 형식을 고정 파서가 아닌
AI 구조발견 + 형식불변 검증 + 자기일관성 + 사람 확정 게이트로 흡수. 피처플래그 `GPU_USAI_INGEST`(기본 OFF).

## 검증 (실측)
- **단위/통합 테스트 437/437 통과**, tsc 0, lint 0, design:check 통과, next build 성공.
- **실 Gemini 라이브**(실제 타겟 xlsx): 9블록 발견·통화 블록별 정확(KRW/USD)·담당자명부 제외·은닉시트 포함 3시트·전 항목 own_target·needs_human 0·**T4 0.7977 USD/GPU/hr**(원 버그 6.48 교정).
- **Playwright UI E2E**: throwaway 관리자 비번 로그인 → 실 route(USAI flag) → 실 Gemini(76s) → 실 DB: status200·engine=usai·count188·own_target·T4 0.7977. 스크린샷 e2e/usai-intake-result.png. throwaway·is_test 정리 완료(운영 오염 0).

## 9개 실패모드 해소 (회귀 고정)
F1 다중블록 / F2 명부분리 / F3 단위오선택(6.48) / F4 통화혼재 / F5 다중시트 / F6 병합셀 / F7 분류오류 / F8 빈블록 / F9 표시정밀 — 전부 단위·통합 테스트 + 라이브로 입증.

## 평가
- 🟥 DC-SEC: CRITICAL 0 → 머지 가능. (H1 프로토타입오염/길이상한 즉시 반영)
- 🟥 DC-REV: APPROVED 84/100. (HIGH 중 term 정규화·dedup·krwPerUsd sanity 즉시 반영)
- 🟥 DC-QA: 에이전트 verdict 미반환(행) — 테스트 커버리지는 DC-REV가 [APPROVED]로 검증.

## 즉시 반영한 평가 권고
- H1: extractArray 프로토타입오염 키 거부 + 배열 1000 상한
- REV: intake-verify term 표기차 정규화(자기일관성 누락 차단), USAI 경로 dedup(동일 정규화값 접기, 불일치는 유지), krwPerUsd 합리범위(800~3000) sanity

## own_target → 전략가(strategic price) 반영 — 구현 완료 (사용자 승인 후 추가)
- confirm 시 own_target(on_demand)을 `gpu_products.strategic_price_krw`에 반영. SSOT `lib/gpu/own-target-import.ts`(matchProductId 순수매칭 + USD×fx KRW환산 + on_demand 전용 + audit + revalidate). 매칭 제품 없으면 graceful 422, reserved는 컬럼 부재로 스킵(무음 금지).
- AI 일시오류(429/5xx) catalog route에 3회 지수백오프 재시도 추가(REV/QA 견고성 권고).
- **포괄 UI E2E 통과(2.1m)**: ①타겟 재흡수 count57(dedup)·T4 0.7977 own_target(이전과 동일) ②own_target V100 confirm→strategic_price_krw=1389 반영(0.9117USD×1523) ③gcube 다른파일→target=supplier 분류·needs_human34(A6000 지역가 불일치). **실 전략가 변경은 스냅샷 원복**(운영 오염 0: strategic set 2→2, is_test 0).

## 후속 과제 (이번 범위 밖 — 무음 누락 방지 위해 명시)
1. **요금제별 전략가**: 현재 strategic_price_krw는 product당 단일(on_demand만). reserved 약정별 전략가는 컬럼 신설 필요 시 별도.
2. 비KRW/USD 통화(EUR/JPY/CNY) fx 환산표 — 현재 미지원 시 needs_human. 통화등록+fx를 단일 SSOT로 통합 권고(REV).
3. AI 호출 실패 vs 빈 결과 구분 메시지 세분화, 블록 추출 병렬화(perf) (REV).
4. 유럽식 숫자표기(1.234,56) 파싱, 날짜셀(cellDates) 처리 (REV).
5. gpu_audit_logs 무음 실패 패턴·(adminClient as any)는 기존 코드 컨벤션 — 전역 정비 시 함께(REV).
6. 누락 회귀테스트(EUR f0fx 흐름, AI throw, 절단 회귀) 보강.

## 제약 준수
git push·npm publish 안 함(커밋까지). 마이그레이션 122·123 적용 완료. 운영 데이터 오염 0.
