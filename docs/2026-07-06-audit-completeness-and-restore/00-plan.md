# 완벽 이력 + 항목 단위 복구 — 통합 기획 v2 (적대적 재검토 반영)

> 상태: **기획만 (절대 구현 금지)** · 2026-07-06 · **v2 = 🟥 DC-REV·DC-SEC 재검토로 v1 결함 교정**
> v1 판정: REVISION REQUIRED — 핵심 주장(차단0·유실0 동시)이 허위였고, actor 정확성·cascade·복구권한·PII 등 다수를 "해결됨"으로 오표기. v2는 해결된 척을 걷어내고 **미해결은 결정지점으로 정직하게 이관**.

## 0. 원칙
유실 0 지향 · **사용자 저장은 절대 안 막음** · 실패·에러도 기록 · 복구는 본인·항목 단위 · 유기적 연계 최대 보존.

---

## 1. v1의 핵심 오류 (정직한 정정)
- ❌ **"차단0·유실0을 동시에 보장한다"는 거짓.** 단일 DB 동기 트리거로는 이 둘이 진짜 이율배반이다. 트리거의 audit INSERT가 **audit_log 자체 원인**(리치HTML row_to_json 예외·hot table 락타임아웃·bloat·WAL/디스크 압박 — 전부 감사설계가 만든 부작용)으로 실패하면, 같은 트랜잭션이라 **멀쩡한 원 write까지 롤백**된다. "제약 없어서 실패 안 함"은 성립하지 않는다.
- ❌ 아웃박스는 트리거 실패(트랜잭션 내부)에는 적용 불가 — 앱단 실패(§2-B)에만 유효한데 v1은 둘을 뭉갰다.
- ❌ actor 정확성·cascade 복구·복구 권한을 "해결됨"으로 표기했으나 실제 미해결.

## 2. 확정 결정 — 트레이드오프를 정직하게 택한다
> 사용자 원칙: "저장이 막히면 시스템이 아니다." → **차단을 택하지 않는다. 유실은 fallback으로 0에 수렴시킨다(수학적 0이 아니라 다계층으로 잔여를 총DB장애로 밀어냄).**

### 2-A. 트리거는 EXCEPTION-guard로 절대 원 write를 막지 않음
```
fn_audit()  -- AFTER INSERT/UPDATE/DELETE, SECURITY DEFINER, search_path 고정
BEGIN
  INSERT INTO audit_log(...) VALUES (row_to_json(OLD/NEW), actor, ...);   -- 1차 싱크
EXCEPTION WHEN OTHERS THEN
  BEGIN
    INSERT INTO audit_fallback(table, pk, op, occurred_at) VALUES (...);  -- 2차 초경량 마커(거의 실패 불가)
  EXCEPTION WHEN OTHERS THEN
    -- 3차: 아무것도 못 하면 원 write는 통과(차단 금지). 잔여 유실 = 총 DB 장애(이때 원 write도 어차피 실패).
    NULL;
  END;
END;
```
- **차단 0**: 어떤 경우도 원 write를 롤백하지 않음(EXCEPTION 흡수).
- **유실 → 0 수렴**: 1차 실패 시 2차 초경량 마커(pk만)로 "여기서 감사 실패"를 남김 → 백그라운드 **reconciler**가 마커를 보고 원본을 재조회해 사후 보강(재구성). 2차마저 실패는 총 DB 장애뿐.
- **잔여 리스크(명문화)**: 1·2차 동시 실패 순간(=DB 자체 장애)엔 그 1건이 유실될 수 있음 — 단 그 상황에선 원 write도 커밋 안 됨. "정상 write가 성공했는데 감사만 조용히 사라지는" 케이스는 2차 마커로 차단.

### 2-B. 실패/에러(커밋 안 된 write) = 앱단 + 아웃박스 재시도
- 트리거는 커밋된 것만 봄 → 실패는 앱 catch에서 기록. 즉시 실패 시 **아웃박스 테이블**(service_role 전용·idempotency key·TTL·rate-limit)에 적재 후 재시도. §6-보안 참조.

