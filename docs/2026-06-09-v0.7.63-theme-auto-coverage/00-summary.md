# 테마 자동 적용 여부 분석 (분석 전용 — 구현 안 함)

작성 2026-06-09 · 기준 v0.7.63 · 근거: 🟦 DC-ANA

## 한 줄 답
**"조건부 자동"** — 토큰(var(--*))과 공용 컴포넌트를 쓰면 색·보더·그림자·라운드·사이드바는 두 테마(nb/classic)에 자동 적용된다. 그러나 **하드코딩(hex/rgba)·리터럴 간격/폰트·공용컴포넌트 미사용**은 자동 적용 안 되고, design:check 가드가 그 일부를 못 잡는다.

## 자동 적용 O (토큰만 쓰면 신경 끔)
- 색: `--brand/--accent/--ink/--border-color/--brand-soft` (classic이 오버라이드)
- 상태색 `--success/danger/warning/info`(두 테마 공통), 텍스트 `--text/--text-muted/--text-faint`
- 치수: `--border-w/--radius/--shadow-sm|md|lg`, 사이드바 `--sidebar-bg/fg/--nav-hover-bg`
- GPU 토큰: 메인 토큰 alias라 연쇄 자동 추종(globals.css:2890~)
- 공용 컴포넌트: NbNavItem·MobileShell·PageHeader·RichText·`.btn-*`·`.card`·`.badge`·`.input-field` = 내부 100% 토큰 → 자동

## 자동 적용 X (사람이 신경 써야 함)
1. **rgba() 인라인 색** — (member) 59건·components 38건 잔존(모달 backdrop 등). 테마 전환 시 고정.
2. **간격/폰트 리터럴** — `padding:'0.875rem'`, `fontSize:'0.8rem'` 등은 토큰(`--space-*`/`--fs-*`) 아니면 고정.
3. **공용 컴포넌트 미사용 자작** — NbButton/Card/Badge 채택률 낮음. 인라인 재구현 시 테마 위험.
4. **미정의 토큰** — `--text-sm/--text-lg` 등 참조 시 조용히 폴백(화면마다 다르게).
5. **신규 CSS 클래스** — 클래스 내부 색/치수도 토큰 써야. 특히 `--accent` 배경엔 `--ink` 글씨 필수(nb=노랑/classic=인디고라 글씨색 안 맞추면 대비 깨짐).
6. **status-colors.ts hex 9개** — 값은 토큰과 같지만 변수 연결 안 됨 → 테마별 상태색 차등 불가.

## design:check 가드의 진실
- **잡는 것**: TSX 인라인 `style={}`의 hex(#rrggbb), border 너비+색 동시 하드코딩. CI(design-guard.yml)가 PR 차단.
- **못 잡는 것(사각지대)**: rgba(), CSS 파일 내 hex(.badge-slate #e5e5e5 등), input-field/label 클래스 누락, 공용컴포넌트 미사용, 미정의 토큰, 리터럴 간격/폰트. pre-commit hook 없음(CI만).

## 실제 테마 깨짐 사고(이번 세션)
- v0.7.61: `.badge-indigo`가 진한 accent 배경+검정 글씨 → 묻힘 (NB=노랑 전제가 classic 인디고에서 깨짐)
- v0.7.60: `--accent==--brand` 동색 → active/통합입력 혼동
- (과거) daily-page 폭, `--text-*` 미정의 토큰

## 결론
"새 메뉴/기능 추가 시 **토큰+공용 컴포넌트만 일관되게 쓰면** 디자인을 테마별로 따로 만들 필요는 없다." 단 **하드코딩만 안 하면**이 전제. 가드가 전부를 막아주지 못하므로 아래 체크리스트를 눈으로 대조해야 안전.

## 신규 작업 테마-안전 체크리스트
- [ ] 색=`var(--token)` (hex/rgb/rgba 금지)
- [ ] 간격=`var(--space-*)`, 폰트=`var(--fs-*)`
- [ ] 버튼/카드/뱃지/입력/레이블=공용 컴포넌트 or 표준 클래스(.btn-*/.card/.badge/.input-field/.label)
- [ ] 모달 backdrop=`rgba(15,23,42,0.5)` 표준, 카드배경=`var(--color-surface)`
- [ ] 신규 CSS 클래스 내부도 토큰, nb·classic 양쪽 육안 확인(accent 배경엔 ink 글씨)
- [ ] 커밋 전 `pnpm design:check` + rgba/미정의토큰 diff 육안

## (참고) 더 단단히 하려면 — 선택 개선안
- 가드에 rgba()·미정의 토큰·input(클래스 없음) 패턴 탐지 추가
- status-colors.ts hex → var(--*) 연결(테마별 상태색 차등 가능)
- 잔존 rgba 인라인 → 토큰화, NbButton/Card/Badge 채택률 상향
