# Summary — v0.7.221 (Ralph Loop)

## 목표
GPU 가격 데이터가 어떤 화면/경로에서도 stale로 남지 않게 **근본 종결**.

## 배경
전역 SWR: 영속캐시 + `revalidateIfStale:false`. 변경 감지는 `SyncRevalidator`(sync/version 토큰)인데 **GPU pricing이 matcher·토큰 모두 누락**. v0.7.219/220은 GPU 관리 화면에 nested SWRConfig로 마운트 재검증을 강제(국소). 이번엔 **근본 sync 경로로 전 pricing 화면을 일원 커버** + catalog 독립 라우트 보강.

## 핵심 설계 결정
- **pricing 토큰 = `gpu_audit_logs`의 `count|max(ts)`** (org-wide). 이유: `supply_quotes`에 `updated_at`이 없고, **모든 가격 변경(지정/견적/전략가/마진)이 gpu_audit_logs에 기록**되므로 단일 테이블 토큰으로 전 pricing 변경을 잡는다. `gpu_audit_logs`는 member_read RLS라 토큰 조회 가능.
- version endpoint의 기존 7토큰은 user-scoped(프라이버시). pricing은 **org 공유·member-readable**이라 org-wide가 정당(신규 정보 노출 없음).
- SyncRevalidator matcher `pricing: k => k.startsWith('/api/pricing')` → 토큰 변경 시 모든 pricing SWR 재검증. 미변경 시 네트워크 0(영속캐시 최적화 보존).

## 수정 파일
- `apps/web/app/api/work/sync/version/route.ts` — pricing 토큰(gpu_audit_logs) 추가, org-wide 헬퍼.
- `apps/web/app/(member)/SyncRevalidator.tsx` — RESOURCE_KEY_MATCHERS에 `pricing` 추가.
- `apps/web/app/(member)/pricing/catalog/layout.tsx` (신규) — 독립 라우트 nested SWRConfig(revalidateIfStale:true) belt-and-suspenders.

## 효과
- 관리자 A가 지정/가격 변경 → gpu_audit_logs 기록 → 토큰 bump → 관리자 B(또는 리로드)가 다음 마운트/네비게이션에서 pricing 키 자동 재검증 → stale 해소. 변경 없으면 네트워크 0.
- catalog 독립 라우트: ②(SyncRevalidator는 member 레이아웃서 동작)로 커버 + ① nested로 이중 보강.

## 검증
- 실DB×Playwright: 가격변경 후 타세션 sync 재검증 / catalog standalone fresh / 데이터 원복.
- tsc · 테스트 · design:check · DC-QA/SEC/REV · GATE 1-5.

## 완료 조건(체크는 fix_plan.md)
- [ ] CRUD 무관(읽기 freshness만), 신규 엔티티 없음 → Feature Defaults 비대상.
