# FAST PATH Summary
작업: target_date 배지에 단계별 맥락 언어 추가 (착수→중반→진행 중→마무리 준비→마무리 필요→오늘 마감→기한 초과)
대상: apps/web/lib/dday.ts (신규), apps/web/app/(member)/daily/page.tsx, apps/web/app/(member)/daily/LogFlowView.tsx
이유: 남은 기간에 따라 업무 단계 언어를 표시해 긴박감/맥락 전달
영향: DdayBadge 공용 컴포넌트로 단일 소스화 — 타임존 불일치 수정 포함
