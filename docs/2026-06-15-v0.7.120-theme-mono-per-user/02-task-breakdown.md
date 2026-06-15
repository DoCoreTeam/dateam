# 태스크 분해 — v0.7.120

## Phase 1: 신규 테마 + 버그픽스 (CSS/토큰)
- T1. `lib/themes.ts` — `mono` 테마 등록
- T2. `globals.css` — `[data-theme="nb"]` 명시 블록 추가(프리뷰 버그픽스)
- T3. `globals.css` — `[data-theme="mono"]` 토큰 블록 + tape 중립화

## Phase 2: 개인 테마 백엔드
- T4. 마이그레이션 097 — `profiles.theme_preference text` 추가
- T5. `types/database.ts` — Profile 타입 확장
- T6. `lib/theme.ts` — `resolveTheme()` 순수함수 + `getEffectiveTheme()`
- T7. `app/api/user/theme/route.ts` — self-only 저장 라우트

## Phase 3: 적용 + UI
- T8. `app/layout.tsx` — getEffectiveTheme 주입
- T9. `app/(member)/layout.tsx` — theme_preference 조회 + currentTheme 전달
- T10. `SidebarProfile.tsx` — "테마변경" 오른쪽 서브메뉴 + 즉시 반영

## Phase 4: 검증
- T11. `lib/theme.test.ts` 작성 + package.json test 목록 등록 + 실행
- T12. tsc --noEmit + design:check 통과
- T13. Playwright 브라우저 실검증(프리뷰 차이 / 개인 테마 전환 / 새로고침 후 유지)
- T14. DC-QA / DC-SEC / DC-REV 평가
- T15. GATE 1-5 + 버전 4파일 동기화
