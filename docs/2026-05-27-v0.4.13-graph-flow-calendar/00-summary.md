# v0.4.13 — 관계도 Force-directed + 플로우뷰 + 캘린더 target_date 연동
생성: 2026-05-27

## 목표
일일업무의 시간축(캘린더)·관계축(그래프/플로우)을 UI에서 완전히 탐색 가능하게 한다.

## 구현 내용

### 1. KnowledgeGraphView — Force-directed 레이아웃 + 노드 클릭 팝업
- `apps/web/app/(member)/daily/KnowledgeGraphView.tsx` 신규 생성
- 기존 원형(circular) 하드코딩 → 물리 시뮬레이션 force-directed 전환
  - 반발력(charge), 연결 인력(link attraction), 중심 중력(center gravity) 적용
  - 150 tick 후 수렴, 6 tick마다 React state 업데이트
- 노드 클릭 → 상세 팝업: 상태 배지, D-day 배지, 전체 내용, 예정일, 상위/파생 업무 목록

### 2. LogFlowView — 업무 플로우 트리 뷰
- `apps/web/app/(member)/daily/LogFlowView.tsx` 신규 생성
- 각 로그 카드 우측 🌊 버튼 → 모달 팝업
- parent_log_id를 따라 루트까지 역추적 후 전체 트리 구성
- 자동 방향: ≤5 노드 = 세로, >5 노드 = 가로 (horizontal scroll)
- 현재 선택 노드 강조 (color border + bg)

### 3. 캘린더 target_date 이중 표시
- `apps/web/app/api/calendar/month/route.ts` 수정
- 쿼리: `log_date` 범위 OR `target_date` 범위 union query (Supabase `.or()`)
- 처리: 각 row를 log_date 셀 + target_date 셀(다를 경우) 양쪽에 모두 추가
- 결과: 예) "보고서 팀장 검토"(5/27 작성, target=5/28) → 5/27, 5/28 양쪽 표시

## 수정 파일
- `apps/web/app/(member)/daily/KnowledgeGraphView.tsx` (신규)
- `apps/web/app/(member)/daily/LogFlowView.tsx` (신규)
- `apps/web/app/(member)/daily/page.tsx` (import 추가, 기존 KnowledgeGraphView 제거, 🌊 버튼 추가)
- `apps/web/app/api/calendar/month/route.ts` (union query + dual cell 처리)

## 검증 (Playwright)
- ✅ 관계도 force-directed 렌더링 확인
- ✅ 노드 클릭 → 팝업 (상태, 파생업무 7개 표시)
- ✅ 🌊 버튼 → 플로우 모달 (가로 레이아웃, target_date 📅 표시)
- ✅ 5월 28일 캘린더에 "D-1 보고..." 표시 (log_date=5/27, target_date=5/28)
- ✅ 6월 2일 캘린더에 "D-6 계약..." 표시 (log_date=5/27, target_date=6/2)
- ✅ TypeScript noEmit 에러 0
