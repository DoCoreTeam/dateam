# v0.4.14 — LogFlowView 전면 재설계

생성: 2026-05-27

## 문제
- 카드 겹침 / 잘림 (가로 스크롤 발생)
- 화살표 연결선 안 보임
- 플로우 정책 불명확 (연관 이유 없음)

## 구현 내용

### 1. DB 마이그레이션 023
- `daily_logs.flow_reason TEXT NULL` 컬럼 추가

### 2. API `/api/daily/flow-reason`
- POST `{logId}` → 부모+자식 content 읽어 Gemini로 한 줄 파생 이유 생성
- DB 저장 후 반환
- 플로우 뷰 열 때 flow_reason 없는 노드만 lazy 생성

### 3. LogFlowView 전면 재작성
- **레이아웃**: 세로 타임라인 (가로 스크롤 완전 제거)
- **반응형**: 모바일=하단 시트 / 데스크탑=우측 사이드패널 (day-panel CSS 재사용)
- **트리 표시**: DFS flat 배열로 depth별 indent
- **현재 노드 강조**: 색상 테두리 + bg 하이라이트
- **flow_reason**: 각 노드 카드 하단에 AI 분석 한 줄 표시

## 수정 파일
- `supabase/migrations/023_daily_logs_flow_reason.sql` (신규)
- `apps/web/app/api/daily/flow-reason/route.ts` (신규)
- `apps/web/types/database.ts` (flow_reason 필드 추가)
- `apps/web/app/(member)/daily/LogFlowView.tsx` (전면 재작성)

## 테스트 정책
- 기존 데이터 제거 후 새 로그 생성하여 처음부터 테스트
- parent_log_id 체인: 루트 → 자식 → 손자 순서로 생성 검증
