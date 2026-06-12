-- 088: review_items.channel CHECK에 'market_link' 추가
-- 경쟁사 가격 동기화(market/sync-cost)가 변경된 시장가를 검토 대기(review_items)로 등록할 때
-- channel='market_link'를 사용 → 승인(commit) 시 supply_quotes.source_format='market_link'(추종가)로 확정.
-- 기존 채널(mail/msg/pdf/img/own) 보존. 멱등(DROP/ADD).

ALTER TABLE review_items DROP CONSTRAINT IF EXISTS review_items_channel_check;
ALTER TABLE review_items ADD CONSTRAINT review_items_channel_check
  CHECK (channel = ANY (ARRAY['mail', 'msg', 'pdf', 'img', 'own', 'market_link']));
