# v0.7.170 — 영속 SWR 캐시 + 변경 플래그 조건부 재검증 (체감 속도)

목표: 재방문 시 localStorage 캐시로 즉시 렌더(stale-while-revalidate) + 변경 플래그로 안 바뀌면 네트워크 0. 업계 표준(SWR persist + version gate). 전부 additive·가역.

## Phase A — 영속 SWR 캐시 (이번 핵심)
- SWRProvider(app/(member)/SWRProvider.tsx)에 **localStorage 백업 cache provider** 추가: SWR Map cache를 localStorage에 직렬화/복원(디바운스 저장). 재방문 시 마지막 데이터 즉시 표시 후 백그라운드 재검증.
- **보안(필수)**: 캐시 키를 **userId 스코프**(`swr:<userId>:...`)로 저장. **로그아웃/계정전환 시 전체 클리어**(use-draft-user/use-draft-user 패턴 재사용 — 세션 userId 불일치 시 캐시 폐기). 민감 리소스(메모 등)는 옵션으로 제외 가능.
- TTL: 오래된 캐시(예 24h) 만료. 용량 가드(초과 시 LRU/clear).
- 결과: 기존 SWR fetch/keepPreviousData 동작 유지 + 디스크 영속만 추가. 회귀 0.

## Phase B — 변경 플래그 조건부 재검증
- 신규 GET /api/sync/version → 본인 기준 리소스별 max(updated_at)/count 맵 반환(예 { daily, calendar, dept, weekly, projects, accounts, ... }). 가벼운 단일 쿼리(집계).
- 클라: 진입 시 sync/version 1회 호출 → 캐시에 저장된 버전과 비교 → **같은 리소스는 SWR revalidate 스킵**(캐시 그대로), **다른 리소스만 mutate**. 변경 시만 실제 데이터 페치.
- 정합 핵심: max(updated_at)이 삭제도 반영하도록 count 병행 또는 soft-delete updated_at 갱신 확인.

## 재사용/안전
SWR provider API, use-draft-user(세션 userId), 기존 fetcher. localStorage 직렬화는 try/catch·용량 가드. additive — provider 교체 실패시 메모리 캐시 폴백. 공개 안전.
