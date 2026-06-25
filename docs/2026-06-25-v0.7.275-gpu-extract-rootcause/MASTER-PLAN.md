# 🎯 MASTER PLAN — GPU 통합입력 추출 시스템 초정밀 고도화

> **단일 SSOT 기획서.** 2026-06-25, 6턴 진단·정정·설계(문서 00~05)의 통합본. 기준 v0.7.274.
> **상태: 기획 전용 — 구현/커밋/배포 미수행.** 착수 승인 시 단계별 파이프라인 진입.

---

## 0. 한 장 요약 (Executive Summary)

**문제:** GPU 견적 통합입력의 파싱 오류가 버전을 거듭해도 재발한다(v0.7.240~273 정규화/dedup 땜질 12+회).

**진짜 원인 (한 문장):** **AI 분석은 거의 항상 맞지만, 추출 파이프라인에 ② "스키마 기반 AI 구조화"와 ③ "사용자 능동 검수(CRUD)" 책무가 비어 있어, 그 빈자리를 깨지는 결정론 코드와 사람이 수동으로 메워왔다.** 그래서 모든 "수정"은 AI가 이미 성공한 지점의 하류를 땜질해 안 붙고 재발한다.

**해법 (한 문장):** 추출을 **[분석]→[AI 스키마 구조화/conformance]→[자기평가 루프]→[사용자 CRUD 검수]** 의 닫힌 파이프라인으로 재구성하고, 모든 단계를 **관측(telemetry)+회귀코퍼스**로 검증가능하게 만든다.

**좋은 소식:** 필요한 부품의 ~80%가 이미 코드에 있고 **루프로 안 엮여 있을 뿐**이다(override_extracted·review_iterations·recheck·intake-verify·confidence·카탈로그·responseSchema 미사용).

---

## 1. 책무 모델 — 잃어버린 고리

추출은 4개 책무인데 ②③이 비어 있었다:

| 책무 | 내용 | 현황 |
|---|---|---|
| **① 분석 (Analyze)** | 문서→값 | ✅ AI가 잘함 |
| **② 구조화 (Conform)** | admin 스키마·카탈로그를 AI가 보고 자기분석을 그 구조에 바인딩 | ❌ **빠짐** — 깨지는 결정론 코드가 단독 심판 |
| **③ 자기평가 (Evaluate)** | AI가 원본 대비 자기 추출을 심판→틀리면 재시도 | ❌ **빠짐** — 열린 루프, 자기신고 confidence뿐 |
| **④ 검수 (Govern/CRUD)** | 사용자가 결과 능동 편집·추가·삭제 | ❌ 커밋전 비어있음(accept/reject뿐), 커밋후만 완비 |

목표 아키텍처:
```
[1 분석]  문서→값 (AI, 출처cell provenance)
   ↓
[2 구조화] admin 스키마+카탈로그 → AI 바인딩·conform (responseSchema 강제)   ← 신규
   ↓
[3 자기평가] AI 심판(원본 대조·필드별 PASS/FAIL·누락) → 불합격시 실패필드만 재추출 (≤2~3회 수렴)   ← 신규
   ↓
[4 검수]  사용자 인라인 CRUD(편집·누락행추가·삭제) + accept   ← UI 갭 메움
   ↓
[저장]   결정론 코드는 "심판"이 아니라 "빠른 통과로"로 강등
   ⟂  [관측 telemetry] 전 단계 입력·변환·실패사유 DB 적재 (gpu_intake_runs/events)
```

---

## 2. 근본원인 인벤토리 (코드 증거)

### 2-1. 시스템이 맞는 AI 출력을 죽이는 5지점 (문서 01)
| # | 지점 | 증상 |
|---|---|---|
| RC-A | `canonical-model.ts:19` 정규식이 trailing 부호 못 뗌 → `H200 141GB.`→`h200.` | 모델누락·held·깡통·중복 4증상 동시 |
| RC-B | `resolve-product.ts:50` held → `confirm-review-item.ts:185` 422 차단 | 빤히 보이는 모델을 "카탈로그에 없음" |
| RC-C | commit `validate.ts:51` 무가격 행 차단(미리보기는 보존) | "봤는데 저장하니 사라짐"(preview/save 비대칭) |
| RC-D | commit `.slice(0,50)` (미리보기 500) | 50행 초과 무음 절단 |
| RC-E | `catalog/route.ts:115` `supplier_hint:null` 하드코딩 | 공급사 강제 폐기 |

