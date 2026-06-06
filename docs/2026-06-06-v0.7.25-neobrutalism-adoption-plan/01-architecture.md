# 01. 아키텍처 — 토큰 시스템 & globals.css 전략

> 기획 전용. 아래 코드 블록은 **설계 예시**이며 이번 작업에서 구현하지 않는다.

## 1. 토큰 3레이어 (DC-RES 표준)

```
Layer 1 Primitive  (원자값, 컴포넌트 직접 참조 금지)
  --nb-black:#0a0a0a  --nb-yellow:#fcd34d  --nb-purple:#7c3aed
  --nb-off-white:#f8f8f6  --nb-paper:#efede8  --nb-white:#fff
Layer 2 Semantic   (역할 alias, 컴포넌트는 여기만 참조)
  --ink:var(--nb-black)  --border-color:var(--nb-black)  --shadow-color:var(--nb-black)
  --accent:var(--nb-yellow)  --brand:var(--nb-purple)  --surface:var(--nb-white)  --bg:var(--nb-off-white)
  --border-w:3px  --border-w-mobile:2px  --radius:2px
  --shadow-sm:3px 3px 0 0 var(--shadow-color)   /* 배지/칩 */
  --shadow-md:4px 4px 0 0 var(--shadow-color)   /* 카드/버튼 */
  --shadow-lg:6px 6px 0 0 var(--shadow-color)   /* hover/모달 */
Layer 3 Component  (선택)
  --card-shadow:var(--shadow-md)  --btn-bg:var(--brand)  --tape-bg:var(--accent)
```

## 2. 브릿지 전략 (회귀 회피 핵심 — DC-RES)
기존 인디고 토큰을 **삭제하지 않고** 새 토큰으로 alias. 컴포넌트 코드를 건드리지 않아도 외형이 전환된다.

```css
/* globals.css :root — 기존 변수는 그대로 두고 값만 새 토큰으로 포인팅 */
--color-brand: var(--brand);          /* #6366f1 → 퍼플 */
--color-border: var(--border-color);  /* 연회색 → 잉크블랙 */
--shadow-card: var(--shadow-md);      /* soft → hard */
--radius-card: var(--radius);         /* 1rem → 2px */
```
→ 1차에 alias만 바꿔도 `.card`/`.btn-primary`/`.input-field`/`.badge`/`.table-base`(globals.css 내부에서 토큰 참조)가 일괄 전환. 단, **인라인 하드코딩 hex(242건 #6366f1)는 alias로 안 바뀜** → 단계별 치환 대상(02 참조).

## 3. globals.css 현황 구조 (DC-ANA, 3634줄)
| 레이어 | 위치 | 비고 |
|------|------|------|
| :root 시스템 토큰 | L16~34 | 치환/alias 진입점 |
| :root GPU 토큰 | L2544~2568 | `--gpu-purple:#7c3aed` 이미 존재(이번 비범위) |
| @layer components | L165~604 | `.card .btn-* .input-field .badge .table-base .table-card .app-*` |
| 기능별 flat 클래스 | L841~3631 | 홈/리드/캘린더/일일/SlidePanel/GPU 등 |
| 반응형 미디어쿼리 | L607~890 | `table-card` 모바일 변환 포함 |

## 4. 컴포넌트 영향도 (DC-ANA) — 적용 우선순위 근거
**파급 Top 5 (1단계 공용에서 처리):**
1. **MobileShell** (378줄, 인라인 29개) — `#1e293b` 사이드바 1곳 = **42개 라우트 동시 반영**. nav active/highlight 하드코딩.
2. **NavigationLoader** — 전 페이지 전환 오버레이.
3. **AXLoadingOverlay** — 6파일 중요 액션 로딩.
4. **DynamicTable** — accounts/contacts/deals/admin 공용, `CSSProperties` 상수 집중.
5. **SidebarProfile** — `onMouseEnter`로 style 직접 변경(RISK: 토큰 무효화 → :hover CSS로 리팩터 필요).

## 5. 인라인 style 처리 4패턴 (DC-ANA)
| 패턴 | 예 | 전략 |
|------|----|----|
| 동적 조건부 색 | MobileShell nav active | `data-active`/className 토글 + CSS |
| CSSProperties 상수 | DynamicTable INPUT/BTN | globals.css 유틸로 추출(`.dt-input`) |
| 레이아웃 인라인 | flex/gap/position | **변경 불필요**(약 60%) |
| onMouseEnter mutation | SidebarProfile | `:hover` pseudo로 이동(필수) |

실제 색/보더/radius 대상은 전체 3087건 중 **400~600건**.

## 6. 데이터 밀집 화면 토큰 분기 (C-1, DC-RES)
```
테이블:   컨테이너 .shadow-md + 3px 외곽보더 / 셀 box-shadow 0, border-bottom 1px / thead 4px+노랑 / 행 alternating bg
폼:       input .shadow-sm, focus .shadow-md, :focus-visible outline 3px var(--brand) offset 2px
KPI카드:  카드 .shadow-md, 내부 수치는 폰트 위계만(그림자 0)
```

## 7. a11y / 성능 가드 (NFR-1,2)
- 커서: `@media (prefers-reduced-motion:no-preference) and (pointer:fine)`만 커스텀.
- 노이즈: `aria-hidden + pointer-events:none`, **PNG 타일**(풀뷰포트 feTurbulence 금지), `position:fixed`.
- hover: `transform:translate()` GPU만, `transition:transform .15s, box-shadow .1s`(절대 `all` 금지).
- 대비: 노랑 위 검정만(흰 금지), 보더 vs 배경 3:1(1.4.11).

## 8. 회귀 핫스팟 (DC-ANA) — 단계마다 점검
1. MobileShell 인라인(토큰 불투과) 2. SidebarProfile style mutation 3. `#6366f1` 직접 242건 4. `.table-card` 모바일 색상 5. `'use client'`+style hydration 6. GPU 토큰 값 충돌.
