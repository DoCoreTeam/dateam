-- Fix historical lead_intakes records where status='completed' but company_name was not extracted
-- These records were created before the API guard that prevents saving 'completed' with null company_name
UPDATE lead_intakes
SET status = 'failed'
WHERE status = 'completed'
  AND (
    parsed_data->>'company_name' IS NULL
    OR parsed_data->>'company_name' = ''
  );
