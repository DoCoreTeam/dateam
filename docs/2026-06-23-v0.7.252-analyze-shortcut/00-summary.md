# AI 분석 단축키 — v0.7.252 (FAST)
작업: 통합입력 textarea에서 ⌘+Enter(맥)/Ctrl+Enter(윈도우)로 "AI 분석 시작" 즉시 실행.
대상: QuoteRegisterTab.tsx (onKeyDown metaKey||ctrlKey+Enter, isMac 감지로 힌트 ⌘/Ctrl 분기).
이유: 마우스 없이 빠른 분석. OS별 단축키 표기 구분.
영향: FE만. tsc0·design·next build 통과.
