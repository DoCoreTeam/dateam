# FAST PATH Summary — 부서업무 UI 표준화
작업: 부서업무 폼/모달을 통합 디자인 표준(input-field/label/EventModal 패턴)으로 정렬
대상:
- DeptTaskFormModal.tsx — useEscClose·X버튼·tape-title·광원형shadow·backdrop(rgba(15,23,42,0.55)) + 모든 input/select/textarea에 input-field, label에 label 클래스
- DeptTaskDetail.tsx — 담당자 select·댓글 input에 input-field, label 클래스
이유: v0.7.49 부서업무 모달이 표준 클래스 누락으로 브라우저 기본 렌더(밋밋) → 캘린더 등과 불일치 (DC-ANA 진단, CLAUDE.md §2-1/§2-2 정책화)
영향: 스타일만. 로직/서버액션/DB 무변경. design:check·tsc 통과
