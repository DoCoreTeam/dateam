# 01 아키텍처 — 테마 0 디자인 시스템
## 토큰 계층 (SSOT globals.css)
- 배경/전경 짝: `--accent`/`--accent-fg`, `--brand`/`--brand-fg`, 상태 `--success`/`--success-fg` 등. 각 [data-theme]에서 짝으로 정의 → accent가 노랑↔인디고로 뒤집혀도 전경 자동.
- `--modal-backdrop` 토큰(기존 rgba(15,23,42,0.5) 표준값).
- status-colors.ts: hex → `var(--success)` 등 참조(런타임 CSS var는 JS에서 직접 못 읽으므로, 클래스 기반 NbBadge는 CSS에서 토큰, JS 색맵은 className 반환 방식으로 전환).
## 프리미티브 (components/ui/nb/)
- NbModal: backdrop+카드+useEscClose+X+tape-title 표준(§2-2). children/title/onClose.
- NbTable: `.table-base.table-card` 래퍼. columns 정의 + 행 렌더(card-header/data-label 자동).
- NbField: label+input-field 묶음. NbInput/NbSelect/NbTextarea.
## 가드 (scripts/check-design-tokens.mjs 확장)
- 신규 탐지: 인라인 style rgba(), raw `<input|select|textarea`(className 미포함), 미정의 토큰(`--text-sm` 등 화이트리스트 외 var).
## 강제
- CI design-guard.yml + (선택)pre-commit.
