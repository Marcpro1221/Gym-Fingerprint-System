"use strict";

const { createHash, randomUUID } = require("node:crypto");
const { query, withTransaction } = require("../../db/postgres");

const PLAN_CODE_DEFAULT = "MONTHLY";
const FINGER_LABEL_DEFAULT = "RIGHT_INDEX";
const MATCHED_SCAN_THRESHOLD = Math.floor(0x7fffffff / 100000);
const MEMBERSHIP_TEST_WINDOW_ENABLED = !["false", "0", "off", "no"].includes(
  String(process.env.TEST_MEMBERSHIP_SHORT_WINDOW || "true")
    .trim()
    .toLowerCase()
);
const MEMBERSHIP_TEST_EXPIRY_MINUTES = Math.max(
  0,
  Number(process.env.TEST_MEMBERSHIP_EXPIRY_MINUTES || 2)
);
const MEMBERSHIP_TEST_DUE_SOON_MINUTES = Math.max(
  0,
  Number(process.env.TEST_MEMBERSHIP_DUE_SOON_MINUTES || 1)
);
const MEMBERSHIP_TEST_DAY_PASS_EXPIRY_MINUTES = Math.max(
  0,
  Number(process.env.TEST_DAY_PASS_EXPIRY_MINUTES || 1)
);
const ANSI_FINGER_POSITIONS = {
  UNKNOWN: 0,
  RIGHT_THUMB: 1,
  RIGHT_INDEX: 2,
  RIGHT_MIDDLE: 3,
  RIGHT_RING: 4,
  RIGHT_LITTLE: 5,
  LEFT_THUMB: 6,
  LEFT_INDEX: 7,
  LEFT_MIDDLE: 8,
  LEFT_RING: 9,
  LEFT_LITTLE: 10
};
const DIRECTORY_QUERY = `
  SELECT
    directory.id,
    directory.member_id,
    directory.full_name,
    directory.mobile_number,
    directory.plan_name,
    directory.status_label,
    directory.last_visit_at,
    directory.expires_at,
    directory.action_label,
    directory.registered_at,
    directory.plan_code,
    directory.amount_paid,
    (
      SELECT subscription.started_at
      FROM member_subscriptions AS subscription
      WHERE subscription.member_id = directory.id
        AND subscription.is_current = TRUE
      ORDER BY subscription.started_at DESC
      LIMIT 1
    ) AS subscription_started_at,
    member.last_scan_at
  FROM member_directory_view AS directory
  JOIN members AS member
    ON member.id = directory.id
`;

const normalizePlanCode = (value) => {
  const normalized = String(value || PLAN_CODE_DEFAULT)
    .trim()
    .replace(/\s+/g, "_")
    .toUpperCase();

  return normalized || PLAN_CODE_DEFAULT;
};

const normalizePhone = (value) => String(value || "").replace(/[^\d+]/g, "").trim();

const normalizeFingerLabel = (value) => {
  const normalized = String(value || FINGER_LABEL_DEFAULT)
    .trim()
    .replace(/\s+/g, "_")
    .toUpperCase();

  return normalized || FINGER_LABEL_DEFAULT;
};

