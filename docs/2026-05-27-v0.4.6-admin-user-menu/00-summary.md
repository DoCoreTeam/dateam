# FAST PATH Summary
작업: admin 사이드바 하단 사용자 프로필 클릭 시 드롭업 메뉴 (멤버 화면 전환 + 로그아웃)
대상: apps/web/components/ui/AdminUserMenu.tsx (신규), apps/web/app/admin/layout.tsx
이유: 헤더 우측 분산된 "← 멤버 화면" + 로그아웃 버튼을 하단 프로필 메뉴로 일원화
영향: MobileShell.tsx footer prop 수신부 변경 없음, adminHref prop 제거 (footer 메뉴로 대체)
