# FAST PATH Summary
작업: 사이드바 nav 항목 공용 컴포넌트 NbNavItem 추출(인라인 스타일 중복 제거 + active/highlight 규약 단일화)
대상: components/ui/nb/NbNavItem.tsx(신규), components/ui/MobileShell.tsx(메인 ul·그룹 ul 치환)
이유: 메인/그룹 nav가 인라인 스타일 중복 + 그룹 active만 구버전(accent 채움)이라 규약 갈라짐 → SSOT 통일
영향: 메인·그룹·(admin/member 양 레이아웃) nav 모두 동일 규약(active=아웃라인+좌측바 / highlight=솔리드 CTA). 그룹 active 시각이 채움→아웃라인으로 통일됨. 동작/aria-current/뱃지/firstNavRef 보존. DC-REV APPROVED
