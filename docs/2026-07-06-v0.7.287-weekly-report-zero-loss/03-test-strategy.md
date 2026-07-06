# 03 · 테스트 전략

> 핵심: "유실 0"은 **자연어 주장이 아니라 테스트로 증명**한다. 각 근본원인 → 재현 테스트 → 방어 검증.

## A. 데이터 보존 불변식 (P0 — 가장 중요)

| ID | 시나리오 | 기대 | 유형 |
|----|----------|------|------|
| INV-1 | 확정본 7개 저장 → 5개만 담긴 저장 재호출 | 저장 직전 7개가 `weekly_report_snapshots`에 존재 → 복원하면 7개 완전 회복 | RPC 단위(psql) |
| INV-2 | 저장 N회 반복 | 스냅샷 N행, 각 행 rows_json이 그 시점 직전 상태와 일치 | RPC 단위 |
| INV-3 | 빈 상태에서 첫 저장 | 스냅샷 1행(row_count=0, rows_json='[]'), 확정본은 신규행 | RPC 단위 |
| INV-4 | 스냅샷 UPDATE/DELETE 시도 | RLS로 거부(정책 없음) = append-only 불변 | RPC 단위 |
| INV-5 | 더블세이브(연속 2회, 뒤가 작은 셋) | 뒤 저장이 이겨도 앞 상태가 스냅샷에 존재 → 복원 가능 | 통합 |

## B. 단일 Writer (원인 ② 회귀 차단)

| ID | 검증 | 방법 |
|----|------|------|
| SW-1 | `weekly_reports`를 쓰는 앱 경로가 `upsertWeeklyReport`(+삭제/복원 액션)로 한정 | **정적 스캔 테스트**: `rpc('replace_weekly_report'` 및 `from('weekly_reports').(insert|delete|update)` grep → 화이트리스트 외 0건 (kst-guard 패턴 답습) |
| SW-2 | draft PUT 호출 후 `weekly_reports` 무변경 | 통합: 초안 저장 전/후 확정본 diff = 0 |
| SW-3 | 06-29 재현: 고인 초안(2개, 과거) 존재 상태에서 draft PUT | 확정본 5개 그대로 유지 | 통합 |

## C. 감사로깅·부서 복원 (원인 ③)

| ID | 검증 |
|----|------|
| LOG-1 | 저장 시 `weekly_report_activity`에 create/edit 1행 + department_id NOT NULL + content_hash NOT NULL |
| LOG-2 | 최초=create, 재저장=edit 정확 분류 |
| LOG-3 | timeliness(지연판정) 서버 로직이 복원된 로그로 정상 동작(회귀 없음) |

## D. 복원 UX (Layer 2 E2E)

| ID | 흐름 |
|----|------|
| E2E-1 | 로그인 → 주간보고 저장(A안) → AI초안 "폼에 반영" → 다르게 저장(B안) → 편집이력에서 A안 [복원] → 폼/확정본이 A안으로 회복 |
| E2E-2 | 복원 후 다시 편집이력에 B안이 남아있어 되돌리기 가능(복원의 되돌리기) |
| E2E-3 | 타 사용자 스냅샷 접근 불가(RLS) |

## E. 무손상 마이그레이션

| ID | 검증 |
|----|------|
| MIG-1 | 143 적용 전/후 기존 `weekly_reports`·`weekly_report_items` 행수·내용 동일(추가·REPLACE만) |
| MIG-2 | 시딩 후 모든 (user,week) 활성 확정본이 스냅샷 1건 이상 보유 |
| MIG-3 | 상태플래그(must_change_password 등) 무변경(프로젝트 원칙) |

## 실행 방법
- RPC 단위: `psql`로 트랜잭션 내 SELECT/INSERT 검증(테스트 사용자 = is_test/throwaway, **운영 실데이터 오염 금지**).
- 정적 스캔(SW-1): `apps/web/package.json` test 목록에 신규 `*.test.ts` **명시 추가**(자동 포함 안 됨).
- E2E: Playwright, throwaway 계정으로 실화면 검증(정적검증만으론 런타임버그 못잡음).
- 커밋/PR 전: `tsc --noEmit` + `pnpm test`(파일목록) + `pnpm design:check` + E2E.

## 커버리지 목표
- RPC/보존 불변식(A) 100% 시나리오. 단일writer 정적가드(B) 필수. 전체 80%+.
