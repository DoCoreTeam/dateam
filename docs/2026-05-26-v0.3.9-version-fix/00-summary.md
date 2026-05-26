# FAST PATH Summary

작업: 사이드바 버전 표시 불일치 수정 + 정책 수립
대상: package.json (루트), apps/web/package.json, CLAUDE.md
이유: 실제 버전 소스인 루트 package.json이 0.3.6, 웹 패키지가 0.3.7로 두 개가 뒤처져 있었음
영향: 사이드바 버전 표시 v0.3.6 → v0.3.9로 정상화

## 근본 원인
`apps/web/next.config.js:2` — `require('../../package.json').version`을 읽어
빌드 타임에 `NEXT_PUBLIC_APP_VERSION`으로 주입한다.
루트 `package.json.version`이 단일 소스이며, 이것이 0.3.6으로 방치되어 있었음.

## 변경 내역
- /package.json: "version" 0.3.6 → 0.3.9
- /apps/web/package.json: "version" 0.3.7 → 0.3.9
- /apps/web/.env.local: 혼선 유발하던 NEXT_PUBLIC_APP_VERSION 라인 제거
- /CLAUDE.md: 버전 업데이트 체크리스트 추가 (정확한 소스 문서화)
