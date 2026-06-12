# v0.7.87 — 모바일 '관리자 패널' 메뉴 글씨 안 보임 수정 (FAST PATH)
작업: MobileShell 모바일 admin 버튼 글씨색 var(--sidebar-fg)→var(--text)
대상: components/ui/MobileShell.tsx (admin 링크 color)
이유: 버튼 배경은 var(--nb-white)(테마무관 흰색) 고정인데 글씨가 var(--sidebar-fg)였음. sidebar-fg는 다크 테마에서 #e2e8f0(밝은회색)으로 바뀌어 '흰 배경+밝은 글씨'→안 보임. --text는 테마 오버라이드 없이 항상 #0f172a(어두움)이라 모든 테마에서 가시.
영향: 모바일 사이드바 관리자 패널 버튼만. 데스크탑 SidebarProfile은 이미 var(--text)로 정상.
