-- 261_drop_backup_tables.sql — 백업 사본 여섯 개를 지운다
--
-- 배경: 2026-09-13 보안 경보로 드러난 RLS 꺼진 표 여덟 중 다섯이 백업 사본이었다.
-- 259 가 잠그기는 했지만 잠근 것과 없앤 것은 다르다.
-- 남아 있는 한 다음 사람이 「원래 이렇게 쌓아 두는 것」으로 읽고 같은 방식으로 또 뜬다.
--
-- 지우기 전에 확인한 것
--   ① 앱 코드 참조 0건 (남은 언급은 옛 마이그레이션과 주석뿐)
--   ② 여섯 표를 CSV 로 뽑고 **행 수를 DB 와 대조**해 전부 일치
--      1134 / 1685 / 11 / 14 / 21 / 353
--      둔 곳: ~/AX사업본부/_db-backup-20260920/ (저장소 밖, 리드 사본에 개인정보가 있다)
--
-- 되돌리기: 위 CSV 를 다시 넣는다. 표 구조는 아래 주석의 원본 표에서 가져온다.
--   lead_intakes_dup_backup_20260817  <- lead_intakes (205 에서 뜸)
--   ci_reclassify_backup_20260827     <- ci_contents 재분류 전 스냅샷
--   ci_topic_rules_backup_20260827    <- ci_topic_rules
--   _bak_ci_channels_20260811         <- ci_channels
--   _bak_ci_contents_ch_20260811      <- ci_contents 의 채널 칼럼
--   gpu_products_dedup_backup_20260622 <- gpu_products (129·130 에서 뜸)

DROP TABLE IF EXISTS public.lead_intakes_dup_backup_20260817;
DROP TABLE IF EXISTS public.ci_reclassify_backup_20260827;
DROP TABLE IF EXISTS public.ci_topic_rules_backup_20260827;
DROP TABLE IF EXISTS public._bak_ci_channels_20260811;
DROP TABLE IF EXISTS public._bak_ci_contents_ch_20260811;
DROP TABLE IF EXISTS public.gpu_products_dedup_backup_20260622;
