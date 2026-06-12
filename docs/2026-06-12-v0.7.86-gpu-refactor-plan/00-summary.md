# GPU 관리 리팩토링 기획 — v0.7.86

> 산출물: **인터랙티브 단일 HTML 기획서** (`gpu-refactor-plan.html`). 구현 아님(기획만).

## 작업
GPU 관리 모듈의 UX 단순화 리팩토링 청사진. 기능은 모두 구현되어 있고, **배치·통합·재구성**만 한다.
- AS-IS: 보기 10탭 + 입력 6경로 + lib/gpu 41 SSOT + 15 테이블 + 동적프롬프트
- TO-BE: **보기 = 1 통합테이블 / 등록 = 1 통합입력 / 거버넌스 = admin 스키마·AI프롬프트**

## 핵심 결정 (Q&A 반영)
1. **통합테이블 주체 = 영업/견적(판매가 중심)** → 기본 행은 판매가 요약, 행 펼침에 원가·출처·정합성.
2. **통합입력 = 전 항목 동시** → 제품 스펙 + 공급원가 + 경쟁사 시장가를 한 폼에서. AI 추출이 진입점.
3. **스키마 연동 = 반동적(B)** → 핵심 컬럼 고정, `get_schema_digest()` 가 AI 추출/검증 필드만 동적 주입.
4. **산출 = 인터랙티브 단일 HTML(목업 포함)**.

## 정합성 보존 원칙 (불변)
- 보기를 1개로 합쳐도 **계산은 `lib/gpu/pricing.ts` SSOT** 그대로. 테이블은 표현만.
- 입력을 1개로 합쳐도 **라우팅은 `intake-routing.ts`, 검증은 `validate.ts`, 중복제거는 `dedup.ts`** 그대로.
- 실견적 우선·추종가 규칙(`buildCatalog`) 보존.

## 수정 파일
- 신규: `docs/2026-06-12-v0.7.86-gpu-refactor-plan/gpu-refactor-plan.html` (기획 산출물)
- 신규: 본 요약 `00-summary.md`
- 코드 변경 **0줄** (구현 금지)

## 영향 범위
없음(문서만). 후속 구현 시 IA/마이그레이션 로드맵은 HTML의 "마이그레이션" 섹션 참조.

---

## 2차 개정 (팩트 재검증) — 동일 v0.7.86

> 사용자 피드백: "다중 데이터 일괄·URL AI수집 등 실재 기능이 목업에 다 들어있나? 사용자 흐름·다각도 CRUD·정합성 강화까지 팩트로 재분석해 HTML 수정."

**실측(Explore 2병렬)으로 확인된 1차 목업 누락 실재 기능:**
- URL 자동감지+병렬 크롤(15K자, Googlebot UA) — `extract-helpers.ts:37-59`
- 이미지 ≤10장 동시 + Ctrl+V + 드래그앤드롭 — `review/stream:31`
- SSE 실시간 스트리밍 추출(토큰) — `QuoteRegisterTab:288`
- 미리보기→확인→commit(≤50개) 흐름 — 1차는 "즉시저장" 오표현
- 입력 자동분류(경쟁가 vs 공급가) — `gpu.input-classify`
- 프롬프트 자가합성·자동롤백 — `synthesizeExtractPrompt`
- gcube 가격 자동수집 — `scripts/gcube-price-check.mjs`

**CRUD 팩트(12엔티티):** 완전CRUD 7(products·quotes·direct_prices·competitors·mapping·suppliers·partner_tiers) / 제한 5(market_prices=C없음·자동인입, gpu_specs=UPSERT, review_items=상태전이·물리삭제X, pricing_settings=싱글톤, ai_prompts=이력관리). 제한은 정합성 보호 설계.

**보기 7각도:** board·cockpit·market·inventory·catalog·history·specs + 비교축(price-signal·market-median SSOT).

**정합성 B+ 약점(정직 명시):** direct 원가없음→마진 null / quotes 일괄편집 없음 / 만료 UI경고 없음 / 파트너할인 catalog 미반영 → 각 행 신호 가시화로 B+→A 개선안.

**HTML 개정 결과:** 10탭(개요·현황·사용자흐름·통합입력·통합테이블·CRUD매트릭스·보는각도·스키마AI·정합성·로드맵). 통합입력=멀티/URL/스트리밍/다중행 미리보기 그리드. 통합테이블=7각도 세그먼트+행 인라인CRUD+드로어 미니액션. 사용자 흐름 8단계 end-to-end. 검증: HTTP200·JS에러0(favicon404만)·탭전환 동작 실증.
변경 코드 0줄.
