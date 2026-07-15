# 03 · 테스트 전략

> 프로젝트 컨벤션: node:test(`--experimental-strip-types`). 신규 `*.test.ts`는 `apps/web/package.json` `test` 목록에 **명시 등록**(자동탐지 없음). 무손실은 실행경로 실측(Playwright)까지.

## 1. 단위 (순수모듈 — 최우선)
- **context-anchor.test.ts**: 앵커 span 정확 / 다중 매칭 / 미매칭(이미지) 폴백 / 유니코드 오프셋.
- **synthesize-hierarchical.test.ts** (핵심): 전 idx 포함 정상 / 1개 누락→보수패스 복구 / 복구실패→**부록 결정론 append 강제**(어떤 입력에도 전 항목 물리 존재) / 예산초과 collapse / 패치 JSON = idx 단위만 적용(비패치 무왜곡).
- **concurrency.test.ts**: 순서보존 / 백오프 / 1개 예외가 나머지 안 죽임.

## 2. 통합 (오케스트레이터)
- claim 원자성: 두 워커 동시 claim → 같은 항목 중복 처리 0(draft_gen 락 선례 방식).
- 드레인: 시간예산 임박 `drained:false` → 재-POST/크론이 이어받아 완주(멱등).
- control: pause→진행 항목만 완료 후 정지 / cancel→in-flight abort + 완료분 보존 / stall(claimed_at<now-10m)→재claim.
- 실시간: `count(status)` 파생값이 실제 전이와 일치(하드코딩 상태값 부재 정적 확인).

## 3. E2E (Playwright — 실행경로 실측, throwaway admin)
1. 기획서(md) 투입 → 항목 N 추출(전량, 생략0 배지).
2. 자유 command 입력 → 병렬 분석 진행 상태 실시간 변화 관찰.
3. **탭 닫았다 재진입 → 진행 계속됨**(백그라운드 검증).
4. 취소/일시정지 버튼 → 즉시 반영, 완료분 보존.
5. 완료 → 완성형 보고서에 **전 항목 존재**(idx 커버리지 100%) + export 4종.
- 이미지·엑셀·ppt·html 각 1케이스 투입 스모크.

## 4. 커버리지 게이트 (회귀 방지)
- 정적 가드: `synthesizeInsights`에 `slice(0, 30000)` 재유입 차단 패턴(kst-guard 방식 선례).
- 골든: 대표 기획서 1건 → 항목수·커버리지 스냅샷 회귀.

## 5. 목표
순수모듈 ≥90% / 오케스트레이터 주요 분기 100% / E2E 크리티컬 플로우(3·4·5) 필수 GREEN.
