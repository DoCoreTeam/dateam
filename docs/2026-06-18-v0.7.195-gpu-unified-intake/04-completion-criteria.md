# 04 — Completion Criteria (라인별 ✅/❌)

## 기능
- [x] C1 입력 단일 드롭존 1곳 통합(②③ 시각 분리 제거)
- [x] C2 드롭존이 텍스트·이미지·PDF·xlsx/xls·csv·URL 수용(accept 포함)
- [x] C3 classifyFile SSOT 자동 라우팅(이미지/PDF/텍스트→stream, xlsx→catalog, csv→csv-intake)
- [x] C4 multipart 전송 + 이미지 다운스케일 → base64 인플레 제거(4.5MB 실패 해소)
- [x] C5 상한 초과 파일 = 명확 안내 에러(무음 실패 없음)
- [x] C6 장식 배지 혼란 제거

## 품질/게이트
- [x] C7 tsc 그린
- [x] C8 next build 그린(React18 실빌드)
- [x] C9 design:check 통과
- [x] C10 node --test 그린(intake-routing.test 포함, 신규 테스트 package.json 등록)
- [x] C11 직접 Playwright 자가검증 5경로 + 스크린샷(사용자 필수 지시)
- [x] C12 DC-QA(HIGH+ 0) / DC-SEC(통과) / DC-REV(80+)
- [x] C13 GATE 1-5
- [x] C14 버전 v0.7.195 4파일 동기화(root+web package.json, CLAUDE.md, AGENTS.md)
- [x] C15 로컬 커밋(메시지 `v0.7.195: … claude`) — push/publish 제외

## 비범위 확인
- [x] N1 Storage 직업로드는 미래로 문서화(구현 안 함)
- [x] N2 검토대기/게이트 로직 무변경
