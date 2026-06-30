# MEDIUM Summary — 검토 확정 차단을 "전 사유 인카드 조치"로 (막다른 알럿 제거)

## 문제 (사용자 이미지)
GPU 검토 대기에서 경쟁사 T4 확정 시 "모델 'T4'의 변형을 메모리로 특정할 수 없습니다… 메모리를 지정한 뒤 확정하세요" **브라우저 알럿만 뜨고, 정작 메모리를 지정할 방법(UI)이 없음** = 막다른 길.

## 근본 원인 (분석)
- `lib/gpu/confirm-review-item.ts` **경쟁사 경로(:118-123)**: `saveCompetitorPrices` held 시 `heldReasonMessage`를 **`code`·후보 없이 plain error**로 반환 → 클라이언트가 해소 모달도 못 열고 `alert(j.error)` 막다른 길.
- 공급사 경로(:184)는 held를 `code:'model_unresolved'`로 반환 → 해소 모달 열림(부분 조치 가능)하나, ambiguous_variant엔 메모리 선택 UI가 아닌 모델매핑 모달이라 부적합.
- 기존 인프라: `override_extracted.memory`가 양 경로 resolve에 반영됨 / SpecsTab은 `?tab=specs&newModel=<모델>`로 신규등록 폼 프리필 자동오픈 지원(SpecsTab.tsx:222,272).

## 결정 (Q&A)
카드 내 인라인 조치 / 경쟁사+공급사 둘 다(SSOT) / **전 사유 조치화**.

## 수정 파일
- `lib/gpu/resolve-product.ts` — held 결과(ambiguous_variant)에 `candidates: {id, memory}[]`(같은 모델·장수의 메모리 변형 후보) 추가. 순수 SSOT.
- `lib/gpu/competitor-import.ts` — `held[]`에 `reason`+`candidates` 전파.
- `lib/gpu/confirm-review-item.ts` — 경쟁사·공급사 양 경로 held 응답을 구조화: `code`(ambiguous_variant/no_model/no_variant) + `candidates`(메모리) + `modelName`/`gpuCount`. plain 알럿 유발 제거.
- `app/(member)/pricing/gpu/tabs/ReviewTab.tsx` — 확정 에러 `code`별 인카드 조치:
  - `ambiguous_variant` → 후보 메모리 변형 칩 버튼 → 선택 시 `override_extracted.memory`로 즉시 재확정(handleConfirm overrideMemory 인자 추가).
  - `no_model`/`no_variant` → "스펙 관리에서 등록" 버튼 → `?tab=specs&newModel=<모델>` 이동(기존 프리필 딥링크).
  - 기존 model_unresolved 모달은 폴백 유지.
- `lib/gpu/resolve-product.test.ts` — candidates 반환 회귀 테스트.

## 완료조건
- [ ] 경쟁사 T4(메모리 모호) 확정 → 알럿 대신 카드에 후보 메모리 버튼(예: 16GB/8GB) 표시, 선택 시 그 메모리로 확정
- [ ] 공급사 동일 동작(인카드 메모리 선택)
- [ ] no_model/no_variant → 카드 내 "스펙 관리 등록" 버튼 → 스펙 탭 신규등록 폼 모델명 프리필
- [ ] 막다른 `alert(메모리 지정하세요)` 제거 (조치 UI로 대체)
- [ ] resolveProductId candidates 회귀 테스트 통과, tsc·lint·design·실화면(Playwright) 확인

## 제외
- 추출/바인딩 점수 로직, DB 스키마 변경
