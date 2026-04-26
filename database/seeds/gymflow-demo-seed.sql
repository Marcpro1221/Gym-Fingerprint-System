INSERT INTO membership_plans (
  plan_code,
  plan_name,
  duration_days,
  price,
  status_on_enroll,
  action_label,
  description,
  sort_order
)
VALUES
  (
    'MONTHLY',
    'Monthly Payment',
    30,
    1999.00,
    'active',
    'View',
    'Standard monthly gym membership.',
    1
  ),
  (
    'DAY_PASS',
    'Single Day Access',
    1,
    250.00,
    'day_pass',
    'View',
    'Valid until the gym closes for the day.',
    2
  )
ON CONFLICT (plan_code) DO UPDATE
SET
  plan_name = EXCLUDED.plan_name,
  duration_days = EXCLUDED.duration_days,
  price = EXCLUDED.price,
  status_on_enroll = EXCLUDED.status_on_enroll,
  action_label = EXCLUDED.action_label,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

INSERT INTO members (
  member_id,
  full_name,
  mobile_number,
  member_status,
  current_action,
  registered_at,
  last_scan_at,
  last_visit_at
)
VALUES
  ('GYM-1012', 'Nicole Tan', '09171234567', 'active', 'View', NOW() - INTERVAL '75 days', NOW() - INTERVAL '10 minutes', NOW() - INTERVAL '10 minutes'),
  ('GYM-1048', 'Joaquin Ramos', '09181234567', 'expired', 'Renew', NOW() - INTERVAL '120 days', NOW() - INTERVAL '18 minutes', NOW() - INTERVAL '18 minutes'),
  ('GYM-1104', 'Alyssa Luna', '09191234567', 'renewal_due', 'View', NOW() - INTERVAL '40 days', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'),
  ('GYM-0990', 'Marcus Delos Santos', '09201234567', 'active', 'View', NOW() - INTERVAL '150 days', NOW() - INTERVAL '7 minutes', NOW() - INTERVAL '7 minutes'),
  ('GYM-0872', 'Bea Gutierrez', '09211234567', 'day_pass', 'View', NOW() - INTERVAL '1 day', NOW() - INTERVAL '11 minutes', NOW() - INTERVAL '11 minutes'),
  ('GYM-1135', 'Karl Torres', '09221234567', 'on_hold', 'View', NOW() - INTERVAL '90 days', NOW() - INTERVAL '11 days', NOW() - INTERVAL '11 days')
ON CONFLICT (member_id) DO UPDATE
SET
  full_name = EXCLUDED.full_name,
  mobile_number = EXCLUDED.mobile_number,
  member_status = EXCLUDED.member_status,
  current_action = EXCLUDED.current_action,
  last_scan_at = EXCLUDED.last_scan_at,
  last_visit_at = EXCLUDED.last_visit_at,
  updated_at = NOW();

WITH seeded_members AS (
  SELECT id, member_id
  FROM members
  WHERE member_id IN ('GYM-1012', 'GYM-1048', 'GYM-1104', 'GYM-0990', 'GYM-0872', 'GYM-1135')
)
INSERT INTO member_subscriptions (
  member_id,
  plan_id,
  subscription_status,
  started_at,
  expires_at,
  amount_paid,
  is_current
)
SELECT
  member.id,
  plan.id,
  CASE member.member_id
    WHEN 'GYM-1048' THEN 'expired'::subscription_status
    WHEN 'GYM-1135' THEN 'cancelled'::subscription_status
    ELSE 'active'::subscription_status
  END,
  CASE member.member_id
    WHEN 'GYM-0872' THEN NOW() - INTERVAL '1 day'
    ELSE NOW() - INTERVAL '20 days'
  END,
  CASE member.member_id
    WHEN 'GYM-1012' THEN DATE_TRUNC('day', NOW()) + INTERVAL '24 days'
    WHEN 'GYM-1048' THEN DATE_TRUNC('day', NOW()) - INTERVAL '5 days'
    WHEN 'GYM-1104' THEN DATE_TRUNC('day', NOW()) + INTERVAL '3 days'
    WHEN 'GYM-0990' THEN DATE_TRUNC('day', NOW()) + INTERVAL '47 days'
    WHEN 'GYM-0872' THEN DATE_TRUNC('day', NOW()) + INTERVAL '21 hours'
    WHEN 'GYM-1135' THEN DATE_TRUNC('day', NOW()) - INTERVAL '7 days'
  END,
  CASE plan.plan_code
    WHEN 'DAY_PASS' THEN 250.00
    ELSE 1999.00
  END,
  TRUE
FROM seeded_members AS member
JOIN membership_plans AS plan
  ON plan.plan_code = CASE
    WHEN member.member_id = 'GYM-0872' THEN 'DAY_PASS'
    ELSE 'MONTHLY'
  END
WHERE NOT EXISTS (
  SELECT 1
  FROM member_subscriptions AS subscription
  WHERE subscription.member_id = member.id
    AND subscription.is_current = TRUE
);

WITH seeded_members AS (
  SELECT id, member_id
  FROM members
  WHERE member_id IN ('GYM-1012', 'GYM-1048', 'GYM-1104', 'GYM-0990', 'GYM-0872', 'GYM-1135')
)
INSERT INTO fingerprints (
  member_id,
  finger_label,
  template_format,
  template_version,
  template_hash,
  template_data_base64,
  capture_payload,
  reader_serial,
  capture_mode,
  capture_quality
)
SELECT
  member.id,
  'RIGHT_INDEX',
  'demo-capture-payload',
  'v1',
  ENCODE(DIGEST(member.member_id || '-demo-template', 'sha256'), 'hex'),
  ENCODE(CONVERT_TO(member.member_id || ':demo-template', 'UTF8'), 'base64'),
  JSONB_BUILD_OBJECT(
    'seed', TRUE,
    'memberId', member.member_id,
    'note', 'Demo fingerprint payload stored until a DigitalPersona template extractor is added.'
  ),
  'DP4500-DEMO',
  'seed-demo',
  'DP_QUALITY_GOOD'
FROM seeded_members AS member
WHERE NOT EXISTS (
  SELECT 1
  FROM fingerprints AS fingerprint
  WHERE fingerprint.member_id = member.id
);

WITH latest_scan AS (
  SELECT
    member.id AS member_uuid,
    member.member_id AS member_code,
    fingerprint.id AS fingerprint_id,
    CASE member.member_id
      WHEN 'GYM-1048' THEN 'expired'::scan_match_status
      ELSE 'matched'::scan_match_status
    END AS match_status,
    CASE member.member_id
      WHEN 'GYM-1048' THEN 'blocked'::attendance_result
      WHEN 'GYM-1135' THEN 'blocked'::attendance_result
      ELSE 'granted'::attendance_result
    END AS attendance_result,
    CASE member.member_id
      WHEN 'GYM-1012' THEN NOW() - INTERVAL '10 minutes'
      WHEN 'GYM-1048' THEN NOW() - INTERVAL '18 minutes'
      WHEN 'GYM-1104' THEN NOW() - INTERVAL '1 day'
      WHEN 'GYM-0990' THEN NOW() - INTERVAL '7 minutes'
      WHEN 'GYM-0872' THEN NOW() - INTERVAL '11 minutes'
      WHEN 'GYM-1135' THEN NOW() - INTERVAL '11 days'
    END AS logged_at
  FROM members AS member
  JOIN fingerprints AS fingerprint
    ON fingerprint.member_id = member.id
  WHERE member.member_id IN ('GYM-1012', 'GYM-1048', 'GYM-1104', 'GYM-0990', 'GYM-0872', 'GYM-1135')
)
INSERT INTO scan_events (
  scan_reference,
  matched_member_id,
  fingerprint_id,
  match_status,
  capture_success,
  reader_serial,
  capture_mode,
  capture_payload,
  captured_at,
  resolved_at
)
SELECT
  'SEED-' || member_code,
  member_uuid,
  fingerprint_id,
  match_status,
  TRUE,
  'DP4500-DEMO',
  'seed-demo',
  JSONB_BUILD_OBJECT('seed', TRUE, 'memberId', member_code),
  logged_at,
  logged_at
FROM latest_scan
ON CONFLICT (scan_reference) DO NOTHING;

WITH attendance_seed AS (
  SELECT
    member.id AS member_id,
    member.member_id,
    fingerprint.id AS fingerprint_id,
    subscription.expires_at,
    plan.plan_name,
    event.id AS scan_event_id,
    CASE member.member_status
      WHEN 'expired' THEN 'Renew'
      ELSE 'View'
    END AS action_label,
    CASE member.member_status
      WHEN 'active' THEN 'Active'
      WHEN 'renewal_due' THEN 'Due Soon'
      WHEN 'expired' THEN 'Renew'
      WHEN 'day_pass' THEN 'Day Pass'
      WHEN 'on_hold' THEN 'On Hold'
      ELSE 'Inactive'
    END AS status_label,
    CASE member.member_status
      WHEN 'expired' THEN 'blocked'::attendance_result
      WHEN 'on_hold' THEN 'blocked'::attendance_result
      ELSE 'granted'::attendance_result
    END AS result,
    CASE member.member_id
      WHEN 'GYM-1012' THEN NOW() - INTERVAL '10 minutes'
      WHEN 'GYM-1048' THEN NOW() - INTERVAL '18 minutes'
      WHEN 'GYM-1104' THEN NOW() - INTERVAL '1 day'
      WHEN 'GYM-0990' THEN NOW() - INTERVAL '7 minutes'
      WHEN 'GYM-0872' THEN NOW() - INTERVAL '11 minutes'
      WHEN 'GYM-1135' THEN NOW() - INTERVAL '11 days'
    END AS logged_at
  FROM members AS member
  JOIN fingerprints AS fingerprint
    ON fingerprint.member_id = member.id
  JOIN member_subscriptions AS subscription
    ON subscription.member_id = member.id
   AND subscription.is_current = TRUE
  JOIN membership_plans AS plan
    ON plan.id = subscription.plan_id
  JOIN scan_events AS event
    ON event.scan_reference = 'SEED-' || member.member_id
  WHERE member.member_id IN ('GYM-1012', 'GYM-1048', 'GYM-1104', 'GYM-0990', 'GYM-0872', 'GYM-1135')
)
INSERT INTO attendance_logs (
  member_id,
  fingerprint_id,
  scan_event_id,
  logged_at,
  status_label,
  action_label,
  plan_snapshot,
  result,
  source,
  notes
)
SELECT
  member_id,
  fingerprint_id,
  scan_event_id,
  logged_at,
  status_label,
  action_label,
  plan_name,
  result,
  'seed-data',
  'Seeded attendance sample for the member directory view.'
FROM attendance_seed
WHERE NOT EXISTS (
  SELECT 1
  FROM attendance_logs AS log
  WHERE log.scan_event_id = attendance_seed.scan_event_id
);

SELECT SETVAL(
  'member_id_sequence',
  GREATEST(
    COALESCE(
      (
        SELECT MAX(SUBSTRING(member_id FROM 'GYM-(\d+)$')::INTEGER)
        FROM members
      ),
      1199
    ),
    1199
  ),
  TRUE
);