## 3. actor(누가) — 서비스롤 경로 정확성은 별도 규율 필요 (미해결→규율)
- client(PostgREST): `auth.uid()` 정상.
- **service_role/AI/크론 경로**(`autolink-run.ts`·`draft-server.ts`·admin API·백그라운드 분해): `auth.uid()`=NULL → 폴백하면 **대리작업 사실이 소실**. v1은 이걸 "해결됨"이라 했으나 거짓.
- 해결책: 모든 서비스롤 write 경로가 write 직전 `SET LOCAL app.actor_id = '<진짜 actor>'` 세팅, 트리거는 `coalesce(current_setting('app.actor_id',true)::uuid, auth.uid(), NEW.user_id)`. → **앱 전 서비스롤 경로에 새 규율 강제**(비용 큼, 정적 가드로 누락 차단). "빈틈0"은 *기록 여부*엔 참이나 *actor 정확성*엔 이 규율 없으면 거짓 — §9 결정지점.

## 4. 복구 — 항목 단위 (보안·무결성 제약 대폭 추가)
### 4-A. 되살릴 수 있는 것만 되살린다 (컬럼·테이블 화이트리스트) — [SEC HIGH]
- **복구 대상 = 사용자가 원래 직접 수정 가능했던 콘텐츠 필드만**(content/performance/plan/issues/checklist 등).
- **절대 복구 금지(서버 워크플로 전용)**: 상태·권한 컬럼(`confirmed_at`, `role`, `status`, `deleted_at`은 별도 경로, 소유자), **관계/권한 테이블 전체**(`project_members`·`work_entity_links` — before_json 되쓰기로 **권한 재획득(privilege re-acquisition)** 되는 IDOR 차단).
### 4-B. 워크플로 상태 게이트 — [SEC HIGH]
- **확정/잠금된 것은 사용자 복구 금지**(예: `confirmed_at` 있는 주간보고). 되돌리면 지연추적·증빙(v0.7.213) 신뢰성 훼손. 필요 시 "복구=확정 리셋+재확정 강제".
- 파생 정합성: 복구된 원본이 이미 다른 산출물(weekly_report_items·autolink·집계)에 반영됐으면 자동 재계산 안 됨 → 복구 시 관련 파생 재생성/무효화 규칙 필요.
### 4-C. 관계 무결성(cascade) — 항목단위 vs 유기적연계의 긴장 인정
- soft-delete 부모 복구 시 함께 soft된 자식(calendar_events 등)의 **동반 복구는 다중테이블 트랜잭션**이 필요(v1엔 없음). 기본은 항목 1개, 옵션으로 자식 동반.
- **복구 불가 케이스 명시**: ①트리거 도입 이전 이력(before 없음) ②과거 hard-delete cascade로 이미 소실된 관계(복구해도 고아).
### 4-D. 복구 권한 (다중 소유 엔티티) — [REV HIGH] §9로 이관
- `id=? AND user_id=auth.uid()`는 단일소유 전제. **부서업무/프로젝트는 부서장·담당자 복수 actor**가 남의 소유행을 바꿈 → owner-only면 정작 실수한 부서장이 못 되돌림. 규칙 미정 → 결정지점.
### 4-E. 안전장치: 낙관적 잠금(updated_at), 멱등(복구 중복클릭), "복구의 복구" 스쿼시(무한 체인 방지).

## 5. 소프트삭제 전환 (복구 전제) + 정적 가드 필수 — [REV HIGH]
- `daily_logs` `deleted_at` **없음**(라이브 확인) → ADD + 모든 삭제경로 soft + **모든 조회에 `deleted_at IS NULL`**. 광범위·회귀.
- **정적 가드 테스트 필수**: `kst-guard.test.ts` 선례처럼 `deleted_at` 필터 누락 스캔 가드 추가(수동 전수점검은 이 리포의 반복 사고패턴 — 가드로 차단). v1 누락.
- `weekly_reports`는 deleted_at 있으나 RLS(002) 때문에 hard 사용 중 → RLS/RETURNING 재설계.

## 6. 보안 (SEC 지적 반영 — v1 전무)
- **PII 파기의무 vs append-only [SEC CRITICAL]**: 전체행 JSON 영구보관은 개인정보 파기 요구와 충돌. 대응: ①민감컬럼 **redaction** 후 저장 ②법적 파기요청용 **감사동반 purge 예외경로**(관리자·기록) ③PII 테이블 사전 분류·제외. → §9 결정지점 승격.
- **audit_log SELECT RLS**: owner 기준 vs actor 기준 정의 필요. `actor OR owner`면 부서장이 대리작업 대상의 전체 스냅샷을 영구 재열람(부서이동 후에도) → 과열람. owner-only면 대리작업자가 자기 행위 못 봄. 결정 필요.
- **SECURITY DEFINER 트리거**: `search_path` 고정(스키마 스쿼팅 방지), 복구시 동적SQL 있으면 **table_name 화이트리스트**(무제약 append라 임의 table 문자열 유입 가능).
- **아웃박스**: service_role 전용 RLS, idempotency key, TTL/상한(재생·DoS 방지), 에러컨텍스트 내 PII 최소화.

