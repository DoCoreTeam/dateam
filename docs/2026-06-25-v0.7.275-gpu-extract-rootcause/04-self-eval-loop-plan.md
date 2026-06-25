# AI 자기평가·자기교정 추출 루프 — 갭분석 & 개선기획 (구현 금지)

일자: 2026-06-25 · 분석/기획 전용 · 🟦 DC-ANA(내부 갭) + 🟦 DC-RES(모범패턴)

## 오너 비전 (3축)
1. **포맷 불문** — 어떤 레이아웃이 와도 AI가 분석
2. **재실행** — 틀렸으면 다시
3. **AI 자기평가** — 잘했는지/잘못했는지를 AI가 스스로 판정 (← "충분히 가능한데 부족한 부분")

## 한 줄 결론
지금 추출은 **열린 루프(extract→emit)**. 저장하는 `confidence`는 AI가 *답하면서 같은 호흡에 자기 점수를 매긴 것*이지, **원본을 다시 보고 자기 추출을 심판한 게 아니다.** → 시스템은 스스로 "이거 잘못됐다"를 결론낼 수 없고, 그래서 (잘 만들어진) 재시도 기계가 **항상 사람 손에만** 당겨진다. **부품 80%는 이미 있고, 빠진 건 'AI 심판 패스 1개'와 '루프 배선'뿐.**

## 3축 갭 (코드 증거)

### 축1. 자기평가 — **진짜로 빠진 축**
- `confidence`는 AI 자기점수 맞음(`029_gpu_review_gate.sql:95` 프롬프트, `review/route.ts:464`) — BUT **추출과 동시 1패스 자기신고**, 재검토 아님.
- `overall_confidence`는 코드가 평균낸 값(`review/route.ts:466`), 독립 신호 없음.
- `confidence-gate.ts`는 임계 버킷팅만(≥90 자동/70~90 검토/<70 차단).
- `reconcile.ts`(행수 비교)가 유일한 완성도 신호 — **산수일 뿐 AI판단 아님, 경고만.**
- **critic/self-check/재검토 패스: 코드 전체 grep 0건.** `intake-verify.ts`(휴리스틱 max/min>1.5)는 AI 아님 + USAI 전용 + 기본 OFF.
- → 오너 지적 정확: **"잘했는지 평가하는 패스가 아예 없음."**

### 축2. 재실행 — 기계는 좋은데 트리거가 사람뿐
- ✅ `review/[id]/recheck/route.ts` — **직전 추출+피드백을 되먹여 개선**(`:75-85`), `change_summary` 요구, `review_iterations`에 회차 보존(`:154-166`). **GAN의 'refine'이 이미 구현됨.**
- ⚠️ `quotes/[id]/reanalyze` — 저장값 재정규화(blind re-roll), 제안만.
- ❌ **재실행은 100% 사람 트리거.** `recheck`는 피드백 없으면 400(`:36`). low-confidence·`reconcile.missing>0`·verify플래그로 **자동 발동 안 함.**
- ❌ 유일 자동재시도는 `stream:314` `items.length===0`(아무것도 못 뽑음)일 때만. **부분-오류(흔한 실패)는 재시도 안 함.**

### 축3. 포맷 불문 — 프로덕션엔 구조발견 없음
- 프로덕션(`stream`)은 transcription(무스키마 전사)+단일추출. **AI 레이아웃 구조발견은 USAI `intake-discover`에만**(기본 OFF).
- 못 이해한 포맷 → **무음 부분추출**이 기본 실패모드(`preview` 그냥 emit + soft 경고). "이상하니 다시"로 안 감.

## 개선 설계 — Reflexion형 Actor–Evaluator 폐루프 (🟦 DC-RES 모범패턴)
```
GENERATE 추출(스키마강제 + 필드별 source_cell provenance + confidence)
   ↓
EVALUATE  AI심판: 원본 + 내 추출 대조 → 필드별 PASS/FAIL + 누락목록 (채점 아닌 "검증")
   ↓ 합격 → DONE
   ↓ 불합격 → REFINE: 실패필드만 피드백으로 recheck 재추출
   ↘ 수렴까지(≤2~3회) / no-progress면 중단 / 안되면 사람 에스컬레이션
```
**4대 설계원칙(연구 정립):**
1. **Provenance 강제** — 모든 값이 원본 셀 인용 → 심판이 그 셀 재확인. 환각 최강 차단. (스키마에 `source_cell`·`confidence`·`rationale` 박제)
2. **심판=검증, 채점 금지** — "1~10점"은 자기편향. "필드별 셀 인용+PASS/FAIL." 생성자와 **다른 역할/모델/온도**로 분리.
3. **숫자 자기일관성은 코드로**(LLM 아님) — 월÷730=시간당 등 불변식 불일치만 플래그. **하드코딩 임계 없이 내부 불일치**(USAI가 T4 6.48→0.81 잡은 원리 일반화).
4. **기권 합법화** — 못 grounding하면 `null+low+사유`, `unparseable_regions` 1급 출력. 억지 환각 방지. + **이미지+셀그리드 동시 투입**(2D 구조는 vision, 정확값·provenance는 텍스트).
**가드:** MAX 2~3회 / no-progress 검출(실패필드 안 줄면 중단) / 비용=실패필드만 재추출·심판은 Pro·추출은 Flash 티어라우팅 / 무한루프·자기합리화·스키마환각 주의.

## 부품 인벤토리 — 80% 존재, 미배선
| 루프 부품 | 상태 |
|---|---|
| AI 필드별 confidence | ✅ 있음 |
| 회차 보존+피드백 되먹임 테이블 | ✅ `review_iterations` |
| 피드백 기반 재추출 라우트 | ✅ `recheck`(사람 피드백만 → **AI피드백으로 교체 필요**) |
| 완성도 신호(행 reconcile) | ✅ 있음(경고만) |
| 휴리스틱 자기일관성 | ⚠️ `intake-verify` 있으나 OFF |
| 임계 게이트 | ✅ `confidence-gate` |
| **AI 심판 패스(원본+내출력→검증)** | ❌ **신규 — 0건** |
| **자동 트리거 배선(심판/reconcile/verify→recheck 루프)** | ❌ **신규** |

## 개선항목 (구현 시 — 승인 후)
- I1. **추출 스키마에 provenance/rationale 박제** + Gemini `responseSchema` 강제. (포맷 불문 토대)
- I2. **AI 심판 패스 신설**(별도 역할/모델) — 원본 대비 필드별 PASS/FAIL+누락. ← 가장 핵심·신규.
- I3. **숫자 자기일관성 코드 검증기**(intake-verify를 프로덕션 승격·임계 제거형으로).
- I4. **자동 루프 배선** — 심판 불합격/reconcile.missing/verify플래그 → `recheck` 자동발동(사람 입력 없이), 수렴·캡·에스컬레이션.
- I5. **기권 경로+이미지 동시투입** — unparseable_regions, vision+grid.
- I6. (선행) 회귀 코퍼스+테스트 러너(03 문서 R-2) — 루프 효과 검증 필수.

## 제외
- 구현 전부. 본 문서는 갭분석+설계.
