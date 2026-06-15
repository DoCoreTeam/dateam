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
**재개 한 줄 요약**: `docs/2026-06-15-daily-ai-feedback-loop/03-phasing-risks.md`의 결정 4개 답 → **Slice 2(집계)부터** 착수.
