# 02 Task Breakdown

## Phase A — 캐노니컬 SSOT
- A1 lib/gpu/canonical-model.ts: canonicalizeModel(raw)={canonical,confident} + ALIAS 사전(보수적) + normForCompare
- A2 canonical-model.test.ts: 케이스변형 합침 / Ada·Pro·Quadro·4000≠5000 분리 / 애매 confident:false / alias 1:1

## Phase B — 확정 하드-dedup + 유령차단
- B1 confirm-review-item.ts: canonicalize 적용, (canonical,memory,gpu_count) 매칭→최신화 or 1행. 캐노니컬명으로 저장
- B2 ensureStandardConfigs 호출 차단(유령 ×N 신규생성 금지) — confirm-review-item.ts 285-290 제거/가드
- B3 extract-helpers loadSpecContext: gpu_specs 권위 우선(있으면) — 보수적, 회귀 0 범위
- B4 단위테스트: dedup키·최신화·멱등(동일 재확정)·유령차단

## Phase C — 기존 데이터 안전정리 (마이그 129)
- C1 백업테이블 생성 + 유령 219행 소프트삭제(deleted_at)
- C2 (있으면) 진짜 중복 병합(견적 이관)
- C3 migrate.sh 적용 + 검증쿼리(모델 유니크/중복0/가격 불변)

## Phase D — 검증
- D1 단위테스트 전체 + package.json 등재
- D2 Playwright E2E: throwaway 같은모델 다른표기 2회 확정→1행·최신화 + board 중복0 스샷, 정리
- D3 GATE: tsc/lint/test/next build/design
- D4 버전 0.7.240(4파일)+commit(push 금지)
