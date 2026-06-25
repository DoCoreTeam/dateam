# 통합입력 파싱 관측(Observability) 레이어 — 설계/기획 (구현 금지)

일자: 2026-06-25 · 분석·기획 전용 · 기준 v0.7.274

## 목적
사용자가 통합입력을 실행할 때마다 **(1) 원본이 어땠는지, (2) 어떤 결과를 냈는지, (3) 오류면 왜 났는지**를 DB에 구조화 적재해, 파싱 실패를 **사후 재현·진단**할 수 있게 한다. 앞 진단(01)에서 드러난 "AI는 맞는데 시스템이 무음으로 죽임"을 **눈에 보이는 증거로** 바꾼다.

## 지금 있는 것 vs 빠진 것 (재사용 우선 — 신설 최소화)

| 관심사 | 기존 자산 | 상태 |
|---|---|---|
| 원본 **파일** 보관 | `evidence-store.ts`→Drive, `review_items.evidence_drive_file_id`(mig 127) | ✅ 있음 (재사용) |
| 추출 **성공** 회차 상세 | `review_iterations`(mig 029): extracted/confidence/evidence/prompt_version/ai_model | ✅ 있음 (성공만) |
| 토큰 사용 | `ai_token_logs`(mig 011), `token-logger.ts` fire-and-forget | ✅ 있음 (패턴 재사용) |
| **업로드 1회 = 1 run** 개념 | 없음 — `review_items`는 *항목당*, run 부모 없음 | ❌ **빠짐** |
| **누락/거부/덮어쓴 행** 기록 | 없음 — held/blocked/truncated는 HTTP 응답 카운트로만 반환 후 **소멸** | ❌ **빠짐 (핵심 공백)** |
| 단계별 **변환 추적**(transcribe→…→commit) | 없음 — 어느 단계서 깨졌는지 영속 기록 없음 | ❌ **빠짐** |

→ **핵심 공백**: 앞 진단의 5개 억제 지점(키오염·resolve held·commit drop·slice cut·supplier null)이 **전부 무음**이라 영속 기록이 없다. 이게 "계속 오류 나는데 왜인지 모름"의 구조적 원인.

## 설계 — 신규 2테이블 (telemetry, 추출 흐름과 비차단 분리)

### 테이블 1: `gpu_intake_runs` (업로드/제출 1회 = 1행, 부모)
- `id uuid pk`, `user_id`, `is_test bool`
- `channel`(xlsx/img/pdf/catalog/own/market_link/text)
- `source_filename`, `source_mime`, `source_bytes`, `raw_input_hash`(식별/중복)
- `evidence_drive_file_id`(기존 Drive 원본파일 링크 — **재사용**)
- `raw_grid_snapshot jsonb`(AI에 실제로 보낸 압축 그리드 — **재현용**; 대용량→실패/표본만, 아래 보존정책)
- `prompt_versions jsonb`, `ai_models jsonb`
- `status`(running/succeeded/partial/failed)
- `counts jsonb` = {source_rows, transcribed, extracted, resolved, held, blocked, confirmed}
- `error_code`, `error_summary`
- `started_at`, `finished_at`, `duration_ms`, `created_at`
- RLS: admin 전용 조회(원본에 이메일·연락처 PII 포함 가능). `is_test` 격리.

### 테이블 2: `gpu_intake_events` (행 × 단계 = 1행, 자식)
- `id uuid pk`, `run_id → gpu_intake_runs(id) on delete cascade`
- `row_ref`(원본 좌표 예 `sheet1!C92`), `stage`(upload/grid_compress/transcribe/classify/extract/normalize_money/canonical_model/resolve_product/gate_confidence/gate_validate/dedup/commit)
- `status`(ok/warn/held/dropped/overwritten/error)
- `input_snapshot jsonb`(단계 진입값), `output_snapshot jsonb`(단계 산출값)
- `reason_code`(model_unresolved/unparseable_price/no_price_blocked/slice_truncated/key_mangled/supplier_missing/dup_merged …)
- `reason_detail text`, `created_at`
- 인덱스: `(run_id,status)`, `(reason_code)`, `(created_at)`

