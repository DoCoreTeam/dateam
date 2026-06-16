-- 112_drop_project_members.sql
-- 사용자 요청으로 프로젝트 '투입인원(멤버)' 기능 제거 → 신규 빈 테이블 정리.
-- mig111에서 오늘 생성된 빈 테이블(members 0)이라 데이터 손실 없음. 가역(mig111 블록 재실행으로 복원).
DROP TABLE IF EXISTS project_members CASCADE;
