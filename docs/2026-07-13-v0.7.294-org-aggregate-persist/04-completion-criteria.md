# 완료 기준 — org_weekly_reports 영속

## 신규 테이블 Feature Defaults (신규 리소스 도입)
- [x] Create: POST(취합) UPSERT / PUT(편집) UPSERT
- [x] Read: GET 저장본 조회 + mount 자동 복원
- [x] Update: PUT 편집 저장 (source_hash 보존)
- [ ] Delete: 소프트삭제 — **범위 외**(취합본은 주차별 UPSERT 덮어쓰기 모델, 개별 삭제 UI 불요. 사용자 미요청)
- [x] 행 수준 권한/RLS: admin 전용 read/write, default-deny (`149_..sql`)
- [x] 테넌트/스코프 필터: `unique(scope_key, week_start)` — 전체/개인/부서 스코프 격리
- [ ] 검색/정렬/필터/페이지네이션: **범위 외**(취합본은 주차·스코프 단건 조회, 목록 컬렉션 아님)
- [x] 로딩/빈/에러 3종 UI: 기존 AdminReportsPreview 유지(overlay/empty/error)

## 기능 완료
- [x] preview GET/POST/PUT 3메서드
- [x] scope_key 순수함수 + 단위테스트
- [x] source_hash 일치 시 Gemini 재호출 skip
- [x] 클라이언트 sessionStorage 제거 → DB 소스
- [x] typecheck 통과
- [x] 단위테스트 통과
- [x] 🟥 DC-REV + 🟥 DC-SEC 리뷰

## 리뷰 반영 (🟥 DC-REV 74→재검, 🟥 DC-SEC)
- [x] H-1(SSOT): `sourceHash`/`bodyHash` 중복 → `lib/reports/source-hash.ts` 신설, 양쪽 import
- [x] H-2(편집보존): POST 재취합 시 저장본을 `existingBody`로 mergeCtx 주입(엔진 B와 동일)
- [x] SEC-H1(인가): `resolveScope`에서 `deleted_at is null` 검사(소프트삭제 admin 차단)
- [x] M-2(경계): `resolveScope`에서 memberIds 빈배열 → null 정규화(GET/POST/PUT/scope_key 일관)
- [x] M-1(편집 PUT): 키스트로크마다 PUT → 모달 닫힐 때 1회 저장으로 변경(N+1·race 완화)
- [x] M-3/SEC-M1(PUT 검증): `sanitizeReports` 필드 화이트리스트 + 500행·20000자 상한
- [x] M-4(UX): mount 복원 중 "저장본 불러오는 중…" 표기
- [x] L-1(FK): `edited_by ... on delete set null`
- [x] SEC-M2(정보노출): 에러 원문 응답 → 고정 문구 + `console.error`

## 정책 메모(동작)
- 다중 탭 동시 편집: last-write-wins(PUT). 단일 admin 편집 전제 — 문서화.
- 편집 후 원본 무변경 상태에서 재취합: 저장본(편집분) 반환(Gemini skip). 원본 변경 시: existingBody로 병합·보존.

## 검증(코드 레벨) 후 사용자 실행 필요
- [ ] 마이그레이션 적용(migrate.sh — DB 비밀번호) → 실제 DB 반영
- [ ] git push (정책상 사용자 실행)