### 2-2. 구조화(②) 부재 (문서 05)
- admin 스키마는 실재·편집가능(`/admin/ai-prompts`, `/pricing/gpu?tab=specs`)하고 AI에 "맞춰라"로 주입되나 **`responseSchema` 미사용 = 강제 아님**.
- 카탈로그 바인딩이 **AI 재분석이 아니라 `coreModelKey` 문자열 매칭 단독심판**(`resolve-product.ts:44-61`) → 불일치 held. **"이 H200 141GB.는 카탈로그의 그 H200"이라는 AI 바인딩 패스가 없음.**

### 2-3. 자기평가(③) 부재 (문서 04)
- `confidence`는 추출과 동시 1패스 **자기신고**, 재검토 아님. critic/self-check **grep 0건**.
- 재실행(`recheck`)은 직전결과+피드백 되먹임 잘 됨 — 단 **트리거가 100% 사람**. 자동재시도는 "0개 추출" 때만.
- 자기일관성 검증 `intake-verify.ts`는 **USAI 전용·기본 OFF**.

### 2-4. 검수 CRUD(④) 부재 (문서 05)
- 커밋전 review_items: **U(인라인편집)·C(누락행추가)·D(단건삭제) 없음**. accept/reject/AI재질문뿐.
- **단, 백엔드 `confirmReviewItem`은 `{...extracted,...overrideExtracted}`로 전 필드 override 이미 지원** — UI(`ReviewTab.tsx:367`)가 공급사만 전송 = **거의 UI 갭**.

### 2-5. 검증·표시 결함 (문서 00·03)
- 표시 포맷 SSOT 미강제: `fmtUSD` 2자리 고정 + raw `${}` 5곳 우회 → USD 흉한 정밀도(올림·3자리 요구 미충족). **환율 문제 아님**(정정됨).
- 회귀 테스트가 죽어있음: `golden-eval.test.ts`가 vitest 미설치로 **실행 0** + 합성 케이스만 + 실패파일 fixture 캡처 부재 → **수정이 안 붙는 구조적 이유**.

### 2-6. 정정 사항 (틀렸던 분석 — 문서 03)
- ⛔ **FX "9.5% 오차" 철회** — 업로드 경로는 fx_rates 실시간 환율 사용(`review/route.ts:217,362`). 1370은 죽은테스트·웹크롤·모순잔재텍스트에만.
- ⛔ **"파싱 포기→수기입력 전환" 철회** — 취합파일은 데이터 풍부·구조 일관(13블록 동일구조+공급사 병합헤더). 파싱가능. 고칠 건 추출로직.

---

## 3. 개선 아키텍처 상세

### ② AI Conformance(구조화) 패스 [신규 — 구조적 핵심]
- 입력: AI 자유분석 + 카탈로그(모델·tier·memory·enum) + admin 스키마 digest
- 작업: "이 분석을 타깃 스키마에 conform — 각 행을 카탈로그에 바인딩(`product_id`), 못 맞추는 건 후보 Top-N+사유"
- 출력: provenance 유지 스키마-정합 구조 + 바인딩 confidence. Gemini `responseSchema` 하드 제약.
- `coreModelKey`/`resolveProductId`는 **fast-path로 강등**(맞으면 통과, 틀리면 AI 바인딩). → RC-A/B 상위 구조해결.

### ③ 자기평가 루프 (Reflexion형 Actor–Evaluator) [신규]
- **원칙(연구정립):** provenance 강제(셀 인용)·심판은 채점아닌 검증(필드별 PASS/FAIL)·생성자와 다른 역할/모델·숫자 자기일관성은 코드로(월÷730=시간당, 임계없이 내부불일치)·"모르면 null+사유" 기권 합법화·이미지+셀그리드 동시투입.
- **루프:** 추출→AI심판→불합격시 실패필드만 recheck 재추출→수렴(≤2~3회)→no-progress/저신뢰면 사람 에스컬레이션.
- `recheck`의 "사람 피드백"을 "AI 심판 피드백"으로 바꾸고 자동발동 = 부품 재사용.

### ④ 검수 인라인 CRUD [UI 갭 — 빠른 효과]
- U: 각 필드 인라인 편집 → 기존 `override_extracted` 배선(또는 `PATCH /review/[id]`)
- C: 누락행 수기 추가(is_manual, confidence=user)
- D: 단건 삭제 라우트
- 사람편집 ↔ AI재분석 분리, 이력은 `review_iterations`에 source=human

### 관측·검증 인프라 [선행 필수]
- **텔레메트리(문서 02):** `gpu_intake_runs`(업로드 1회: 원본·counts·오류) + `gpu_intake_events`(행×단계: input/output 스냅샷·reason_code). 비차단(token-logger 패턴)·원본 Drive JSON·프로덕션 경로·RLS admin. → 무음 드롭이 쿼리가능 증거가 됨.
- **회귀 코퍼스:** 실패 업로드→영구 fixture 캡처 + 테스트 러너 복구(vitest 죽은코드 제거/설치). 텔레메트리가 코퍼스 공급원. → "수정이 붙게" 하는 선행조건.

