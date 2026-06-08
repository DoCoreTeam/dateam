# 02. 작업 분해 (기획 — 구현 시 착수 순서)

> 절대 구현 금지. 아래는 "승인 시 이 순서로 한다"는 계획.

## 전제 작업 (테마가 제대로 동작하려면 먼저)
- **P-A 잔여 하드코딩 토큰화**: 테마 전환 누락을 없애려면 하드코딩 hex를 토큰으로. 우선순위:
  - 캘린더 page.tsx 24건(셀/이벤트칩) → status-colors SSOT + 토큰
  - status 의미색은 SSOT 유지(테마 무관 의미색은 그대로 둘지 결정 필요 — 보통 의미색은 테마 공통)
  - GPU 잔여 hex(354건)는 `--gpu-*` 토큰 경유로 이미 테마화 가능, 인라인 잔여만 정리
- **P-B ESLint 가드**: 신규 인라인 hex 차단(재발 방지)

## 본 작업
### T1. 토큰셋 분리 (globals.css)
- [ ] 현재 :root의 NB 값 → `[data-theme="nb"]` 블록으로 이동
- [ ] `:root`(=classic)에 기존 인디고 값 복원(git 히스토리에서 회수: brand #6366f1, border #e2e8f0, radius 0.75rem, soft shadow, border-w 1px)
- [ ] 두 테마에서 동일 토큰 이름 전부 정의(누락 시 폴백값)

### T2. 테마 레지스트리 + 조회
- [ ] `lib/themes.ts` (THEMES 배열, ThemeId)
- [ ] `lib/theme.ts` getActiveTheme() — system_settings 'active_theme' 조회(기본 'nb')

### T3. 적용 (SSR)
- [ ] root layout.tsx: getActiveTheme() → `<html data-theme suppressHydrationWarning>`
- [ ] `<head>` 쿠키 기반 no-flash 인라인 스크립트
- [ ] (선택) 쿠키 set: 변경 시 미들웨어/Set-Cookie

### T4. 저장 API + 마이그레이션
- [ ] supabase migration: system_settings에 'active_theme' 기본행 시드(브랜딩 패턴)
- [ ] POST /api/admin/settings/theme — admin 권한 확인 후 upsert + revalidatePath('/', 'layout')

### T5. admin UI
- [ ] admin/settings에 "디자인 테마" 섹션(ThemeSettings.tsx) — 라디오 카드 + 미니 프리뷰
- [ ] 저장/안내 메시지(브랜딩 컴포넌트 패턴 재사용)

### T6. 검증
- [ ] 테마 토글 시 전 화면(home/calendar/admin/gpu) 시각 회귀 — classic/nb 양쪽
- [ ] no-flash(새로고침 시 깜빡임 0), SSR 초기 테마 정확
- [ ] a11y: 양 테마 대비 AA

## 완료 기준
- [ ] admin에서 테마 2종 선택 → 저장 → 전 사용자 적용 확인
- [ ] 새 테마 추가가 "globals 블록 1개 + 레지스트리 1줄"로 가능(컴포넌트 0 수정)
- [ ] 테마 전환 시 토큰 경유 영역 100% 반영(하드코딩 잔여는 P-A로 0 지향)

## 규모/리스크
- 규모: MEDIUM~LARGE (T1~T5 ~8~12파일 + 마이그레이션). 본체는 토큰셋 분리·layout 주입.
- 리스크: classic 값 복원 정확도(히스토리 회수), 하드코딩 잔여로 인한 부분 미반영 → P-A 선행으로 완화.
- 비범위: 사용자별 개인 테마, 테마 에디터(커스텀 색 직접 편집)는 후속.
