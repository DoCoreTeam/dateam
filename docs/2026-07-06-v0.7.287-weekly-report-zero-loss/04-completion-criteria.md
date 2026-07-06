# 04 · 완료 기준 (구현 승인 후 GATE에서 라인별 검증)

> 이번 턴은 **기획까지**. 아래는 구현 착수 승인 시 "완료"를 판정할 체크리스트.

## P0 — 데이터 보존 (하나라도 ❌면 전체 FAIL)
- [ ] `weekly_report_snapshots` 테이블 생성 + RLS(SELECT=본인, INSERT=본인, UPDATE/DELETE 정책 없음)
- [ ] `replace_weekly_report`가 DELETE **직전** 현재 확정본 전체를 스냅샷(동일 트랜잭션) — INV-1~3 PASS
- [ ] 스냅샷 append-only 불변 — INV-4 PASS
- [ ] 배포 시 현재 활성 확정본 전량 시딩 — MIG-2 PASS (이도현 06-29 5개 포함 확인)
- [ ] 마이그 무손상 — MIG-1, MIG-3 PASS

## P0 — 단일 Writer (원인 ② 제거)
- [ ] `draft/route.ts` PUT이 `weekly_reports`를 더 이상 쓰지 않음 — SW-2 PASS
- [ ] 06-29 재현: 고인 초안 상태에서 초안경로 조작해도 확정본 5개 불변 — SW-3 PASS
- [ ] 정적 스캔 가드로 확정본 writer 화이트리스트 강제 — SW-1 PASS (신규 테스트 파일 test 목록 등록)

## P0 — 사용자 복원 UX
- [ ] 주간보고 화면 "편집 이력" 패널: 주차별 스냅샷 목록(KST 시각·항목수·사유)
- [ ] [복원] → 폼 프리필(기본) 또는 확정본 직접복원, 복원 직전 상태 자동 스냅샷 — E2E-1,2 PASS
- [ ] 타 사용자 스냅샷 접근 차단 — E2E-3 PASS

## P1 — 관측/회귀 (원인 ③)
- [ ] `replace_weekly_report`가 activity 기록 + department_id + content_hash 복원 — LOG-1,2 PASS
- [ ] timeliness 지연판정 회귀 없음 — LOG-3 PASS

## 품질 게이트
- [ ] `tsc --noEmit` PASS
- [ ] `pnpm test`(신규 테스트 파일 목록 등록됨) PASS
- [ ] `pnpm design:check` PASS + 폼/모달 §2-1·2-2 눈검증(input-field/label/모달표준)
- [ ] Playwright E2E(A/B/복원) PASS — 실화면(내가 직접, throwaway 계정)
- [ ] 전 페이지 full-width 반응형·페이지폭 SSOT 준수, 신규 컴포넌트 토큰/공용컴포넌트만
- [ ] 🟥 DC-REV APPROVED + 🟥 DC-SEC(RLS/입력검증) PASS
- [ ] 버전 체크리스트(root+apps/web package.json, CLAUDE.md, AGENTS.md) 반영
- [ ] 커밋 형식 `v{VERSION}: … claude` / **push·npm publish는 사용자 몫**(자동 금지)

## 제외(백로그)
- 낙관적 동시성(loaded_at 토큰 기반 저장 충돌 경고) — 스냅샷으로 이미 유실 방어됨. 편의개선으로 후속.
- 초안↔확정본 양방향 병합 UI — 단일 writer 채택으로 불필요.

## "완료" 한 줄 정의
사용자가 저장·AI반영·복원을 어떤 순서로 해도 **작성분이 영구 소실되지 않고**, 소실 정황이 생겨도 **사용자가 스스로 이전 버전을 되살릴 수 있다.**
