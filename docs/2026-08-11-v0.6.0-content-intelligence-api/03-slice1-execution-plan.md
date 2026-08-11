# Slice 1 실행 계획 — GRAPH 승격 판정

## 1. 라우팅 판정

| 단계 | Route | 근거 |
|---|---|---|
| v0.5.0/v0.6.0 문서 산출 | **LOOP** | 단일 산출물로 수렴하는 순차 작업. 독립 브랜치·되돌릴 수 없는 효과 없음 |
| Slice 1 구현 | **GRAPH** | 아래 승격 조건 3개 충족 |

DOMANGCHA 불변규칙 "LOOP가 security, destructive action, independent branches, pause/resume 필요를
발견하면 GRAPH로 승격한다"에 따른 판정:

1. **destructive action** — 운영 Supabase에 마이그레이션 7개 적용. 되돌리기 비용이 크다 → HUMAN_GATE.
2. **security** — 플랫폼 OAuth 토큰과 설정 시크릿의 AES-GCM 암호화, RLS 정책 30여 개.
   writer가 유일한 reviewer가 될 수 없다 → 별도 검증 노드.
3. **independent branches** — 스키마/잡 인프라, CI 셸+토큰, 커넥터, 화면 3종이 서로 독립적으로
   진행 가능하고 join 지점이 명확하다.

추가로 Slice 1은 한 세션에 끝나지 않으므로 **pause/resume**이 필요하다 → 체크포인트 필수.

---

## 2. 노드 정의

```
                    ┌─ N2 CI 셸 + 토큰 ─┐
N1 스키마 SQL ─ G1 ─┼─ N3 설정 계층 ────┼─ J1 ─ N6 화면 3종 ─ G2 ─ N8 검증
    (작성)   (승인) ├─ N4 잡 워커 ──────┤       (H01/R01/R04)  (승인)
                    └─ N5 커넥터(YT) ───┘       N7 상세 시트
```

| 노드 | 산출물 | 완료 조건 |
|---|---|---|
| **N1** 스키마 SQL | `supabase/migrations/184~190_ci_*.sql` | 파일 작성 완료, 적용 전 |
| **G1** HUMAN_GATE | 사용자 스키마 리뷰 + 적용 승인 | **운영 DB 변경은 승인 없이 실행 금지** |
| **N2** CI 셸 | `app/(ci)/layout.tsx`, `CiShell`, CI 토큰, 공용 컴포넌트 9종 | `pnpm design:check` 통과 |
| **N3** 설정 계층 | `lib/ci/settings/{registry,resolve,crypto}.ts` + API | 단위 테스트: 스코프 해석 순서, 암호화 왕복, 마스터키 부재 시 저장 거부 |
| **N4** 잡 워커 | `lib/ci/jobs/*`, `/api/ci/internal/worker/tick` | 멱등키 중복 차단·백오프·DLQ 진입 테스트 |
| **N5** 커넥터 | `lib/ci/connectors/youtube.ts` + UCM 정규화 | 회귀 URL 5개 실수집 성공 |
| **J1** join | 잡→콘텐츠 적재 E2E | 링크 투입 → `ci_contents.ingest_status='done'` |
| **N6** 화면 | H01 홈 · R01 수집함 · R04 트렌드(떡상 탭) | 5상태 전부 렌더, 실브라우저 확인 |
| **N7** 상세 시트 | `DetailSheet` + `EvidenceSheet` | 전 화면 단일 컴포넌트로 열림 |
| **G2** HUMAN_GATE | 실화면 검수 | 사용자 확인 |
| **N8** 검증 | tsc · lint · design:check · 단위 · Playwright E2E | 전부 초록 |

Slice 1 범위에서 **제외**(설계서 §8.5 백로그 엄수): 팀 승인 워크플로우, 브라우저 확장, 광고 연동,
제작/게시/성과 화면, YouTube 외 5개 플랫폼 커넥터.

---

## 3. 리스크와 중단 조건

| 조건 | 처리 |
|---|---|
| 마이그레이션 적용 실패 | 해당 파일만 롤백. CI 테이블은 기존 스키마와 FK가 없으므로 사내 업무에 영향 없음 |
| YouTube 쿼터 소진 | N5 중단, `oembed`/`meta_tags` 경로로 계속. 쿼터 회계를 먼저 계측 |
| 마스터 키 미설정 | N3에서 시크릿 저장 거부(설계 의도). 평문 폴백을 만들지 않는다 |
| 자동 확정률 SLO 미달 | Slice 1에서는 측정만. 임계 조정은 실데이터 확보 후 |

## 4. 검증 명령

```bash
cd apps/web && pnpm exec tsc --noEmit
cd apps/web && pnpm lint
pnpm design:check
cd apps/web && pnpm test          # 신규 테스트는 package.json test 목록에 수동 추가 필요
pnpm exec playwright test
```

`pnpm test`는 하드코딩된 파일 목록만 실행한다 — CI 테스트 파일 추가 시 `apps/web/package.json`의
`test` 스크립트에 반드시 append한다(누락 시 조용히 미실행됨).
