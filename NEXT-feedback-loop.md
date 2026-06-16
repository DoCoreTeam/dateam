# ▶ NEXT: 일일업무 AI 피드백-학습 루프 — 이어서 진행 (재개 핸드오프)

> **재개 예정일: 2026-06-29(월) 경** (신호 데이터 2~4주 축적 후). 작성: 2026-06-15.
> 이 파일 하나만 보면 어디서 이어갈지 알 수 있게 정리함.

---

## 0. 지금 어디까지 됐나 (2026-06-15 기준)
- ✅ **Slice 1 — 신호 수집 완료** (커밋 `v0.7.138`).
  - DB: `supabase/migrations/100_ai_feedback_signals.sql` **적용·추적 등록 완료**(본인 RLS, append-only).
  - 수집 중인 신호: 삭제→`reject` / 수정→`correct_content|type|date` / 캘린더취소→`schedule_reject` (전부 AI 항목·best-effort).
- ⏳ **Slice 2~4 미착수** → 이번에 할 일.

## 1. 기획 문서 위치 (먼저 읽기)
```
docs/2026-06-15-daily-ai-feedback-loop/
├── 00-summary.md            # 전체 개요 + 현실적 "학습" 정의
├── 01-signal-schema.md      # 수집 신호 정의 + ai_feedback_signals 스키마 (Slice1에서 구현됨)
├── 02-feedback-mechanism.md # ★ Slice 3 핵심: 집계→되먹임 3경로(A 프롬프트/B 후처리/C 임계)
└── 03-phasing-risks.md      # ★ MVP 슬라이스 + 리스크 + 결정 필요사항
```

## 2. 다음 단계 (순서대로)
### Slice 2 — 집계/가시화
- `ai_feedback_signals` → 사용자별 `correction_profile`(거부율·교정쌍 빈도·일정 오탐율) 산출(순수함수 + 단위테스트).
- (선택) 어드민 대시보드: 추세. **PII 마스킹 + service_role/SECURITY DEFINER 경유 필수**(아래 보안).
- `accept` 신호: 저장 후 24h 미수정→accept 배치로 잡을지 결정(03 문서 결정사항 ①).

### Slice 3 — 프롬프트 되먹임 (경로 A) ★ 핵심 가치
- `analyze-work` 프롬프트(DB `ai_prompts`)에 **`{USER_CORRECTIONS}` 변수 신설** — 개인 교정 규칙 3~5 + few-shot 2~3 주입.
- **피처 플래그 + held→검증→활성** (`daily-prompt-governance.ts` 안전패턴 재사용, 전역 자동활성 금지).

### Slice 4 — 결정론 후처리 + 임계 보정 (경로 B·C)
- `lib/daily/feedback-rules.ts`(SSOT, 단위테스트): 과분해 억제 / 일정 자동등록 임계 동적화(오탐율↑→보류).

## 3. 손댈 파일 (앵커)
| 목적 | 파일 |
|---|---|
| 신호 헬퍼·diff(이미 있음) | `apps/web/lib/daily/feedback-signals.ts` (+ `.test.ts`) |
| 수집 훅(이미 있음) | `apps/web/app/(member)/daily/actions.ts`(delete/update/status), `apps/web/app/(member)/calendar/actions.ts`(unlink) |
| 집계(신규 Slice2) | `apps/web/lib/daily/correction-profile.ts`(신규) + 어드민 라우트 |
| 프롬프트 되먹임(Slice3) | `apps/web/app/api/ai/analyze-work/route.ts` + DB `ai_prompts`('daily.analyze-work') + `apps/web/lib/daily-prompt-governance.ts` |
| 후처리(Slice4) | `apps/web/lib/daily/feedback-rules.ts`(신규) |

## 4. 결정 필요사항 (재개 시 먼저 답하기 — 03 문서)
1. `accept` 신호: 24h-배치로 잡을지 / 명시신호(삭제·수정·취소)만 쓸지
2. 전역 익명 패턴도 활용할지 / 개인화만
3. 되먹임 범위: 경로 A(프롬프트)만 먼저 vs A+B+C
4. 착수: Slice 2(집계)부터 권장

## 5. 보안 전제 (DC-SEC 권고 — Slice2에서 반드시)
- `original_input`/`before`/`after`에 PII(거래처·연락처·금액) 포함 가능 → **admin 집계 노출 시 마스킹/요약화**.
- 전역 집계는 **service_role / SECURITY DEFINER 함수 경유** (anon SELECT 확장 절대 금지). 현재 RLS는 본인 select/insert만.

## 6. 데이터 쌓였는지 확인하는 법 (재개 직전)
```bash
# migrate.sh와 동일 연결. 비번은 메모리(@ 1개 주의).
PGPASSWORD='<비번>' /opt/homebrew/bin/psql -h aws-1-ap-northeast-2.pooler.supabase.com -p 6543 \
  -U postgres.tsnlplkslfcwtchzdaai -d postgres \
  -c "select signal_type, count(*) from ai_feedback_signals group by 1 order by 2 desc;"
```
신호가 충분히(예: 사용자당 ≥20건) 쌓였으면 Slice 2 착수, 부족하면 더 기다림.

