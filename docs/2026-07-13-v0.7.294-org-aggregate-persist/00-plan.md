# 전체/개인/부서 취합본 영구 저장 (Engine A 영속화)

- 버전: v0.7.294 / 성격: 버그 수정(영속 누락) + 신규 테이블 1개
- 배경: `docs/2026-07-13-weekly-aggregation-persistence-analysis` — 전체 조직 취합(Engine A)이 DB 저장 없이 sessionStorage에만 남아 세션 소멸 시 매번 재취합.

## 요구사항
- **어디서 취합하든(전체/개인/부서필터) 취합본이 DB에 남고, 재방문 시 그대로 복원**된다.
- 원본 변경이 없으면 재생성(Gemini 재호출) 없이 저장본을 반환한다(토큰 절약).
- 편집(셀 수정)도 DB에 영속된다.

## 아키텍처
- **신규 테이블 `org_weekly_reports`** (migration `149_org_weekly_reports.sql`)
  - `unique(scope_key, week_start)`, `body jsonb`, `source_hash`, `edited_by`, timestamps
  - `scope_key`: 전체=`all` / 개인=`member:<uid>` / 부서필터=`dept:<sha1(sorted uids)>`
  - RLS: admin 전용 read/write (default-deny). Engine A 라우트가 이미 role=admin 강제.
- **`lib/reports/org-scope-key.ts`**: `orgScopeKey(member, memberIds)` 순수 함수(테스트 대상)
- **`api/reports/preview/route.ts`** 리팩터:
  - `GET`  → 저장본 조회(Gemini 미호출). `{ reports, saved, updatedAt }`
  - `POST` → 취합 실행. 원본 해시 == 저장본 source_hash면 저장본 반환(재호출 skip), 아니면 Gemini 병합 → UPSERT → 반환
  - `PUT`  → 편집본 저장(body UPSERT)
- **`AdminReportsPreview.tsx`**: sessionStorage 제거 → DB 소스. mount=GET, 버튼=POST, 셀편집=PUT

## 데이터 소스 SSOT
- sessionStorage(CACHE_V/TTL/readCache/writeCache) 전면 제거 → `org_weekly_reports`가 단일 소스.

## 배포 순서 (중요)
1. 마이그레이션 적용: `PGPASSWORD=... ./scripts/migrate.sh 149_org_weekly_reports.sql` — **DB 비밀번호 필요 → 사용자 실행**
2. 코드 배포(빌드/푸시) — 마이그레이션 적용 후

## 제외
- 부서 취합(Engine B)은 이미 정상 → 미변경. Dead code `aggregate-stream/route.ts` 정리는 별도.
