CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  CREATE TYPE member_status AS ENUM (
    'active',
    'renewal_due',
    'expired',
    'day_pass',
    'on_hold',
    'inactive'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE subscription_status AS ENUM (
    'active',
    'expired',
    'cancelled',
    'pending'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE fingerprint_template_format AS ENUM (
    'digitalpersona-template',
    'ansi-raw-image',
    'demo-capture-payload'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE scan_match_status AS ENUM (
    'matched',
    'no_match',
    'expired',
    'not_captured',
    'registered'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE attendance_result AS ENUM (
    'granted',
    'blocked',
    'registered'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE SEQUENCE IF NOT EXISTS member_id_sequence
  START WITH 1200
  INCREMENT BY 1
  MINVALUE 1000;

CREATE TABLE IF NOT EXISTS membership_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_code VARCHAR(40) NOT NULL UNIQUE,
  plan_name VARCHAR(120) NOT NULL,
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  price NUMERIC(10, 2) NOT NULL DEFAULT 0,
  status_on_enroll member_status NOT NULL DEFAULT 'active',
  action_label VARCHAR(120) NOT NULL,
  description TEXT,
  sort_order SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id VARCHAR(20) NOT NULL UNIQUE,
  full_name VARCHAR(140) NOT NULL,
  mobile_number VARCHAR(25) NOT NULL,
  member_status member_status NOT NULL DEFAULT 'active',
  current_action VARCHAR(120) NOT NULL DEFAULT 'View',
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_scan_at TIMESTAMPTZ,
  last_visit_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS member_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  plan_id UUID NOT NULL REFERENCES membership_plans(id),
  subscription_status subscription_status NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  amount_paid NUMERIC(10, 2) NOT NULL DEFAULT 0,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS member_subscriptions_current_member_idx
  ON member_subscriptions(member_id)
  WHERE is_current = TRUE;

CREATE TABLE IF NOT EXISTS fingerprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  finger_label VARCHAR(40) NOT NULL DEFAULT 'RIGHT_INDEX',
  template_format fingerprint_template_format NOT NULL DEFAULT 'demo-capture-payload',
  template_version VARCHAR(40),
  template_hash VARCHAR(128),
  template_data_base64 TEXT,
  capture_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  reader_serial VARCHAR(120),
  capture_mode VARCHAR(80),
  capture_quality VARCHAR(80),
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS fingerprints_template_hash_idx
  ON fingerprints(template_hash)
  WHERE template_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS scan_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_reference VARCHAR(40) NOT NULL UNIQUE,
  matched_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  fingerprint_id UUID REFERENCES fingerprints(id) ON DELETE SET NULL,
  match_status scan_match_status NOT NULL,
  capture_success BOOLEAN NOT NULL DEFAULT FALSE,
  reader_serial VARCHAR(120),
  capture_mode VARCHAR(80),
  capture_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS attendance_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES members(id) ON DELETE SET NULL,
  fingerprint_id UUID REFERENCES fingerprints(id) ON DELETE SET NULL,
  scan_event_id UUID REFERENCES scan_events(id) ON DELETE SET NULL,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status_label VARCHAR(40) NOT NULL,
  action_label VARCHAR(120) NOT NULL,
  plan_snapshot VARCHAR(120),
  result attendance_result NOT NULL,
  source VARCHAR(50) NOT NULL DEFAULT 'fingerprint-scan',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS attendance_logs_member_logged_at_idx
  ON attendance_logs(member_id, logged_at DESC);

CREATE INDEX IF NOT EXISTS scan_events_captured_at_idx
  ON scan_events(captured_at DESC);

DROP TRIGGER IF EXISTS membership_plans_set_updated_at ON membership_plans;
CREATE TRIGGER membership_plans_set_updated_at
BEFORE UPDATE ON membership_plans
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS members_set_updated_at ON members;
CREATE TRIGGER members_set_updated_at
BEFORE UPDATE ON members
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS member_subscriptions_set_updated_at ON member_subscriptions;
CREATE TRIGGER member_subscriptions_set_updated_at
BEFORE UPDATE ON member_subscriptions
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS fingerprints_set_updated_at ON fingerprints;
CREATE TRIGGER fingerprints_set_updated_at
BEFORE UPDATE ON fingerprints
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE VIEW member_directory_view AS
WITH current_subscription AS (
  SELECT DISTINCT ON (subscription.member_id)
    subscription.member_id,
    plan.plan_code,
    plan.plan_name,
    plan.action_label,
    subscription.subscription_status,
    subscription.started_at,
    subscription.expires_at,
    subscription.amount_paid
  FROM member_subscriptions AS subscription
  JOIN membership_plans AS plan
    ON plan.id = subscription.plan_id
  WHERE subscription.is_current = TRUE
  ORDER BY subscription.member_id, subscription.started_at DESC
),
last_attendance AS (
  SELECT
    attendance.member_id,
    MAX(attendance.logged_at) FILTER (WHERE attendance.result = 'granted') AS last_visit_at,
    MAX(attendance.logged_at) AS last_event_at
  FROM attendance_logs AS attendance
  GROUP BY attendance.member_id
)
SELECT
  member.id,
  member.member_id,
  member.full_name,
  member.mobile_number,
  COALESCE(subscription.plan_name, 'No Plan') AS plan_name,
  CASE member.member_status
    WHEN 'active' THEN 'Active'
    WHEN 'renewal_due' THEN 'Due Soon'
    WHEN 'expired' THEN 'Renew'
    WHEN 'day_pass' THEN 'Day Pass'
    WHEN 'on_hold' THEN 'On Hold'
    ELSE 'Inactive'
  END AS status_label,
  COALESCE(last_attendance.last_visit_at, member.last_visit_at, member.registered_at) AS last_visit_at,
  subscription.expires_at,
  member.current_action AS action_label,
  member.registered_at,
  subscription.plan_code,
  subscription.amount_paid
FROM members AS member
LEFT JOIN current_subscription AS subscription
  ON subscription.member_id = member.id
LEFT JOIN last_attendance
  ON last_attendance.member_id = member.id;