## 7. 같이 검토할 잔여 메모 (이번 세션 발견)
- (참고) 즉시저장+AI자동셋팅(`v0.7.136`)·블로커 제거(`v0.7.137`) 완료됨.
- `prompt_version`은 현재 daily_logs에 없어 신호에 null로 들어감 → Slice2/3에서 버전별 회귀분석 하려면 origin batch에서 끌어와 채우는 보강 고려.
- 병렬 세션 동시 커밋 이력 있었음 → 재개 시 `git log`로 현재 버전 확인 후 +1.

---

## 8. ▶ 같이 재개: 업무 AI 완전 자동 연관 연결 — 후속 권장 (별개 기능, v0.7.140~142 구현 완료)

> 이 기능은 **이미 구현·운영 적용됨** (커밋 v0.7.140 본체 / v0.7.141 보안 / v0.7.142 성능).
> 업무 저장/플로우 열람 시 AI가 무개입으로 과거 업무·거래처·딜·연락처와 연관을 자동 연결(가역·근거·신뢰도).
> 기획: `docs/2026-06-15-work-ai-autolink-plan/` (00~05, 05=지속학습).
> **아래는 "데이터가 쌓인 뒤(2주 후경)" 해야 할 후속** — feedback-loop 재개와 함께 처리 권장.

### 후속 A — 거래처/딜 자동연결 정확도 입증 후 HIGH 자동확정 활성 ★
- 현재 거래처/딜/연락처 자동연결은 **데이터가 적어(딜1·연락처1) 거의 안 뜸**. 경로는 구현·작동(콜드스타트).
- 데이터 쌓이면: golden-set(라벨 50~100쌍) → **Precision@HIGH ≥ 0.92 입증** → `lib/work/autolink.ts`의 entity 가드(`entityHighAllowed`)를 신뢰. 미입증이면 MID(추천)로 유지.
- 손댈 곳: `autolink_config.thresholds`(DB, 종류별 τ) · `lib/work/autolink.ts`(decideLinks/entityHighAllowed).

### 후속 B — 양방향 뷰 (거래처/딜 상세 → "관련 업무")
- 현재는 업무→데이터 단방향(업무 플로우 패널)만. 거래처/딜 상세화면에서 `work_entity_links` 역조회로 "이 거래처 관련 업무" 노출.
- 손댈 곳: accounts/deals 상세 컴포넌트 + `work_entity_links` GET(entity_id 기준).

### 후속 C — 성능 스케일 대비 (데이터 증가 시)
- 엔티티 후보는 현재 추출이름별 `ilike` 좁힘조회(소규모 OK). 수천건+면 **pg_trgm `similarity()` RPC**(`match_entity_by_name`)로 교체.
- `recomputeThresholds`(임계 자가보정)는 현재 unlink마다 비동기 호출. 트래픽 늘면 **디바운스/크론**으로.
- 임베딩 백필은 `apps/web/scripts/backfill-autolink-embeddings.mjs`(일회성). 신규 거래처/딜/연락처 생성 시 **임베딩 큐잉 훅** 추가 검토(현재 백필 안 하면 autolink가 신규 엔티티 미인지).

### 후속 D — 학습 강화 (feedback-loop와 공유 가능)
- L2 별칭(`autolink_alias`)을 judge뿐 아니라 **extract 프롬프트에도 주입**(현재 judge만 — 정확도 여지).
- autolink_feedback(해제=오답) ↔ ai_feedback_signals 와 **학습 신호 통합** 검토(둘 다 "AI 결과 정정" 신호).

### 손댈 파일 (autolink 앵커)
| 목적 | 파일 |
|---|---|
| 순수 규칙(밴드/임계/가드) | `apps/web/lib/work/autolink.ts` (+`.test.ts`) |
| 파이프라인(리콜→판정→삽입) | `apps/web/lib/work/autolink-run.ts` |
| 학습(L1 임계·L2 별칭/fewshot) | `apps/web/lib/work/autolink-learn.ts` |
| API(run/unlink/GET) | `apps/web/app/api/work/autolink/route.ts` |
| UI(자동표시·해제) | `apps/web/app/(member)/daily/AutolinkSection.tsx` |
| DB | `supabase/migrations/101~103` (임베딩·관계메타·work_entity_links·feedback/alias/config·RPC·보안·실행마커) |

### 데이터 쌓였는지 확인 (autolink 재개 직전)
```bash
PGPASSWORD='<비번>' /opt/homebrew/bin/psql -h aws-1-ap-northeast-2.pooler.supabase.com -p 6543 \
  -U postgres.tsnlplkslfcwtchzdaai -d postgres \
  -c "select target_kind, action, count(*) from autolink_feedback group by 1,2 order by 1,2;"
# 거래처/딜/연락처 entity 연결이 충분히(예: 종류당 ≥30 auto_created) 쌓였으면 후속 A(정확도 입증) 착수.
```

---
**재개 한 줄 요약**: (1) `docs/2026-06-15-daily-ai-feedback-loop/03-phasing-risks.md` 결정 4개 답 → **Slice 2(집계)부터**. (2) autolink는 **후속 A(거래처/딜 정확도 입증→HIGH 자동확정)** 부터 — 둘 다 "AI 정정 신호가 쌓인 뒤" 작업이라 같이 재개.
