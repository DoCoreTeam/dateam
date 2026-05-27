# 일일업무 관계 시스템 구현 요약
버전: v0.4.9 | 날짜: 2026-05-27

## 작업 내용
daily_logs 테이블 위에 6개 신규 테이블을 추가하여 업무 간 관계(릴레이션)·원본묶음·타겟일·스레드·지식그래프를 구현.

## 수정/추가 파일
- supabase/migrations/022_daily_logs_relations.sql (신규)
- apps/web/types/database.ts (확장)
- apps/web/app/api/ai/analyze-work/route.ts (프롬프트 DB 이전 + origin_group)
- apps/web/app/(member)/daily/actions.ts (스레드·태그·관계 CRUD)
- apps/web/app/(member)/daily/page.tsx (UI 확장)

## 변경 이유
- AI 분석으로 분리된 항목들이 같은 입력에서 왔다는 맥락이 저장 후 소실됨
- 타겟일 개념 부재로 일정 관리 불가
- 하드코딩 프롬프트로 모델 변경 시 코드 배포 필요
- 업무 간 파생 관계 추적 불가

## 영향 범위
- 기존 daily_logs 기능 (이월·편집·삭제): 영향 없음 (컬럼 추가만)
- AI 분석 결과: origin_group_id·target_date 필드 추가
- UI: 타겟일 뱃지·스레드 패널·지식그래프 뷰 추가

## 릴레이션 무결성 보장
- origin_group_id: FK → daily_log_origin_groups (ON DELETE SET NULL)
- parent_log_id: FK → daily_logs self-ref (ON DELETE SET NULL)
- daily_log_relations: UNIQUE(from,to,type) + self-reference 방지 CHECK
- 모든 신규 테이블: RLS 적용
