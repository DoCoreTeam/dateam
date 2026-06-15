# 03 테스트·정확도 전략 (완전 자동의 신뢰 근거)

## 정확도 측정 — golden-set (필수 선행)
- 라벨 데이터: (업무 텍스트 ↔ 정답 연결 엔티티) 쌍 100~300건 수기 구축(실데이터 기반, is_test 격리).
- 지표:
  - **Precision@HIGH** (자동확정 밴드) — 목표 ≥ 0.92. 이게 미달이면 HIGH 자동확정 비활성, MID 추천으로 강등.
  - Recall@K (1차 리콜이 정답을 후보에 포함하는 비율) — 상한 결정.
  - 관계유형 정확도(derived_from/about_account 등).
- 임계값(τ_auto, τ_suggest)은 P/R 커브 운영점으로 결정 → config 저장. 임의 숫자 금지.

## 단위 테스트 (순수 로직)
- `lib/work/autolink.ts`: 밴드 분기(HIGH/MID/LOW) 결정성, 비대칭 임계값(업무 vs 거래처), 이름 trgm 가드 동시충족, 동일 입력 동일 출력.
- 임베딩 정규화/task_type 매핑(RETRIEVAL_DOCUMENT vs QUERY) 단위 검증.

## 통합/E2E (is_test 격리 + revert)
- 업무 저장 → 임베딩 생성 → 자동 연결이 daily_log_relations에 created_by='ai'로 생성되는지.
- HIGH=실선 자동확정 / MID=점선 추천 렌더, 근거·신뢰도 표시.
- 1클릭 해제 → 연결 삭제 + feedback 기록.
- 과거 날짜 업무와도 연결되는지(백필 전제).
- 오연결 시나리오: 동명 거래처("삼성" 다수) → trgm 가드로 HIGH 자동확정 차단되는지.

## 안전·회귀
- 기존 수동 경로(메모 승격 parent_log_id, AI 분리 origin_group) 무수정 보존.
- RLS: 타 조직 데이터로 연결 불가(권한 테스트).
- 비동기 큐 실패가 업무 저장을 막지 않음(부분 실패 격리).

## 운영 모니터링
- precision 대시보드(해제율=오연결 프록시), τ 자동 보정 로그, token 비용 추적.
