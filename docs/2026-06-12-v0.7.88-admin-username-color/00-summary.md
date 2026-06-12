# v0.7.88 — 관리자 패널 사용자명 테마 전환 시 안 보임 수정 (FAST PATH)
작업: AdminUserMenu 사용자명 색 var(--border-subtle)→var(--sidebar-fg), 관리자 부제·챕런도 sidebar-fg+opacity
이유: username이 var(--border-subtle)(#cbd5e1 고정 연회색)였는데 관리자 사이드바 배경은 --sidebar-bg로 테마전환(라이트=밝은종이/다크=#1e293b). 라이트 테마서 연회색이 밝은 배경에 묻혀 안 보임. 사이드바 배경과 짝인 --sidebar-fg로 바꿔 전 테마 가시.
영향: 관리자 사이드바 푸터 사용자 메뉴.
