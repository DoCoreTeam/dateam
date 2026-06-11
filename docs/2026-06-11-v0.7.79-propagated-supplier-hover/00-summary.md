# v0.7.79 — 전파행 공급사 표시 + 행 hover 라인 짤림 수정

## 작업 1: 전파(추정) 구성에도 공급사 내용 표시 (사용자 요구 #16처럼)
- 문제: ×2/×4 등 "1장당 전파(추정)" 구성은 cost 견적이 없고 gcube 공시(list) 견적만 있어,
  기존 `quotes.length===0` 분기를 건너뛰고 일반 분기에서 costQuotes가 비어 **공급사가 안 보임**(gcube公示만).
- 수정: 분기 조건을 `costQuotes.length===0`으로 변경 → cost 견적이 없으면 전파 추정 블록(전파 기준 공급사 Equinix Metal + 추정 환산가)을 렌더하고, gcube 공시 박스(listBox)는 공통으로 항상 표시.
- 결과: ×4 펼침에 "Equinix Metal · 추정(전파) ₩11,875/GPU·hr" + gcube公示 동시 노출. ×1과 동일하게 공급사 내용 표시.
- 파일: apps/web/app/(member)/pricing/gpu/tabs/PriceTableTab.tsx (ExpandedRow — listBox 공통화 + costQuotes 기준 분기)

## 작업 2: 행 마우스오버 시 상단 라인 짤림 수정 (사용자 요구 #17)
- 원인: `.gpu-row-main:hover` 배경(surface-bg)이 셀 구분선 색(border-bottom: surface-bg)과 동일 → hover 시 인접 행 경계선이 배경에 묻혀 사라짐("짤림").
- 수정: hover 시 `box-shadow: inset 0 1px 0 var(--gpu-border), inset 0 -1px 0 var(--gpu-border)`로 상/하 경계선을 다시 그림(hover 한정, 기본 모습 유지).
- 파일: apps/web/app/globals.css (.gpu-row-main:hover)

## 검증
- tsc0 / design:check / test(70) 통과.
- Playwright 실증: A100 ×4 전파행 펼침→Equinix Metal+추정(전파)+gcube公示 동시 표시 / ×1 행 hover→상하 inset 라인 노출(짤림 해소). 콘솔 에러 0(기존 stale 404 제외).

## 영향
- 가격 계산(buildCatalog) 무변경. 표시 로직만. DB/API 변경 없음.
