# 리드인테이크 입력 통합
작업: LeadIntakeForm 3탭(텍스트/명함·문서/음성) → 단일 입력 영역 통합
대상: LeadIntakeForm.tsx, globals.css(.intake-unified·.intake-tool-btn)
이유: 음성=텍스트 입력수단, 파일=같은 백엔드, parse가 content-type 자동분기(이미 통합)인데 프론트만 분리 — 불필요
영향: 프론트 1파일 + CSS / 백엔드 무변경
검증: 탭 0개·단일 textarea·도구버튼(📎📷🎤)·텍스트 분석 라이브 정상. DC-REV HIGH(result 잔존)+MEDIUM(터치44px) 반영. xlsx 대량·음성·CRM생성 전부 보존.