const resolveMembershipStartDate = (value, fallback = new Date()) => {
  if (!value) {
    return fallback;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
  if (!match) {
    throw new Error("Member starting date must use the YYYY-MM-DD format.");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const resolved = new Date(year, month - 1, day, 0, 0, 0, 0);

  if (
    Number.isNaN(resolved.getTime()) ||
    resolved.getFullYear() !== year ||
    resolved.getMonth() !== month - 1 ||
    resolved.getDate() !== day
  ) {
    throw new Error("Member starting date is invalid.");
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (resolved.getTime() > today.getTime()) {
    throw new Error("Member starting date cannot be in the future.");
  }

  return resolved;
};

const titleCaseStatus = (value) => {
  if (!value) {
    return "Inactive";
  }

  if (value === "renewal_due") {
    return "Due Soon";
  }

  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const shouldUseMembershipTestWindow = (planCode) =>
  MEMBERSHIP_TEST_WINDOW_ENABLED &&
  planCode !== "DAY_PASS" &&
  MEMBERSHIP_TEST_EXPIRY_MINUTES > 0;

const shouldUseDayPassTestWindow = (planCode) =>
  MEMBERSHIP_TEST_WINDOW_ENABLED &&
  planCode === "DAY_PASS" &&
  MEMBERSHIP_TEST_DAY_PASS_EXPIRY_MINUTES > 0;

const shouldUseImmediateTestWindow = (planCode) =>
  shouldUseMembershipTestWindow(planCode) ||
  shouldUseDayPassTestWindow(planCode);

const resolveSubscriptionStartAt = (
  planCode,
  membershipStartAt,
  now = new Date()
) =>
  shouldUseImmediateTestWindow(planCode)
    ? new Date(now)
    : membershipStartAt;

const buildExpiryDate = (planCode, durationDays, now) => {
  const expiryDate = new Date(now);

  if (shouldUseDayPassTestWindow(planCode)) {
    expiryDate.setMinutes(
      expiryDate.getMinutes() + MEMBERSHIP_TEST_DAY_PASS_EXPIRY_MINUTES
    );
    return expiryDate;
  }

  if (planCode === "DAY_PASS") {
    expiryDate.setHours(21, 0, 0, 0);
    if (expiryDate <= now) {
      expiryDate.setDate(expiryDate.getDate() + 1);
    }
    return expiryDate;
  }

  if (shouldUseMembershipTestWindow(planCode)) {
    expiryDate.setMinutes(expiryDate.getMinutes() + MEMBERSHIP_TEST_EXPIRY_MINUTES);
    return expiryDate;
  }

  expiryDate.setDate(expiryDate.getDate() + durationDays);
  return expiryDate;
};

const resolveEffectiveExpiryDate = ({
  planCode,
  startedAt,
  expiryDate
}) => {
  const parsedStartDate = startedAt ? new Date(startedAt) : null;

  if (
    shouldUseMembershipTestWindow(planCode) &&
    parsedStartDate instanceof Date &&
    !Number.isNaN(parsedStartDate.getTime())
  ) {
    return buildExpiryDate(planCode, 0, parsedStartDate);
  }

  const parsedExpiryDate = expiryDate ? new Date(expiryDate) : null;
  if (
    parsedExpiryDate instanceof Date &&
    !Number.isNaN(parsedExpiryDate.getTime())
  ) {
    return parsedExpiryDate;
  }

  return null;
};

const deriveMembershipPresentation = (
  { status, action, planCode, startedAt, expiryDate },
  now = new Date()
) => {
  const normalizedStatus = String(status || "").trim().toLowerCase();
  const normalizedPlanCode = String(planCode || "").trim().toUpperCase();
  const expiry = resolveEffectiveExpiryDate({
    planCode,
    startedAt,
    expiryDate
  });
  const hasValidExpiry = expiry instanceof Date && !Number.isNaN(expiry.getTime());

  if (
    normalizedStatus.includes("hold") ||
    normalizedStatus.includes("inactive")
  ) {
    return {
      status,
      action: action || "View"
    };
  }

  if (hasValidExpiry && expiry.getTime() <= now.getTime()) {
    return {
      status: "Expired",
      action: "Renew"
    };
  }

  if (
    hasValidExpiry &&
    MEMBERSHIP_TEST_DUE_SOON_MINUTES > 0 &&
    normalizedPlanCode !== "DAY_PASS"
  ) {
    const dueSoonBoundary = new Date(expiry);
    dueSoonBoundary.setMinutes(
      dueSoonBoundary.getMinutes() - MEMBERSHIP_TEST_DUE_SOON_MINUTES
    );

    if (now.getTime() >= dueSoonBoundary.getTime()) {
      return {
        status: "Due Soon",
        action: action || "View"
      };
    }
  }

  return {
    status,
    action: action || "View"
  };
};

const buildTemplateHash = (templateData, scanPayload) => {
  const payloadSource =
    typeof templateData === "string" && templateData.length > 0
      ? templateData
      : JSON.stringify(scanPayload || {});

  return createHash("sha256").update(payloadSource).digest("hex");
};

const toFiniteInteger = (value, fallback = null) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : fallback;
};

const createStatusError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getFirstObjectEntry = (value) => {
  if (!Array.isArray(value)) {
    return null;
  }

  const firstEntry = value[0];
  return firstEntry && typeof firstEntry === "object" ? firstEntry : null;
};

const getEmbeddedMatcherTemplate = (scanPayload) =>
  scanPayload &&
  typeof scanPayload === "object" &&
  scanPayload.matcherTemplate &&
  typeof scanPayload.matcherTemplate === "object"
    ? scanPayload.matcherTemplate
    : null;

const getPrimaryCaptureView = (scanPayload) => {
  if (!scanPayload || typeof scanPayload !== "object") {
    return null;
  }

  return (
    getFirstObjectEntry(scanPayload.views) ||
    getFirstObjectEntry(scanPayload.baselineViews) ||
    getEmbeddedMatcherTemplate(scanPayload)
  );
};

const getTemplateDataFromScanPayload = (scanPayload) => {
  if (!scanPayload || typeof scanPayload !== "object") {
    return null;
  }

  if (
    typeof scanPayload.fingerprintArtifactBase64 === "string" &&
    scanPayload.fingerprintArtifactBase64.length > 0
  ) {
    return scanPayload.fingerprintArtifactBase64;
  }

  if (
    typeof scanPayload.templateDataBase64 === "string" &&
    scanPayload.templateDataBase64.length > 0
  ) {
    return scanPayload.templateDataBase64;
  }

  if (
    typeof scanPayload.matcherTemplate?.templateDataBase64 === "string" &&
    scanPayload.matcherTemplate.templateDataBase64.length > 0
  ) {
    return scanPayload.matcherTemplate.templateDataBase64;
  }

  return null;
};

const buildMatcherTemplateFromScanPayload = (
  scanPayload,
  fallbackFingerLabel = FINGER_LABEL_DEFAULT
) => {
  const templateDataBase64 = getTemplateDataFromScanPayload(scanPayload);
  const primaryView = getPrimaryCaptureView(scanPayload);
  const embeddedMatcherTemplate = getEmbeddedMatcherTemplate(scanPayload);
  const normalizedFingerLabel = normalizeFingerLabel(fallbackFingerLabel);

  if (!templateDataBase64) {
    return null;
  }

  return {
    templateDataBase64,
    width: toFiniteInteger(
      scanPayload?.width ??
        primaryView?.width ??
        embeddedMatcherTemplate?.width
    ),
    height: toFiniteInteger(
      scanPayload?.height ??
        primaryView?.height ??
        embeddedMatcherTemplate?.height
    ),
    resolution: toFiniteInteger(
      scanPayload?.resolution ??
        scanPayload?.scanResolution ??
        scanPayload?.imageResolution ??
        scanPayload?.fidResolution ??
        embeddedMatcherTemplate?.resolution,
      500
    ),
    cbeffId: toFiniteInteger(
      scanPayload?.cbeffId ?? embeddedMatcherTemplate?.cbeffId,
      0
    ),
    fingerPosition: toFiniteInteger(
      scanPayload?.fingerPosition ??
        primaryView?.fingerPosition ??
        embeddedMatcherTemplate?.fingerPosition,
      ANSI_FINGER_POSITIONS[normalizedFingerLabel] ?? ANSI_FINGER_POSITIONS.UNKNOWN
    )
  };
};

const sanitizeMatcherTemplate = (matcherTemplate) => {
  if (
    !matcherTemplate ||
    typeof matcherTemplate.templateDataBase64 !== "string" ||
    matcherTemplate.templateDataBase64.length === 0
  ) {
    return null;
  }

  const width = toFiniteInteger(matcherTemplate.width);
  const height = toFiniteInteger(matcherTemplate.height);
  const resolution = toFiniteInteger(matcherTemplate.resolution, 500);

  if (!width || !height || !resolution) {
    return null;
  }

  return {
    templateDataBase64: matcherTemplate.templateDataBase64,
    width,
    height,
    resolution,
    cbeffId: toFiniteInteger(matcherTemplate.cbeffId, 0),
    fingerPosition: toFiniteInteger(
      matcherTemplate.fingerPosition,
      ANSI_FINGER_POSITIONS.UNKNOWN
    )
  };
};

const mapDirectoryRow = (row) => {
  const membershipPresentation = deriveMembershipPresentation({
    status: row.status_label,
    action: row.action_label,
    planCode: row.plan_code,
    startedAt: row.subscription_started_at,
    expiryDate: row.expires_at
  });
  const effectiveExpiryDate = resolveEffectiveExpiryDate({
    planCode: row.plan_code,
    startedAt: row.subscription_started_at,
    expiryDate: row.expires_at
  });

  return {
    id: row.id,
    memberId: row.member_id,
    fullName: row.full_name,
    mobileNumber: row.mobile_number,
    plan: row.plan_name,
    planCode: row.plan_code,
    status: membershipPresentation.status,
    lastVisitAt: row.last_visit_at,
    lastScanAt: row.last_scan_at,
    expiryDate: effectiveExpiryDate ? effectiveExpiryDate.toISOString() : row.expires_at,
    action: membershipPresentation.action,
    registeredAt: row.registered_at,
    amountPaid: row.amount_paid
  };
};

const mapPlanRow = (row) => ({
  id: row.id,
  planCode: row.plan_code,
  planName: row.plan_name,
  durationDays: row.duration_days,
  price: Number(row.price),
  statusOnEnroll: row.status_on_enroll,
  actionLabel: row.action_label,
  description: row.description,
  sortOrder: row.sort_order
});

const mapCurrentSubscriptionRow = (row) => ({
  subscriptionId: row.subscription_id,
  planId: row.plan_id,
  planCode: row.plan_code,
  planName: row.plan_name,
  durationDays: row.duration_days,
  price: Number(row.price),
  amountPaid: Number(row.amount_paid),
  description: row.description,
  statusOnEnroll: row.status_on_enroll,
  actionLabel: row.action_label,
  subscriptionStatus: row.subscription_status,
  startedAt: row.started_at,
  expiresAt: (() => {
    const effectiveExpiryDate = resolveEffectiveExpiryDate({
      planCode: row.plan_code,
      startedAt: row.started_at,
      expiryDate: row.expires_at
    });
    return effectiveExpiryDate ? effectiveExpiryDate.toISOString() : row.expires_at;
  })()
});

const buildVisitWindowEnd = (startedAt, expiresAt) => {
  const startedDate = startedAt ? new Date(startedAt) : null;
  const expiryDate = expiresAt ? new Date(expiresAt) : null;

  if (!startedDate || Number.isNaN(startedDate.getTime())) {
    return expiryDate && !Number.isNaN(expiryDate.getTime()) ? expiryDate : null;
  }

  const visitWindowEnd = new Date(startedDate);
  visitWindowEnd.setDate(visitWindowEnd.getDate() + 30);

  if (expiryDate && !Number.isNaN(expiryDate.getTime()) && expiryDate < visitWindowEnd) {
    return expiryDate;
  }

  return visitWindowEnd;
};

const listMembers = async (limit = 100) => {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 250)) : 100;
  const result = await query(
    `${DIRECTORY_QUERY}
     ORDER BY COALESCE(last_scan_at, last_visit_at, registered_at) DESC, full_name ASC
     LIMIT $1`,
    [safeLimit]
  );

  return result.rows.map(mapDirectoryRow);
};

const listMembershipPlans = async () => {
  const result = await query(
    `
      SELECT
        id,
        plan_code,
        plan_name,
        duration_days,
        price,
        status_on_enroll,
        action_label,
        description,
        sort_order
      FROM membership_plans
      ORDER BY sort_order ASC, plan_name ASC
    `
  );

  return result.rows.map(mapPlanRow);
};

const fetchMemberById = async (client, memberUuid) => {
  const result = await client.query(
    `${DIRECTORY_QUERY}
     WHERE directory.id = $1
     LIMIT 1`,
    [memberUuid]
  );

  if (result.rowCount === 0) {
    throw new Error("Registered member could not be loaded from the directory view.");
  }

  return mapDirectoryRow(result.rows[0]);
};

const fetchCurrentSubscriptionByMemberId = async (executor, memberUuid) => {
  const result = await executor.query(
    `
      SELECT
        subscription.id AS subscription_id,
        subscription.plan_id,
        subscription.subscription_status,
        subscription.started_at,
        subscription.expires_at,
        subscription.amount_paid,
        plan.plan_code,
        plan.plan_name,
        plan.duration_days,
        plan.price,
        plan.description,
        plan.status_on_enroll,
        plan.action_label
      FROM member_subscriptions AS subscription
      JOIN membership_plans AS plan
        ON plan.id = subscription.plan_id
      WHERE subscription.member_id = $1
        AND subscription.is_current = TRUE
      ORDER BY subscription.started_at DESC
      LIMIT 1
    `,
    [memberUuid]
  );

  if (result.rowCount === 0) {
    return null;
  }

  return mapCurrentSubscriptionRow(result.rows[0]);
};

const getTotalVisitsInPlanMonth = async (
  executor,
  memberUuid,
  currentSubscription
) => {
  if (!currentSubscription?.startedAt) {
    return 0;
  }

  const visitWindowEnd =
    buildVisitWindowEnd(
      currentSubscription.startedAt,
      currentSubscription.expiresAt
    ) || new Date();
  const result = await executor.query(
    `
      SELECT COUNT(*)::INT AS total_visits
      FROM attendance_logs
      WHERE member_id = $1
        AND result = 'granted'
        AND logged_at >= $2
        AND logged_at <= $3
    `,
    [memberUuid, currentSubscription.startedAt, visitWindowEnd]
  );

  return Number(result.rows[0]?.total_visits || 0);
};

const getMemberRenewalContext = async (memberUuid) => {
  const normalizedMemberUuid = String(memberUuid || "").trim();

  if (!normalizedMemberUuid) {
    throw new Error("Member id is required before loading renewal data.");
  }

  const memberResult = await query(
    `${DIRECTORY_QUERY}
     WHERE directory.id = $1
     LIMIT 1`,
    [normalizedMemberUuid]
  );

  if (memberResult.rowCount === 0) {
    throw createStatusError("Member record could not be found.", 404);
  }

  const member = mapDirectoryRow(memberResult.rows[0]);
  const currentPlan = await fetchCurrentSubscriptionByMemberId(
    { query },
    normalizedMemberUuid
  );
  const totalVisitsInPlanMonth = await getTotalVisitsInPlanMonth(
    { query },
    normalizedMemberUuid,
    currentPlan
  );
  const visitWindowEndsAt = currentPlan
    ? buildVisitWindowEnd(currentPlan.startedAt, currentPlan.expiresAt)
    : null;

  return {
    member,
    currentPlan,
    metrics: {
      lastFingerprintDetectedAt: member.lastScanAt,
      expiryDate: member.expiryDate,
      totalVisitsInPlanMonth,
      visitWindowStartedAt: currentPlan?.startedAt || null,
      visitWindowEndsAt: visitWindowEndsAt ? visitWindowEndsAt.toISOString() : null
    }
  };
};

const listFingerprintMatchCandidates = async () => {
  const result = await query(
    `
      SELECT
        fingerprint.id AS fingerprint_id,
        fingerprint.finger_label,
        fingerprint.template_format,
        fingerprint.template_data_base64,
        fingerprint.capture_payload,
        directory.id,
        directory.member_id,
        directory.full_name,
        directory.mobile_number,
        directory.plan_name,
        directory.plan_code,
        directory.status_label,
        directory.last_visit_at,
        directory.expires_at,
        directory.action_label,
        directory.registered_at,
        directory.amount_paid,
        member.last_scan_at
      FROM fingerprints AS fingerprint
      JOIN member_directory_view AS directory
        ON directory.id = fingerprint.member_id
      JOIN members AS member
        ON member.id = directory.id
      WHERE fingerprint.template_data_base64 IS NOT NULL
        AND fingerprint.template_format = 'ansi-raw-image'
      ORDER BY fingerprint.is_primary DESC, fingerprint.enrolled_at DESC
    `
  );

  return result.rows
    .map((row) => {
      const capturePayload =
        row.capture_payload && typeof row.capture_payload === "object"
          ? {
              ...row.capture_payload,
              templateDataBase64:
                row.capture_payload.templateDataBase64 ||
                row.capture_payload.fingerprintArtifactBase64 ||
                row.template_data_base64
            }
          : {
              templateDataBase64: row.template_data_base64
            };
      const matcherTemplate = sanitizeMatcherTemplate(
        buildMatcherTemplateFromScanPayload(capturePayload, row.finger_label)
      );

      if (!matcherTemplate) {
        return null;
      }

      return {
        fingerprintId: row.fingerprint_id,
        fingerLabel: row.finger_label,
        templateFormat: row.template_format,
        matcherTemplate,
        member: mapDirectoryRow(row)
      };
    })
    .filter(Boolean);
};

const getLookupOutcomeFromMember = (member, now = new Date()) => {
  const normalizedStatus = String(member?.status || "").toLowerCase();
  const expiryDate = member?.expiryDate ? new Date(member.expiryDate) : null;
  const hasExpiredDate =
    expiryDate instanceof Date &&
    !Number.isNaN(expiryDate.getTime()) &&
    expiryDate.getTime() < now.getTime();
  const requiresBlockedAccess =
    hasExpiredDate ||
    normalizedStatus.includes("renew") ||
    normalizedStatus.includes("expired") ||
    normalizedStatus.includes("hold") ||
    normalizedStatus.includes("inactive");

  if (requiresBlockedAccess) {
    return {
      lookupState: "expired",
      matchStatus: "expired",
      attendanceResult: "blocked",
      note: "Fingerprint matched a member record, but access remains blocked."
    };
  }

  return {
    lookupState: "member",
    matchStatus: "matched",
    attendanceResult: "granted",
    note: "Fingerprint matched a registered member."
  };
};

const resolveFingerprintScanResult = async ({
  scanPayload,
  matchedFingerprintId,
  score,
  thresholdScore = MATCHED_SCAN_THRESHOLD
}) => {
  const safeScanPayload =
    scanPayload && typeof scanPayload === "object" ? scanPayload : null;

  if (!safeScanPayload || Object.keys(safeScanPayload).length === 0) {
    throw new Error("Fingerprint scan payload is required before matching.");
  }

  return withTransaction(async (client) => {
    const now = new Date();
    const scanReference = `SCAN-${now.getTime()}-${randomUUID().slice(0, 8)}`;
    const captureSuccess = Boolean(
      safeScanPayload.captured || safeScanPayload.contactDetected
    );
    const numericScore = toFiniteInteger(score);
    const numericThreshold = toFiniteInteger(
      thresholdScore,
      MATCHED_SCAN_THRESHOLD
    );

    if (!matchedFingerprintId) {
      await client.query(
        `
          INSERT INTO scan_events (
            scan_reference,
            match_status,
            capture_success,
            reader_serial,
            capture_mode,
            capture_payload,
            captured_at,
            resolved_at
          )
          VALUES ($1, 'no_match', $2, $3, $4, $5::jsonb, $6, $6)
        `,
        [
          scanReference,
          captureSuccess,
          safeScanPayload.readerSerial || null,
          safeScanPayload.captureMode || null,
          JSON.stringify(safeScanPayload),
          now
        ]
      );

      return {
        matchFound: false,
        lookupState: "nonmember",
        matchStatus: "no_match",
        message: "No stored fingerprint template matched the captured scan.",
        fingerprint: {
          score: numericScore,
          thresholdScore: numericThreshold
        },
        scanReference
      };
    }

    const matchedFingerprintResult = await client.query(
      `
        SELECT
          fingerprint.id AS fingerprint_id,
          fingerprint.member_id AS fingerprint_member_uuid,
          fingerprint.finger_label,
          directory.id,
          directory.member_id,
          directory.full_name,
          directory.mobile_number,
          directory.plan_name,
          directory.plan_code,
          directory.status_label,
          directory.last_visit_at,
          directory.expires_at,
          directory.action_label,
          directory.registered_at,
          directory.amount_paid
        FROM fingerprints AS fingerprint
        JOIN member_directory_view AS directory
          ON directory.id = fingerprint.member_id
        WHERE fingerprint.id = $1
        LIMIT 1
      `,
      [matchedFingerprintId]
    );

    if (matchedFingerprintResult.rowCount === 0) {
      throw new Error("Matched fingerprint record could not be loaded.");
    }

    const matchedFingerprint = matchedFingerprintResult.rows[0];
    const member = mapDirectoryRow(matchedFingerprint);
    const outcome = getLookupOutcomeFromMember(member, now);
    const scanEventInsert = await client.query(
      `
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $9)
        RETURNING id
      `,
      [
        scanReference,
        matchedFingerprint.fingerprint_member_uuid,
        matchedFingerprint.fingerprint_id,
        outcome.matchStatus,
        captureSuccess,
        safeScanPayload.readerSerial || null,
        safeScanPayload.captureMode || null,
        JSON.stringify(safeScanPayload),
        now
      ]
    );

    await client.query(
      `
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'fingerprint-match', $9)
      `,
      [
        matchedFingerprint.fingerprint_member_uuid,
        matchedFingerprint.fingerprint_id,
        scanEventInsert.rows[0].id,
        now,
        member.status,
        member.action || "View",
        member.plan,
        outcome.attendanceResult,
        numericScore === null
          ? outcome.note
          : `${outcome.note} Matcher score ${numericScore} under threshold ${numericThreshold}.`
      ]
    );

    await client.query(
      `
        UPDATE members
        SET
          last_scan_at = $2,
          last_visit_at = CASE
            WHEN $3 THEN $2
            ELSE last_visit_at
          END
        WHERE id = $1
      `,
      [
        matchedFingerprint.fingerprint_member_uuid,
        now,
        outcome.attendanceResult === "granted"
      ]
    );

    return {
      matchFound: true,
      lookupState: outcome.lookupState,
      matchStatus: outcome.matchStatus,
      message:
        outcome.lookupState === "expired"
          ? "Match found. The member record was loaded, but access remains blocked until renewal."
          : "Match found. Member data was loaded successfully.",
      member,
      fingerprint: {
        fingerprintId: matchedFingerprint.fingerprint_id,
        fingerLabel: matchedFingerprint.finger_label,
        score: numericScore,
        thresholdScore: numericThreshold
      },
      scanReference
    };
  });
};

const deleteMemberPermanently = async (memberUuid) => {
  const normalizedMemberUuid = String(memberUuid || "").trim();

  if (!normalizedMemberUuid) {
    throw new Error("Member id is required before deletion.");
  }

  return withTransaction(async (client) => {
    const memberResult = await client.query(
      `${DIRECTORY_QUERY}
       WHERE directory.id = $1
       LIMIT 1`,
      [normalizedMemberUuid]
    );

    if (memberResult.rowCount === 0) {
      throw createStatusError("Member record could not be found.", 404);
    }

    const member = mapDirectoryRow(memberResult.rows[0]);
    const fingerprintResult = await client.query(
      `
        SELECT id
        FROM fingerprints
        WHERE member_id = $1
      `,
      [normalizedMemberUuid]
    );
    const fingerprintIds = fingerprintResult.rows.map((row) => row.id);

    if (fingerprintIds.length > 0) {
      await client.query(
        `
          DELETE FROM attendance_logs
          WHERE member_id = $1
            OR fingerprint_id = ANY($2::uuid[])
        `,
        [normalizedMemberUuid, fingerprintIds]
      );

      await client.query(
        `
          DELETE FROM scan_events
          WHERE matched_member_id = $1
            OR fingerprint_id = ANY($2::uuid[])
        `,
        [normalizedMemberUuid, fingerprintIds]
      );
    } else {
      await client.query(
        `
          DELETE FROM attendance_logs
          WHERE member_id = $1
        `,
        [normalizedMemberUuid]
      );

      await client.query(
        `
          DELETE FROM scan_events
          WHERE matched_member_id = $1
        `,
        [normalizedMemberUuid]
      );
    }

    await client.query(
      `
        DELETE FROM members
        WHERE id = $1
      `,
      [normalizedMemberUuid]
    );

    return {
      deleted: true,
      member
    };
  });
};

const renewMemberMembership = async ({ memberUuid, planCode }) => {
  const normalizedMemberUuid = String(memberUuid || "").trim();
  const normalizedPlanCode = normalizePlanCode(planCode);

  if (!normalizedMemberUuid) {
    throw new Error("Member id is required before renewal.");
  }

  return withTransaction(async (client) => {
    const memberResult = await client.query(
      `
        SELECT
          id,
          member_id,
          full_name
        FROM members
        WHERE id = $1
        LIMIT 1
      `,
      [normalizedMemberUuid]
    );

    if (memberResult.rowCount === 0) {
      throw createStatusError("Member record could not be found.", 404);
    }

    const planResult = await client.query(
      `
        SELECT
          id,
          plan_code,
          plan_name,
          duration_days,
          price,
          status_on_enroll,
          action_label,
          description,
          sort_order
        FROM membership_plans
        WHERE plan_code = $1
        LIMIT 1
      `,
      [normalizedPlanCode]
    );

    if (planResult.rowCount === 0) {
      throw new Error(`Membership plan '${normalizedPlanCode}' does not exist.`);
    }

    const selectedPlan = mapPlanRow(planResult.rows[0]);
    const previousSubscription = await fetchCurrentSubscriptionByMemberId(
      client,
      normalizedMemberUuid
    );

    if (previousSubscription?.subscriptionId) {
      await client.query(
        `
          UPDATE member_subscriptions
          SET
            is_current = FALSE,
            subscription_status = CASE
              WHEN subscription_status = 'active' THEN 'expired'
              ELSE subscription_status
            END
          WHERE id = $1
        `,
        [previousSubscription.subscriptionId]
      );
    }

    const now = new Date();
    const expiresAt = buildExpiryDate(
      selectedPlan.planCode,
      selectedPlan.durationDays,
      now
    );
    const statusLabel = titleCaseStatus(selectedPlan.statusOnEnroll);
    const renewalNotes = previousSubscription
      ? `Renewed from ${previousSubscription.planName} to ${selectedPlan.planName}.`
      : `Renewed to ${selectedPlan.planName}.`;

    await client.query(
      `
        INSERT INTO member_subscriptions (
          member_id,
          plan_id,
          subscription_status,
          started_at,
          expires_at,
          amount_paid,
          is_current
        )
        VALUES ($1, $2, 'active', $3, $4, $5, TRUE)
      `,
      [
        normalizedMemberUuid,
        selectedPlan.id,
        now,
        expiresAt,
        selectedPlan.price
      ]
    );

    await client.query(
      `
        UPDATE members
        SET
          member_status = $2,
          current_action = $3
        WHERE id = $1
      `,
      [
        normalizedMemberUuid,
        selectedPlan.statusOnEnroll,
        selectedPlan.actionLabel
      ]
    );

    await client.query(
      `
        INSERT INTO attendance_logs (
          member_id,
          logged_at,
          status_label,
          action_label,
          plan_snapshot,
          result,
          source,
          notes
        )
        VALUES ($1, $2, $3, $4, $5, 'registered', 'renewal', $6)
      `,
      [
        normalizedMemberUuid,
        now,
        statusLabel,
        selectedPlan.actionLabel,
        selectedPlan.planName,
        renewalNotes
      ]
    );

    const context = await (async () => {
      const member = await fetchMemberById(client, normalizedMemberUuid);
      const currentPlan = await fetchCurrentSubscriptionByMemberId(
        client,
        normalizedMemberUuid
      );
      const totalVisitsInPlanMonth = await getTotalVisitsInPlanMonth(
        client,
        normalizedMemberUuid,
        currentPlan
      );
      const visitWindowEndsAt = currentPlan
        ? buildVisitWindowEnd(currentPlan.startedAt, currentPlan.expiresAt)
        : null;

      return {
        member,
        currentPlan,
        metrics: {
          lastFingerprintDetectedAt: member.lastScanAt,
          expiryDate: member.expiryDate,
          totalVisitsInPlanMonth,
          visitWindowStartedAt: currentPlan?.startedAt || null,
          visitWindowEndsAt: visitWindowEndsAt
            ? visitWindowEndsAt.toISOString()
            : null
        }
      };
    })();

    return {
      member: context.member,
      currentPlan: context.currentPlan,
      metrics: context.metrics,
      previousPlan: previousSubscription
        ? {
            planCode: previousSubscription.planCode,
            planName: previousSubscription.planName,
            expiresAt: previousSubscription.expiresAt
          }
        : null
    };
  });
};

const registerMemberFromScan = async ({
  fullName,
  mobileNumber,
  planCode,
  startDate,
  fingerLabel,
  scanPayload
}) => {
  const normalizedName = String(fullName || "").trim().replace(/\s+/g, " ");
  const normalizedPhone = normalizePhone(mobileNumber);
  const normalizedPlanCode = normalizePlanCode(planCode);
  const normalizedFingerLabel = normalizeFingerLabel(fingerLabel);
  const safeScanPayload =
    scanPayload && typeof scanPayload === "object" ? scanPayload : null;

  if (!normalizedName || normalizedName.length < 3) {
    throw new Error("Full name is required and should be at least 3 characters.");
  }

  if (!normalizedPhone || normalizedPhone.length < 10) {
    throw new Error("Mobile number is required and should contain at least 10 digits.");
  }

  if (!safeScanPayload || Object.keys(safeScanPayload).length === 0) {
    throw new Error("Fingerprint scan payload is required before registering a new member.");
  }

  if (!Boolean(safeScanPayload.captured || safeScanPayload.contactDetected)) {
    throw new Error(
      "Fingerprint capture must succeed before a new member can be registered."
    );
  }

  const templateData = getTemplateDataFromScanPayload(safeScanPayload);
  if (!templateData) {
    throw new Error(
      "The captured fingerprint template is missing. Capture the fingerprint again before registering."
    );
  }

  const matcherTemplate = sanitizeMatcherTemplate(
    buildMatcherTemplateFromScanPayload(safeScanPayload, normalizedFingerLabel)
  );

  if (!matcherTemplate) {
    throw new Error(
      "The captured fingerprint metadata is incomplete. Capture the fingerprint again before registering."
    );
  }

  const scanPayloadToPersist = {
    ...safeScanPayload,
    matcherTemplate
  };

  return withTransaction(async (client) => {
    const now = new Date();
    const membershipStartAt = resolveMembershipStartDate(startDate, now);
    const planResult = await client.query(
      `
        SELECT
          id,
          plan_code,
          plan_name,
          duration_days,
          price,
          status_on_enroll,
          action_label
        FROM membership_plans
        WHERE plan_code = $1
        LIMIT 1
      `,
      [normalizedPlanCode]
    );

    if (planResult.rowCount === 0) {
      throw new Error(`Membership plan '${normalizedPlanCode}' does not exist.`);
    }

    const plan = planResult.rows[0];
    const memberNumberResult = await client.query(
      "SELECT LPAD(NEXTVAL('member_id_sequence')::TEXT, 4, '0') AS next_member_number"
    );
    const memberId = `GYM-${memberNumberResult.rows[0].next_member_number}`;
    const subscriptionStartAt = resolveSubscriptionStartAt(
      plan.plan_code,
      membershipStartAt,
      now
    );
    const expiresAt = buildExpiryDate(
      plan.plan_code,
      plan.duration_days,
      subscriptionStartAt
    );
    const scanReference = `SCAN-${now.getTime()}-${randomUUID().slice(0, 8)}`;
    const templateFormat = "ansi-raw-image";
    const templateHash = buildTemplateHash(templateData, scanPayloadToPersist);
    const statusLabel = titleCaseStatus(plan.status_on_enroll);
    const actionLabel = plan.action_label || "View";

    const memberInsert = await client.query(
      `
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
        RETURNING id
      `,
      [
        memberId,
        normalizedName,
        normalizedPhone,
        plan.status_on_enroll,
        actionLabel,
        subscriptionStartAt,
        now
      ]
    );

    const memberUuid = memberInsert.rows[0].id;

    await client.query(
      `
        INSERT INTO member_subscriptions (
          member_id,
          plan_id,
          subscription_status,
          started_at,
          expires_at,
          amount_paid,
          is_current
        )
        VALUES ($1, $2, 'active', $3, $4, $5, TRUE)
      `,
      [memberUuid, plan.id, subscriptionStartAt, expiresAt, plan.price]
    );

    const fingerprintInsert = await client.query(
      `
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
          capture_quality,
          is_primary,
          enrolled_at
        )
        VALUES ($1, $2, $3, 'v1', $4, $5, $6::jsonb, $7, $8, $9, TRUE, $10)
        RETURNING id
      `,
      [
        memberUuid,
        normalizedFingerLabel,
        templateFormat,
        templateHash,
        templateData,
        JSON.stringify(scanPayloadToPersist),
        scanPayloadToPersist.readerSerial || null,
        scanPayloadToPersist.captureMode || null,
        scanPayloadToPersist.quality || null,
        now
      ]
    );

    const fingerprintUuid = fingerprintInsert.rows[0].id;

    const scanEventInsert = await client.query(
      `
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
        VALUES ($1, $2, $3, 'registered', $4, $5, $6, $7::jsonb, $8, $8)
        RETURNING id
      `,
      [
        scanReference,
        memberUuid,
        fingerprintUuid,
        Boolean(scanPayloadToPersist.captured || scanPayloadToPersist.contactDetected),
        scanPayloadToPersist.readerSerial || null,
        scanPayloadToPersist.captureMode || null,
        JSON.stringify(scanPayloadToPersist),
        now
      ]
    );

    await client.query(
      `
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
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'registered', 'registration', $8)
      `,
      [
        memberUuid,
        fingerprintUuid,
        scanEventInsert.rows[0].id,
        now,
        statusLabel,
        actionLabel,
        plan.plan_name,
        "Registered from captured fingerprint template."
      ]
    );

    const member = await fetchMemberById(client, memberUuid);

    return {
      member,
      fingerprint: {
        fingerLabel: normalizedFingerLabel,
        templateFormat,
        templateHash,
        enrolledAt: now
      },
      scanReference
    };
  });
};

module.exports = {
  buildExpiryDate,
  buildMatcherTemplateFromScanPayload,
  deleteMemberPermanently,
  deriveMembershipPresentation,
  getMemberRenewalContext,
  listFingerprintMatchCandidates,
  listMembershipPlans,
  listMembers,
  registerMemberFromScan,
  resolveEffectiveExpiryDate,
  resolveSubscriptionStartAt,
  renewMemberMembership,
  resolveFingerprintScanResult,
  sanitizeMatcherTemplate
};