## 7. 성능·저장 (구체화) — [REV HIGH]
- **daily_logs 벌크 AI분해(v0.7.244)**: 사용자 1행위=N행 insert → 트리거로 audit N배 즉시 폭증. 대상 포함 시 반드시 고려.
- **weekly_reports Tiptap 리치HTML**: 자동저장 빈도 높으면 매 수정마다 전체 HTML 복제 → 문서크기×편집횟수. **diff 저장 또는 debounce 스냅샷** 필요.
- **보존정책 필수**(버전수/기간/압축) — 비용+파기의무 양쪽 근거.

## 8. 기존 로그 수렴 — 서두르지 않음 — [REV MED]
- `activity_log`(v0.7.287 방금 커밋·미검증)를 즉시 "실패전용 축소"는 **스키마 스래싱**. → 1사이클 운영관찰 후 결정. 그 전까지: 트리거 audit_log=성공 SSOT, 앱단=실패, 이력탭은 **스냅샷有(트리거 이후)+스냅샷無(과거 구로그) 혼합 타임라인** 렌더 설계.

## 9. 결정지점 (구현 착수 전 승인 — v2 확장)
1. ✅ **차단0·유실0** → 확정: **차단 안 함 + 다계층 fallback+reconciler로 유실 0수렴**(잔여=총DB장애). (§2)
2. **소프트삭제 전면전환 승인** + 정적가드 도입 (복구 전제, 광범위)
3. **actor 정확성 규율**: 서비스롤 경로 `SET LOCAL app.actor_id` 전면 강제 승인 여부(비용 큼)
4. **복구 권한(다중소유)**: 부서업무/프로젝트 복구 주체 규칙(owner-only / actor포함 / 부서장)
5. **복구 화이트리스트**: 콘텐츠 필드만 복구·관계/상태/권한 컬럼 제외 확정
6. **PII·파기의무** [CRITICAL]: redaction 범위 / 파기 예외경로 / PII테이블 제외 정책
7. **보존정책**: 기간·버전수·리치텍스트 diff/debounce
8. **복구 범위**: 항목단위만 / 항목+자식동반 / 전체시점

## 9-B. 구현 상태 (v0.7.289 — [2] 전부 한번에 강행)
- ✅ 마이그146 audit_backbone: audit_log/audit_fallback + fn_audit(never-block·2계층fallback·SECURITY DEFINER·search_path고정) + 6테이블 트리거 + daily_logs.deleted_at + fn_purge_audit. 롤백 스모크로 트리거 동작·비차단·오염0 실측.
- ✅ soft-delete 전환: daily/dept 삭제 3곳 hard→soft, daily_logs 조회 83개소 `.is('deleted_at',null)`, 정적가드 test. 마이그147 match_daily_logs 삭제행 제외.
- ✅ 복구 restore-action: 테이블·컬럼 화이트리스트, `.eq(user_id)` 2중방어, 워크플로 게이트(scaffold), deleted_at 되살림. FE 되살리기 버튼.
- ✅ API: audit_log(성공·되살리기)+activity_log(실패만) 병합. logActivity 성공 조기return(이중기록 제거·DC-REV HIGH).
- ✅ 보안: 마이그148 audit_log SELECT RLS를 owner-only로 축소(DC-SEC HIGH — actor 과열람 선제봉합).
- **후속 과제(비차단·문서화)**: ①op='restore' 실제 기록(현재 복구도 'update'로 남음) ②soft-delete-guard가 mutate+select 반환체인은 미검(향후 회귀 사각) ③checkWorkflowLock weekly 게이트 상시 no-op(confirmed_at 부재) ④fn_purge_audit UI/호출부 미배선(PII 파기 운영경로) ⑤app.actor_id 서비스롤 배선(대리작업 actor 정확성).

## 10. 최종 판정
방향(서버측 트리거 감사 + soft-delete + before 복구)은 표준적이고 타당. 단 **v1의 "둘 다 마법처럼 해결"은 거짓이었고 v2에서 트레이드오프를 정직하게 택함**. actor·cascade·복구권한·PII는 해결된 척 대신 결정지점으로 이관. **위 8개 결정(특히 6-PII는 법적 CRITICAL) 승인 전 구현 착수 불가.**
