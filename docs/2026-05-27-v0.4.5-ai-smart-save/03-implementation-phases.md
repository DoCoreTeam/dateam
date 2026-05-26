# AI 스마트 저장 — 구현 단계

## Phase 1: 기반 (DB + API)
**목표**: AI 처리 결과를 저장할 수 있는 구조 만들기

- [ ] DB 마이그레이션: `daily_work_logs` 테이블 컬럼 추가
  - `priority`, `scheduled_at`, `ai_processed`, `ai_confidence`, `original_input`
  - `linked_account_id`, `linked_contact_id` (FK)
- [ ] `/api/ai/analyze-work` 엔드포인트 생성 (스트리밍)
- [ ] AI 프롬프트 작성 + 시스템 설정 모델 연동
- [ ] 거래처·담당자 목록 컨텍스트 주입 로직

## Phase 2: 핵심 UX
**목표**: 기본 AI 저장 플로우 작동

- [ ] AI 저장 버튼으로 기존 저장 버튼 교체
- [ ] 결과 패널 컴포넌트 (`AIResultPanel`) 구현
  - 슬라이드 애니메이션
  - 스트리밍 카드 렌더링 (skeleton → 실제 카드)
  - 인라인 편집 (상태/날짜/우선순위/거래처·담당자)
- [ ] "다시 분석" 기능
- [ ] "확정 저장" → 다중 항목 동시 저장

## Phase 3: 실시간 힌트 + 연동
**목표**: 더 스마트한 UX

- [ ] debounce 실시간 분석 힌트 (카운트만 표시)
- [ ] 연동 체크박스 (캘린더 / 주간보고 / 루틴)
- [ ] 캘린더 연동 저장 로직
- [ ] 폴백 처리 (AI 실패 시 일반 저장)

## Phase 4: 주간보고 AI 초안
**목표**: 주간보고 자동화

- [ ] 주간보고 페이지에 "AI 초안 생성" 버튼
- [ ] 이번 주 일간 로그 집계 로직
- [ ] 주간보고 프롬프트 작성
- [ ] 스트리밍 편집기 연동

## 우선순위 권장
Phase 1 → Phase 2 → Phase 3 → Phase 4 순서로 진행.
Phase 2까지 완료하면 MVP로 사용 가능.