---

## 4. 통합 로드맵 (권장 순서)

> 원칙: **검증 인프라 먼저 깔고(안 그러면 또 안 붙음) → 빠른 효과 → 구조적 핵심 → 폐루프 결선.**

| Phase | 항목 | 규모 | 효과 | 의존 |
|---|---|---|---|---|
| **P0** | 회귀 코퍼스 + 테스트 러너 복구 (2-5) | M | 모든 후속 수정이 '붙게' 하는 선행조건 | — |
| **P0** | 텔레메트리 레이어 (문서 02) | L | 무음 실패→쿼리가능 증거, 우선순위 자동도출 | — |
| **P1** | F1 정규식 키오염 수정 (RC-A) | S | 모델누락·held·깡통·중복 즉시 완화 | P0 코퍼스 |
| **P1** | 표시 포맷 SSOT (USD ceil 3자리) + 우회 7곳 (2-5) | S | USD 표기 정상화 | — |
| **P1** | preview/save 비대칭·slice 캡·supplier null (RC-C/D/E) | M | 무음 드롭 차단 | P0 |
| **P2** | ④ 검수 인라인 CRUD (편집·추가·삭제) | M | 사용자 능동 통제 — 서버 이미 지원 | — |
| **P3** | ② AI Conformance 패스 (responseSchema·카탈로그 바인딩) | L | 구조적 핵심 — F1 상위 해결 | P0·P1 |
| **P4** | ③ 자기평가 루프 결선 (AI심판→자동재시도→에스컬레이션) | L | 폐루프 완성 | P2·P3 |

규모: S=FAST PATH / M·L=Q&A 후 FULL PIPELINE.

---

## 5. 리스크 & 가드

| 리스크 | 가드 |
|---|---|
| AI 심판 자기합리화(self-preference) | 생성자와 다른 역할/모델/온도, 채점아닌 필드별 검증, 출처셀 인용 강제 |
| 무한/진동 루프 | MAX 2~3회 + no-progress 검출 + 사람 에스컬레이션 |
| 비용 폭증 | 실패필드만 재추출·심판=Pro/추출=Flash 티어라우팅·uncertain필드만 N샘플 |
| 스키마-valid 환각 | responseSchema는 형태만 보장 → groundedness(출처검증) 필수 병행 |
| 숫자 검증을 LLM에 맡김 | 산술 불변식은 **코드**로(결정론), 의미충실성만 LLM |
| PII(담당자 이메일·연락처) 노출 | 텔레메트리 RLS admin-only + service-role 적재 + Drive 폴더권한 3중(DC-SEC 필수) |
| 결정론 코드 강등 시 회귀 | coreModelKey는 제거가 아니라 fast-path 유지(맞으면 통과), 롤백 가능 |

---

## 6. 성공 기준 (측정가능)

- [ ] 동일 실패 업로드가 회귀 코퍼스에 fixture로 박제되고 테스트가 실제 실행됨
- [ ] 텔레메트리에서 reason_code 집계로 "최다 실패 원인" 조회 가능
- [ ] `H200 141GB.`·`H100 80GB ` 등 변형이 held 없이 카탈로그에 바인딩됨
- [ ] 사용자가 검수 큐에서 가격·모델·수량을 인라인 편집/누락행 추가/단건 삭제 가능
- [ ] 저신뢰 추출이 사람 개입 없이 AI 심판→자동 재시도→수렴, 안되면 후보+사유로 에스컬레이션
- [ ] USD 표시가 올림·최대 3자리로 일관(우회 0곳)
- [ ] 무가격/초과 행이 무음 드롭 없이 사유와 함께 노출

---

## 7. 참조 문서 (이 마스터의 근거)
- `00-summary.md` — USD·공급사·아키텍처 1차 진단
- `01-system-blocks-ai.md` — 시스템 억제 5지점
- `02-intake-telemetry-plan.md` — 관측 레이어 설계
- `03-strategic-reconsideration.md` — 전략 재검토(FX·수기전환 철회 정정 포함)
- `04-self-eval-loop-plan.md` — 자기평가·자기교정 루프
- `05-schema-conformance-and-crud-plan.md` — 스키마 구조화 + 검수 CRUD

**구현은 미수행. 착수 지점 지정 시 해당 Phase부터 규모별 파이프라인으로 진입.**
