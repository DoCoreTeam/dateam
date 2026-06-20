# 03 — 테스트 전략

## 단위 (node:test, --experimental-strip-types) — package.json test 목록에 추가 필수
- intake-grid.test.ts: 타겟 xlsx 실파일 → 전 시트(3개) 인식·병합 개수·좌표 정확
- normalize-money.test.ts: ₩/원/$/USD, /hr·시간당·/mo·월, gpu_count 8↔1 환산, 미지 토큰 폴백
- intake-reconcile.test.ts: 산술정합(8장/1장 비율≈8), price>0, provenance 누락 reject
- intake-verify.test.ts: 동일모델 다블록 일치/불일치, 신뢰도 임계 needs_human 라우팅
- grid-compress.test.ts: anchor 압축 후 블록경계 보존

## 골든셋 (golden-eval.test.ts 확장)
- 타겟 xlsx: 기대 = {T4 1장 시간당 USD ≈ 0.81, 업체≠명부, target=own_target, 메모리 정상}
- gcube xlsx: 정상 평면표 회귀(기존 추출값 유지) — 회귀 0 확인
- 변형 fixture 2종(전치표/다통화) — 미지 형식 일반화 확인
- 9개 실패모드 각각 1 케이스

## 통합 (실DB, is_test)
- usai-orchestrate를 throwaway product/supplier로 1회 — review_items 적재 검증, 확정 후 정리

## E2E (Playwright, 실UI — 사용자 지침)
- throwaway 계정 로그인 → /pricing/gpu?tab=board(통합입력)
- 타겟 xlsx 업로드 → 검토대기 항목 표시값 실측:
  - T4 가격이 6.48이 아니라 ≈0.81 USD/hr (1장 시간당)
  - 업체가 NHN/KAKAO(명부)가 아님
  - 분류 배지가 경쟁사가 아닌 목표가(own_target)
- 스크린샷 첨부. is_test 행만 사용 → 검증 후 삭제.

## 검증 게이트 (GATE 1-5)
tsc --noEmit / next lint / pnpm test / next build / design:check 전부 통과.
React18 빌드검증 필수(tsc만으론 런타임버그 누락).
