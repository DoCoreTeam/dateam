# FAST PATH Summary — v0.7.263 verbose 모델 중복생성 차단

## 작업
경쟁사 추출 확정 시 verbose 소스명("NVIDIA HGX B200")이 기존 단축 카탈로그 모델("B200")과 매칭되지 않아 **중복 모델이 임의 자동생성**되던 버그를 근본 차단. + 최근 Nebius 추출이 만든 verbose 중복 7종 + 그 시세/매핑 삭제.

## 원인
모델 find-or-create가 `normModelKey`(소문자+공백/하이픈 제거) **정확매칭**만 사용 →
- "NVIDIA HGX B200" → `nvidiahgxb200` ≠ "B200" → `b200` → 매칭 실패 → 신규 생성.
- v0.7.261에서 A6000/V100 등 **명시 alias만** 처리했을 뿐 일반 verbose→단축 케이스는 미해결.

## 대상 (수정 파일)
- `apps/web/lib/gpu/canonical-model.ts` — `stripModelNoise`(벤더/HGX/`with CPU` 잡음 제거) + `coreModelKey`(잡음제거 후 정규화) 신규. `canonicalizeModel`이 잡음 제거된 단축명 + coreModelKey 반환.
- `apps/web/lib/gpu/confirm-review-item.ts` — 후보 매칭을 `coreModelKey` 기준으로.
- `apps/web/lib/gpu/competitor-import.ts` — 후보 매칭을 `coreModelKey` 기준으로.
- `apps/web/lib/gpu/canonical-model.test.ts` — verbose→단축 해소 / 폼팩터 보존 / 회귀 3 테스트 추가.

## 이유
- **SSOT**: 확정·추출 두 경로가 동일 `coreModelKey` 함수를 import해 매칭(복붙 금지).
- **오병합 0 보장**: 잡음 토큰(`nvidia`/`hgx`/`with amd|intel cpu`)만 제거하고 **폼팩터(SXM/PCIe/NVL)·세대·메모리는 절대 보존**. 실데이터 77종 카탈로그에서 단축명끼리는 충돌 0, verbose↔단축만 충돌(의도).

## 영향
- 경쟁사 확정/임포트 시 verbose 소스명이 기존 모델로 해소 → 신규 자동생성 차단. 가격표/판매가표 모델 목록 정합성 유지.
- 데이터 정리: Nebius verbose 7종(NVIDIA HGX B200/B300/H100/H200, L40S with AMD/Intel CPU, RTX PRO 6000) 소프트삭제 + 매핑 7·시세 7 삭제(백업 `/tmp/cleanup-nebius-backup.json`).

## 검증
- tsc 0 / canonical 11·전체 571 통과 / design:check 통과 / next build 통과
- 실데이터: 6/6 verbose → 기존 단축 모델 해소(신규 생성 차단), 폼팩터 H100 SXM≠PCIe 보존
