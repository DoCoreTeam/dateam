# 02-task-breakdown

## Phase A (데이터)
- A1. 마이그 `174_gpu_products_merge_rpc.sql` — `merge_gpu_products_apply(uuid, uuid[])` RPC (13 FK 재연결 + 충돌삭제 + 소프트삭제).
- A2. 같은 파일 DO 블록 — 완전중복 29그룹 survivor/losers 계산 후 RPC 호출(멱등).
- A3. migrate.sh 적용(174) → DB에서 dup 0 검증.

## Phase B (표시)
- B1. `lib/gpu/canonical-model.ts` — `baseModelKey()` export + `lib/gpu/canonical-model.test.ts`에 케이스 추가.
- B2. `app/api/pricing/gpu/specs/route.ts` — GET 그룹핑을 base+폼팩터 2단으로 변경(하위호환 유지).
- B3. `app/(member)/pricing/gpu/tabs/SpecsTab.tsx` — 모델→폼팩터→수량 사다리 2단 렌더.
- B4. 폼팩터 수량 사다리 표시파생 헬퍼(있으면 config-ladder 재사용).

## 검증/마감
- V1. `pnpm exec tsc --noEmit` green.
- V2. 신규/영향 단위테스트 통과(canonical-model.test 포함, package.json test 목록 등록).
- V3. `pnpm design:check` green.
- V4. 실브라우저: GPU 관리에서 H100 1종 + 폼팩터/수량 전개 확인, 5개 화면 회귀 확인.
- V5. 버전범프(0.7.377, 루트+web+CLAUDE.md+AGENTS.md) + changelog entries.ts + commit(no push).
