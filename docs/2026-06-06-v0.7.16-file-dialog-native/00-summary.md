# 파일 다이얼로그 — label 네이티브 패턴 전환
작업: 📎/📷 프로그래매틱 fileInputRef.click() → <label htmlFor> + visually-hidden input
대상: LeadIntakeForm.tsx, globals.css(.visually-hidden·.intake-tool-label-disabled)
이유: 프로그래매틱 .click()이 실제 브라우저에서 다이얼로그 미오픈(Playwright 거짓양성). label은 브라우저 네이티브로 보장.
영향: 프론트 2파일 / 음성·드롭·붙여넣기·xlsx 무변경
검증: label↔input id 연결 구조 확인. 다이얼로그 오픈은 Playwright 거짓양성이라 사용자 실확인 필요. DC-REV 88/100.
