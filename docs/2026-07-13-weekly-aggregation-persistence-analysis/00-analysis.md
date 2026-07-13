# 주간보고 취합본 DB 미저장 — 원인 분석 보고서

- 접수일: 2026-07-13 / 성격: **분석 전용 (구현·수정 없음 — "절대 구현하지마")**
- 분석: 🟦 DC-ANA → CEO 코드 검증(preview route 영속 부재 확인)

---

## 결론 (근본원인 — 확신도 98%)

주간보고 취합에는 **취합 엔진이 2개 병존**하는데, 그중 **전체 조직 취합(Engine A)만 DB에 저장하지 않는다.**

| 엔진 | 경로 | DB 저장 | 상태 |
|------|------|:---:|------|
| **A. 전체/개인 취합** | `AdminReportsPreview` → `GET /api/reports/preview` | ❌ (sessionStorage만) | **문제 경로** |
| B. 부서 취합 | `DeptReportPanel` → `aggregateDept()` 서버액션 | ✅ `dept_weekly_reports` UPSERT | 정상 |
| C. `POST /api/reports/aggregate-stream` | (UPSERT 코드 있음) | — | Dead code(호출처 없음) |

**분류: "전용 테이블 부재 + 저장 로직 부재".** 전체 조직 AI 취합 결과를 담을 DB 테이블이 스키마에 없고, Engine A 코드에 INSERT/UPSERT 자체가 없다.
→ 취합본은 브라우저 `sessionStorage`(TTL 24h)에만 남아, **탭/세션이 바뀌면 소멸 → 매번 재취합(=Gemini 재호출)**.

> 코드 주석/문서 교차확인: `docs/2026-06-29-v0.7.278-aggregation-unify/00-summary.md`에 "전체조직 취합본 영구 저장소 신설은 **별도 스프린트**", "엔진 C — 호출처 없음(dead code)"로 이미 명시됨.

---

## 재취합이 강제되는 정확한 지점 (검증 완료)

`apps/web/app/api/reports/preview/route.ts:95-107`
```ts
const merged = await mergeAndRefineByCategory(forMerge, apiKey, model, user.id, ctx) // Gemini 호출
const reports = merged.map((r) => ({ ... }))
return NextResponse.json({ reports })   // ← DB 저장 없이 JSON 반환만. persist 부재.
```
- 이 라우트의 유일한 DB 쓰기는 없음. (READ는 지난주 구분 컨텍스트 조회용 `dept_weekly_reports.select` 뿐)
- 클라이언트 `AdminReportsPreview.tsx`의 `writeCache()`는 `sessionStorage`(CACHE_V=5, TTL 24h)에만 기록 → 세션 밖 효력 없음.

---

## 데이터 흐름 대비

### Engine B (부서 취합 — 정상: 저장→복원)
```
버튼 DeptReportPanel:83 → aggregateDept()(org-actions.ts:72)
  → weekly_reports SELECT → Gemini mergeAndRefineByCategory
  → UPSERT dept_weekly_reports (onConflict: department_id,week_start) [org-actions.ts:141]
  → page.tsx:202 재조회 시 initialBody로 복원  ∴ 재취합 불필요
```

### Engine A (전체 조직 — 문제: 계산만, 미저장)
```
버튼 AdminReportsPreview:136 → GET /api/reports/preview
  → weekly_reports SELECT → Gemini mergeAndRefineByCategory
  → JSON 반환(route.ts:107)  ※ DB 저장 없음
  → writeCache() = sessionStorage only  ∴ 세션 소멸 시 매번 재취합
```

---

## 부가 발견 — AI 재호출 캐시 부재 (토큰 낭비)
Engine B조차 `org-actions.ts:140`에서 `source_hash`를 **기록만** 하고, Gemini 호출 **전에 hash를 비교해 재호출을 생략하는 로직이 없다**. 원본 변경이 없어도 "재취합" 버튼을 누르면 매번 토큰 소모.

## 영향 범위
| 스코프 | 재취합 강제 |
|--------|-------------|
| 부서 취합(멤버/어드민) | ❌ 없음 (저장됨) |
| **전체 조직 취합(어드민 전체/개인)** | ✅ **매 세션마다** |
| 팀 탭 | 해당 없음 (AI 취합 안 함) |

---

## 수정 방향 권고 (구현하지 않음 — 방향만)
1. **(근본) 전체 조직 취합 저장소 신설**: `org_weekly_reports`(또는 `dept_weekly_reports`를 `department_id NULL` + `scope_key`로 확장) 테이블 + `unique(week_start, scope_key)`. `preview` 경로(또는 신설 서버액션)에서 UPSERT, 조회 시 저장본 우선 read, AI는 "없음/source_hash 불일치"일 때만 재호출.
2. **(비용) source_hash 기반 재호출 생략**을 Engine A·B 공통 적용.
3. **(정합) sessionStorage 편집분 보존**: Engine A는 셀 편집도 `writeCache`로 캐시하므로, DB 저장 도입 시 편집 내용까지 persist해야 손실 없음.
4. Dead code `aggregate-stream/route.ts` 정리 여부 별도 판단.

> 코드는 일절 수정하지 않았다. RLS 필수(default-deny), 신규 테이블 도입 시 CRUD/List/권한은 CEO Feature Defaults 적용 대상 — 구현 승인 시 DOC-FIRST부터 진행.
