# 부서업무 페이지 디자인 불일치 — 근본원인 분석 (구현 0)

작성 2026-06-08 · 🟦 DC-ANA · 사용자: 분석·보고

## 증상
부서업무(/dept-tasks) 리스트 페이지가 일일업무·주간보고와 달리 밋밋(제목이 브라우저 기본 h1). v0.7.51에서 모달/상세는 표준화했으나 **리스트 페이지 헤더 자체**가 누락.

## 근본 원인 (코드 근거)
1. **페이지 h1 타이포 토큰 미적용**: `DeptTasksClient.tsx:55` `<h1 style={{margin:0}}>` — fontSize/weight/letterSpacing/color 전부 생략 → 브라우저 기본 h1(약 2rem normal). 반면 `weekly-report/page.tsx:200`은 `var(--fs-2xl)·700·letterSpacing -0.03em·var(--text)` 적용. (globals.css에 전역 h1 룰 없음)
2. **콘텐츠 폭 제어 클래스 누락**: daily는 `.daily-page`(max-width:1200px), dept-tasks는 `page-inner`만 → 와이드 화면에서 늘어짐.
3. **tape-title 등 시그니처 요소 부재**: weekly 카드 제목/모달은 `tape-title` 사용, dept-tasks 리스트 헤더엔 없음.

## "공통 모듈인데 왜?" — 진짜 답
**공통 *페이지헤더* 컴포넌트가 코드베이스에 없음**(PageHeader류 미발견). 세 페이지가 헤더를 각자 인라인으로 작성 → 일일/주간은 토큰을 넣었고 부서업무는 안 넣어서 갈림. 즉 "공통 모듈"이 헤더 레벨에는 존재하지 않는 게 원인.
- 공통으로 존재하는 것: `.card`·`tape-title`·`btn-*`·디자인토큰·NbButton/Badge.
- 미채택: `NbCard`(정의돼 있으나 member 페이지 사용처 0).

## 정합화 수정 범위 (향후 — 이번엔 구현 안 함)
- 권장(근본): **공용 `PageHeader` 컴포넌트 신설**(title+desc+actions, `--fs-2xl/700/letterSpacing`) → 일일/주간/부서업무 3페이지가 동일 사용.
- 최소(임시): `DeptTasksClient.tsx:55` h1에 weekly와 동일 토큰 세트 부여 + 콘텐츠 max-width 클래스.
- 변경 파일: DeptTasksClient.tsx (+ globals.css max-width, + 신설 시 components/ui/PageHeader.tsx).

## 정책 반영
CLAUDE.md 디자인 시스템 정책 §2-3(페이지 헤더 표준) 신설 — 페이지 제목은 토큰/공용 헤더 사용, raw h1 금지.
