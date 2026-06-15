# 완료 기준 — v0.7.120

## 기능
- [ ] `mono` 테마가 THEMES에 등록되고 어드민 카드에 노출
- [ ] `[data-theme="mono"]` 적용 시 흑백·직각·hairline·레드 액센트·다크사이드바로 렌더
- [ ] 프리뷰 버그 수정: 전역 테마와 무관하게 각 카드가 자기 테마 비주얼로 표시(`[data-theme="nb"]` 블록 추가)
- [ ] 좌하단 사용자 메뉴 "테마변경" → 오른쪽 서브메뉴 개인 선택
- [ ] 개인 선택 즉시 반영 + DB 영속 + 새로고침 후 유지
- [ ] 어드민=전역 디폴트 / 미선택 사용자=디폴트 추종 / 선택 사용자=본인 테마

## Feature Defaults (신규 컬럼 — 최소 적용)
- [ ] 개인 테마 변경 = 본인만(self-only 권한, 어드민 라우트와 분리)
- [ ] 입력 검증: isThemeId 화이트리스트(무효값 거부), null=리셋 허용
- (CRUD 전체/List/검색·정렬·필터/페이지네이션 — 단일 스칼라 환경설정이라 비대상)

## 품질 게이트
- [ ] `lib/theme.test.ts` 통과 (package.json 등록)
- [ ] tsc --noEmit 0
- [ ] design:check 통과
- [ ] Playwright 브라우저 실검증 5항목 PASS
- [ ] DC-QA / DC-SEC / DC-REV(80+) 통과
- [ ] GATE 1-5
- [ ] 버전 4파일(루트 package.json·apps/web/package.json·CLAUDE.md·AGENTS.md) 동기화
