# 00-summary — 로딩 스피너 로고 1종 통일 (v0.7.183)

## 작업
풀스크린 로딩 오버레이를 "로고(X마크/이미지)+진행바" **1종(공용 로고 스피너)**으로 통일.
- 근본: AXLoadingOverlay가 brandName **텍스트 char-wave**를 그려 NavigationLoader(로고)와 달랐음(로그인=Image#4 텍스트웨이브 / 캘린더=Image#5 로고).
- SSOT 신설 `BrandLoaderMark`(로고 이미지 우선 → 없으면 X마크+DATA ALLIANCE)를 NavigationLoader·AXLoadingOverlay 둘 다 사용 → 로그인+AI 오버레이 6곳이 일괄 로고 스피너화.

## 수정 파일
- `components/ui/BrandLoaderMark.tsx` — **신설** SSOT(로고/ X마크 마크업). dark 톤 지원.
- `components/ui/NavigationLoader.tsx` — 인라인 로고 블록 → BrandLoaderMark 재사용.
- `components/ui/AXLoadingOverlay.tsx` — char-wave 텍스트 → BrandLoaderMark(로고). logoUrl prop 추가, label/sublabel/진행바/elapsed 유지.
- (선택) login 경로 logoUrl 전달(있으면 이미지, 없으면 X마크).

## 범위(이번)
- 포함: 풀스크린 오버레이 6곳(로그인 포함) 로고 통일 + SSOT.
- 제외(Phase 2): 리스트/페이지 인라인 스피너(Loader2 6곳·gpu-spinner 1·"로딩중" 텍스트 17곳+) → 풀스크린 로고가 아니라 **SkelList 스켈레톤**으로 교체가 적합(별도 스프린트). loading.tsx 누락(home/kpi/org/work/admin 등) 보강도 Phase 2.

## 완료 조건
- [ ] 로그인/AI 오버레이가 모두 로고 스피너(X마크/이미지)로 표시
- [ ] NavigationLoader와 동일 비주얼(SSOT)
- [ ] tsc 0 · design:check · **실제 next build** 통과
- [ ] 🟥 DC-REV PASS
