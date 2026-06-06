# good.html(Neo-brutalism) 디자인 → 홈 대시보드 클론 (test.html 재생성)

> 작업일: 2026-06-06 · v0.7.25 · 산출물: `test.html`(독립 프리뷰, 실서비스 비반영)
> 이전 Paper Workspace(seti) 버전을 good.html 기반으로 **대체**.

## 1. `good.html` 디자인시스템 분석 — Neo-brutalism

**컨셉:** 하드 보더 + 오프셋 하드 섀도 + 종이 질감. "두껍게 인쇄한 종이 위젯" 느낌.

### 토큰 (Tailwind config + CSS 변수)
| 범주 | 값 | 의미 |
|------|----|----|
| base | `#f8f8f6` | 본문 배경(크림) |
| cream-paper | `#efede8` | 사이드바/캔버스 |
| main | `#0a0a0a` | 잉크 블랙(보더·텍스트) |
| yellow | `#fcd34d` | 액센트(테이프·활성) |
| brand | `#7c3aed` | 퍼플(주요 액션) |
| boxShadow.hard | `4px 4px 0 #0a0a0a` | 오프셋 하드 그림자(핵심) |
| borderWidth.3 | `3px` | 두꺼운 보더 |
| font sans | Pretendard | 본문 |
| font tape | Nanum Pen Script | 손글씨 테이프 |

### 시그니처 4요소
1. **하드 오프셋 섀도** (`shadow-hard`) — 모든 카드/버튼이 종이처럼 떠 있음. hover 시 눌리는 인터랙션.
2. **3px 잉크 보더** — 모든 요소 검은 테두리.
3. **테이프 라벨** (`.tape-label`) — 카드 상단에 노란 테이프 + 회전 + 하드 섀도 + 손글씨 폰트.
4. **종이 질감** — 도트 그리드(`.paper-grid`) + 노이즈 오버레이(`.noise-bg`) + 커스텀 커서(화살표).

## 2. newAX 적용
good.html은 이미 newAX 홈 정보구조를 클론한 상태 → 그대로 채택하되 정제.
- 사이드바: 데이터얼라이언스 + 홈/일일업무/캘린더/주간보고 + 프로젝트관리/가격정책(GPU·판매가격표) + 유저 펄
- 헤더: 인사 + 날짜 + KPI/루틴/본부 운영 칩 + 전체 메뉴
- 3카드: 오늘 업무(입력+체크리스트) · 확인 안 한 메모(5) · 주간보고
- 하단: 월 캘린더(오늘 6일 강조)

## 3. 산출물 (`test.html`)
- `good.html`에서 에디터 잔여 속성(`vid="..."`) 제거 + `<!DOCTYPE html>` + 프리뷰 주석/플래그 추가한 **클린 standalone**.
- 디자인/구조/데이터는 good.html 충실 보존.
- 런타임 의존: Tailwind CDN(3.4.17) + Pretendard CDN + Google Fonts(Nanum Pen Script). 프리뷰 전용.

## 4. 비범위
- `apps/web/**`·`globals.css`·라우트·DB **변경 0**. test.html은 어디서도 import/링크 안 됨.

## 5. 완료 기준
- [x] test.html 단독 실행 시 4대 시그니처(하드섀도/3px보더/테이프라벨/종이질감) 표현
- [x] 홈 정보구조(인사·KPI칩·오늘업무·메모·주간보고·캘린더) 반영
- [x] vid 잔여 0 · DOCTYPE/프리뷰 플래그 포함
- [x] 실서비스 파일 변경 0 (git status 검증)
