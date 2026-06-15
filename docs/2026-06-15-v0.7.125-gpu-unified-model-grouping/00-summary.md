# v0.7.125 — GPU 통합 표 모델별 그룹핑(접기/펼치기)

## 작업 요약
통합 표가 평면 리스트였던 것을 **모델별 그룹**으로 묶고 그룹 단위 접기/펼치기를 추가.
모델당 보통 4개 이상 구성(용량·공급사별 행)이 흩어져 보이던 것을 모델 헤더 아래로 모음.
예전의 **티어(tier) 그룹핑은 제거**(요청) — 모델 단일 레벨 그룹핑.

## 수정 파일
- `apps/web/components/pricing/gpu/unified/UnifiedTable.tsx`
  - `collapsed: Set<string>`(접힌 모델명) 상태 + `toggleGroup`/`toggleAll`
  - 정렬·검색 반영된 `visibleRows`를 `Map`(삽입순서 보존)으로 `model_name` 그룹핑
  - 그룹 헤더(▾/▸ chevron + 모델명 + "N개 구성") 클릭 시 해당 그룹 토글
  - 멤버 행의 모델 셀은 모델명 대신 **구성(용량 + 공급사)** 표시(모델명은 헤더에 있으므로 중복 제거)
  - 툴바에 "전체 접기/펼치기" 토글(ChevronsDownUp/UpDown 아이콘)
  - 행 렌더를 `renderRow()` 헬퍼로 추출(평면 map → 그룹 map 재사용)
- `apps/web/app/globals.css`
  - `.gpu-unified-group-head`/`-chevron`/`-name`/`-count`, `.gpu-unified-collapse-btn` 신규
  - 전부 디자인 토큰 사용(`--surface-bg`/`--gpu-border`/`--info-bg`/`--space-*`/`--fs-*`)
  - 컬럼 헤더(sticky)와 충돌 피하려 그룹 헤더는 non-sticky
- `apps/web/e2e/gpu-unified-table.spec.ts`
  - 기본 ON 반영: ON 테스트는 오버라이드 제거 후 통합 표 확인 + 그룹 헤더 접기/펼치기(aria-expanded) 검증
  - 롤백 테스트는 `localStorage 'off'` 명시로 변경(기본 ON이 됐으므로 removeItem로는 OFF 안 됨 — v0.7.124 후속 정정)

## 변경 이유
모델별 4+ 구성이 한 평면 리스트에 섞여 스캔이 어려움 → 모델 헤더로 묶고 접어 개관성 확보.

## 영향 범위
- 표시·상호작용만. 정렬/검색/통화/상세 패널/일괄 반영 로직 무변경.
- 그룹 순서 = 정렬된 행에서 모델 첫 등장 순서. 그룹 내 행은 기존 정렬 유지.
- 데이터·계산 무변경.

## 검증
- `tsc --noEmit` 0
- `pnpm design:check` 통과(hex 0)
- Playwright e2e 3/3 통과(그룹 접기/펼치기 + off 롤백 포함)