→ 이 두 테이블이 사용자 요구를 그대로 충족:
- **원본이 어땠나** = `raw_grid_snapshot` + 각 event `input_snapshot`
- **결과를 어떻게 냈나** = `counts` + event `output_snapshot`
- **왜 오류** = 정확한 `stage` + `reason_code` + `reason_detail` (예: `canonical_model` 단계서 `key_mangled`: `"H200 141GB." → "h200."`, 이어 `resolve_product` 단계 `held: model_unresolved`)

## 계측 지점 (앞 진단 5개 억제 지점 = 이벤트 발신처)
| 지점(파일) | emit |
|---|---|
| `canonical-model.ts`(키 생성) | `overwritten/key_mangled` (입력 모델명→키) |
| `resolve-product.ts:50`(held) | `held/model_unresolved` |
| `validate.ts:51`(commit 무가격 차단) | `dropped/no_price_blocked` |
| commit `.slice(0,50)` | `dropped/slice_truncated` (잘린 개수) |
| `catalog/route.ts:115`(supplier null) | `warn/supplier_missing` |
| `normalize-money`(X/확인중/Custom→null) | `warn/unparseable_price` (정상 라우팅이지만 기록) |

## 설계 원칙 (반드시)
1. **비차단(fire-and-forget)** — `token-logger.ts` 패턴 그대로. 로깅 실패가 추출을 절대 막지 않음(추출 흐름 우선).
2. **SSOT 단일 발신기** — `lib/gpu/intake-telemetry.ts` 1개 모듈(`startRun/emit/finishRun`)을 만들어 모든 경로(stream/commit/catalog)가 import. 각 라우트에 insert 복붙 금지.
3. **보존정책(볼륨·PII)** — 성공 run은 `counts`+표본만, **실패/부분(partial)은 full event 트레이스**. `raw_grid_snapshot`은 실패 시에만 보관 권장. TTL(예: 90일) 후 스냅샷 비우기(메타·카운트는 유지). Drive 원본은 기존 정책 따름.
4. **보안** — RLS admin-only, service-role 적재(클라 직삽 금지), 원본 PII(이메일/연락처) 마스킹 옵션 검토.
5. **조회 UI** — 콕핏/리뷰 화면에 "입력 이력" 탭: run 리스트(검색·정렬·필터·서버페이지네이션) → run 상세(원본·counts·event 타임라인). reason_code 집계 대시보드(어떤 오류가 제일 잦은지)로 **다음 수정 우선순위 자동 도출**.

## Feature Defaults (신규 엔티티 → 완료기준 박제)
- [ ] gpu_intake_runs/events CRUD(생성=적재, 조회=이력, 삭제=TTL 소프트), 각 연산 admin 권한
- [ ] List 화면 + RLS(admin·is_test 격리, default-deny)
- [ ] 검색(파일명/사용자/reason_code)·정렬(시각/오류수)·필터(status/channel/reason_code) 화이트리스트
- [ ] 서버 페이지네이션(page/limit)+메타
- [ ] URL 상태 동기화 + 로딩/빈/에러 3종 UI

## 결정 확정 (사용자 2026-06-25)
- D1. 보존 = **전부 full** — 성공 run도 단계별 full 트레이스 적재. ⚠️볼륨 증가 → TTL(90일 후 event/스냅샷 정리, run 요약은 유지)로 통제 권장.
- D2. `raw_grid_snapshot` 저장 = **항상 Drive JSON** — 기존 `evidence-store.ts`/`google-drive.ts` 패턴 재사용, DB엔 Drive fileId만. (DB 용량 절약, 조회 1홉)
- D3. 계측 범위 = **프로덕션 경로만(stream/commit)** 1차. USAI/catalog는 후속.
- D4. PII = **원본 그대로 + RLS admin-only**. 마스킹 안 함 → ⚠️담당자 이메일/연락처가 스냅샷·Drive JSON에 평문 보관됨. RLS default-deny + service-role 적재 + Drive 폴더 권한이 유일 통제선이므로 **이 3중 보호 누락 시 PII 노출** — DC-SEC 검토 필수 항목으로 박제.

## 제외(이번 범위 아님)
- 추출 로직 자체 수정(F1~F5는 별건) — 본 건은 **관측만**. 단, 관측이 깔리면 F1~F5 효과를 데이터로 검증 가능.
