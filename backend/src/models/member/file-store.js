"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const {
  buildExpiryDate,
  buildMatcherTemplateFromScanPayload,
  deriveMembershipPresentation,
  resolveEffectiveExpiryDate,
  resolveSubscriptionStartAt,
  sanitizeMatcherTemplate
} = require("./service");

const STORE_PATH = path.resolve(__dirname, "../../../data/local-member-store.json");
const DEFAULT_MEMBER_SEQUENCE = 1200;
const PLAN_CATALOG = {
  MONTHLY: {
    id: "MONTHLY",
    plan: "Monthly Payment",
    planCode: "MONTHLY",
    amountPaid: 1999,
    durationDays: 30,
    statusOnEnroll: "active",
    status: "Active",
    action: "View",
    description: "Standard monthly gym membership.",
    sortOrder: 1
  },
  DAY_PASS: {
    id: "DAY_PASS",
    plan: "Single Day Access",
    planCode: "DAY_PASS",
    amountPaid: 250,
    durationDays: 1,
    statusOnEnroll: "day_pass",
    status: "Day Pass",
    action: "View",
    description: "Valid until the gym closes for the day.",
    sortOrder: 2
  }
};

const ensureStoreDir = async () => {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
};

const buildTemplateHash = (templateData, scanPayload) => {
  const payloadSource =
    typeof templateData === "string" && templateData.length > 0
      ? templateData
      : JSON.stringify(scanPayload || {});

  return createHash("sha256").update(payloadSource).digest("hex");
};

const normalizePlanCode = (value) => {
  const normalized = String(value || "MONTHLY")
    .trim()
    .replace(/\s+/g, "_")
    .toUpperCase();

  return PLAN_CATALOG[normalized] ? normalized : "MONTHLY";
};

const normalizePhone = (value) => String(value || "").replace(/[^\d+]/g, "").trim();

const normalizeFingerLabel = (value) =>
  String(value || "RIGHT_INDEX")
    .trim()
    .replace(/\s+/g, "_")
    .toUpperCase();

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

const createStatusError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const readStore = async () => {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw);

    return {
      version: 1,
      sequence:
        Number.isFinite(parsed.sequence) && parsed.sequence >= DEFAULT_MEMBER_SEQUENCE
          ? parsed.sequence
          : DEFAULT_MEMBER_SEQUENCE,
      members: Array.isArray(parsed.members) ? parsed.members : [],
      scanEvents: Array.isArray(parsed.scanEvents) ? parsed.scanEvents : []
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        version: 1,
        sequence: DEFAULT_MEMBER_SEQUENCE,
        members: [],
        scanEvents: []
      };
    }

    throw error;
  }
};

const writeStore = async (store) => {
  await ensureStoreDir();
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
};

const formatExpiryDate = (planCode, now) => {
  const plan = PLAN_CATALOG[planCode];
  const expiryDate = buildExpiryDate(
    planCode,
    plan?.durationDays || 30,
    now
  );
  return expiryDate.toISOString();
};

const buildMemberResponse = (entry) => ({
  ...(() => {
    const membershipPresentation = deriveMembershipPresentation({
      status: entry.status,
      action: entry.action,
      planCode: entry.planCode,
      startedAt: entry.subscriptionStartedAt || entry.registeredAt,
      expiryDate: entry.expiryDate
    });
    const effectiveExpiryDate = resolveEffectiveExpiryDate({
      planCode: entry.planCode,
      startedAt: entry.subscriptionStartedAt || entry.registeredAt,
      expiryDate: entry.expiryDate
    });

    return {
      id: entry.id,
      memberId: entry.memberId,
      fullName: entry.fullName,
      mobileNumber: entry.mobileNumber,
      plan: entry.plan,
      planCode: entry.planCode,
      status: membershipPresentation.status,
      lastVisitAt: entry.lastVisitAt,
      lastScanAt: entry.lastScanAt,
      expiryDate: effectiveExpiryDate
        ? effectiveExpiryDate.toISOString()
        : entry.expiryDate,
      action: membershipPresentation.action,
      registeredAt: entry.registeredAt,
      amountPaid: entry.amountPaid
    };
  })()
});

const buildPlanResponse = (plan) => ({
  id: plan.id,
  planCode: plan.planCode,
  planName: plan.plan,
  durationDays: plan.durationDays,
  price: Number(plan.amountPaid),
  statusOnEnroll: plan.statusOnEnroll,
  actionLabel: plan.action,
  description: plan.description,
  sortOrder: plan.sortOrder
});

const buildCurrentPlanFromMember = (member) => {
  const plan = PLAN_CATALOG[normalizePlanCode(member?.planCode)];
  if (!plan) {
    return null;
  }

  return {
    subscriptionId: `${member.id}:${plan.planCode}`,
    planId: plan.id,
    planCode: plan.planCode,
    planName: plan.plan,
    durationDays: plan.durationDays,
    price: Number(plan.amountPaid),
    amountPaid: Number(member.amountPaid ?? plan.amountPaid),
    description: plan.description,
    statusOnEnroll: plan.statusOnEnroll,
    actionLabel: plan.action,
    subscriptionStatus: "active",
    startedAt: member.subscriptionStartedAt || member.registeredAt || null,
    expiresAt: (() => {
      const effectiveExpiryDate = resolveEffectiveExpiryDate({
        planCode: plan.planCode,
        startedAt: member.subscriptionStartedAt || member.registeredAt || null,
        expiryDate: member.expiryDate || null
      });
      return effectiveExpiryDate ? effectiveExpiryDate.toISOString() : member.expiryDate || null;
    })()
  };
};

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

const getLookupOutcomeFromMember = (member, now = new Date()) => {
  const normalizedStatus = String(member.status || "").toLowerCase();
  const expiryDate = member.expiryDate ? new Date(member.expiryDate) : null;
  const isExpired =
    expiryDate instanceof Date &&
    !Number.isNaN(expiryDate.getTime()) &&
    expiryDate.getTime() < now.getTime();

  if (
    isExpired ||
    normalizedStatus.includes("renew") ||
    normalizedStatus.includes("expired") ||
    normalizedStatus.includes("hold") ||
    normalizedStatus.includes("inactive")
  ) {
    return {
      lookupState: "expired",
      matchStatus: "expired",
      message: "Match found. The member record was loaded, but access remains blocked until renewal."
    };
  }

  return {
    lookupState: "member",
    matchStatus: "matched",
    message: "Match found. Member data was loaded successfully."
  };
};

const listMembersFromFileStore = async (limit = 100) => {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 250)) : 100;
  const store = await readStore();

  return store.members
    .slice()
    .sort((a, b) => {
      const aDate = new Date(a.lastScanAt || a.lastVisitAt || a.registeredAt || 0).getTime();
      const bDate = new Date(b.lastScanAt || b.lastVisitAt || b.registeredAt || 0).getTime();
      return bDate - aDate;
    })
    .slice(0, safeLimit)
    .map(buildMemberResponse);
};

const listMembershipPlansFromFileStore = async () =>
  Object.values(PLAN_CATALOG)
    .slice()
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map(buildPlanResponse);

const getMemberRenewalContextFromFileStore = async (memberUuid) => {
  const normalizedMemberUuid = String(memberUuid || "").trim();

  if (!normalizedMemberUuid) {
    throw new Error("Member id is required before loading renewal data.");
  }

  const store = await readStore();
  const member = store.members.find((entry) => entry.id === normalizedMemberUuid);

  if (!member) {
    throw createStatusError("Member record could not be found.", 404);
  }

  const currentPlan = buildCurrentPlanFromMember(member);
  const memberResponse = buildMemberResponse(member);
  const visitWindowEnd = currentPlan
    ? buildVisitWindowEnd(currentPlan.startedAt, currentPlan.expiresAt)
    : null;
  const totalVisitsInPlanMonth = currentPlan
    ? store.scanEvents.filter((event) => {
        const capturedAt = event?.capturedAt ? new Date(event.capturedAt) : null;
        return (
          event?.matchedMemberId === normalizedMemberUuid &&
          event?.matchStatus === "matched" &&
          capturedAt instanceof Date &&
          !Number.isNaN(capturedAt.getTime()) &&
          capturedAt >= new Date(currentPlan.startedAt) &&
          (!visitWindowEnd || capturedAt <= visitWindowEnd)
        );
      }).length
    : 0;

  return {
    member: memberResponse,
    currentPlan,
    metrics: {
      lastFingerprintDetectedAt: member.lastScanAt || null,
      expiryDate: currentPlan?.expiresAt || memberResponse.expiryDate || null,
      totalVisitsInPlanMonth,
      visitWindowStartedAt: currentPlan?.startedAt || null,
      visitWindowEndsAt: visitWindowEnd ? visitWindowEnd.toISOString() : null
    }
  };
};

const listFingerprintMatchCandidatesFromFileStore = async () => {
  const store = await readStore();

  return store.members
    .filter(
      (member) =>
        member.fingerprint &&
        member.fingerprint.matcherTemplate &&
        member.fingerprint.templateFormat === "ansi-raw-image"
    )
    .map((member) => {
      const matcherTemplate = sanitizeMatcherTemplate(member.fingerprint.matcherTemplate);

      if (!matcherTemplate) {
        return null;
      }

      return {
        fingerprintId: member.fingerprint.fingerprintId,
        fingerLabel: member.fingerprint.fingerLabel,
        templateFormat: member.fingerprint.templateFormat,
        matcherTemplate,
        member: buildMemberResponse(member)
      };
    })
    .filter(Boolean);
};

const registerMemberFromScanToFileStore = async ({
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

  const rawMatcherTemplate = buildMatcherTemplateFromScanPayload(
    safeScanPayload,
    normalizedFingerLabel
  );

  if (!rawMatcherTemplate || !rawMatcherTemplate.templateDataBase64) {
    throw new Error(
      "The captured fingerprint template is missing. Capture the fingerprint again before registering."
    );
  }

  const matcherTemplate = sanitizeMatcherTemplate(rawMatcherTemplate);

  if (!matcherTemplate) {
    throw new Error(
      "The captured fingerprint metadata is incomplete. Capture the fingerprint again before registering."
    );
  }

  const templateData = matcherTemplate.templateDataBase64;
  const scanPayloadToPersist = {
    ...safeScanPayload,
    matcherTemplate
  };

  const store = await readStore();
  const now = new Date();
  const membershipStartAt = resolveMembershipStartDate(startDate, now);
  const subscriptionStartAt = resolveSubscriptionStartAt(
    normalizedPlanCode,
    membershipStartAt,
    now
  );
  const memberNumber = String(store.sequence).padStart(4, "0");
  const memberId = `GYM-${memberNumber}`;
  const memberUuid = randomUUID();
  const fingerprintId = randomUUID();
  const scanReference = `LOCAL-SCAN-${now.getTime()}-${randomUUID().slice(0, 8)}`;
  const plan = PLAN_CATALOG[normalizedPlanCode];
  const entry = {
    id: memberUuid,
    memberId,
    fullName: normalizedName,
    mobileNumber: normalizedPhone,
    plan: plan.plan,
    planCode: plan.planCode,
    status: plan.status,
    action: plan.action,
    expiryDate: formatExpiryDate(normalizedPlanCode, subscriptionStartAt),
    registeredAt: subscriptionStartAt.toISOString(),
    subscriptionStartedAt: subscriptionStartAt.toISOString(),
    lastVisitAt: now.toISOString(),
    lastScanAt: now.toISOString(),
    amountPaid: plan.amountPaid,
    fingerprint: {
      fingerprintId,
      fingerLabel: normalizedFingerLabel,
      templateFormat: "ansi-raw-image",
      templateHash: buildTemplateHash(templateData, scanPayloadToPersist),
      templateDataBase64: templateData,
      matcherTemplate,
      enrolledAt: now.toISOString(),
      readerSerial: scanPayloadToPersist.readerSerial || null,
      captureMode: scanPayloadToPersist.captureMode || null,
      captureQuality: scanPayloadToPersist.quality || null,
      capturePayload: scanPayloadToPersist
    }
  };

  store.members.push(entry);
  store.sequence += 1;
  store.scanEvents.push({
    scanReference,
    matchedMemberId: memberUuid,
    fingerprintId,
    matchStatus: "registered",
    capturedAt: now.toISOString()
  });
  await writeStore(store);

  return {
    member: buildMemberResponse(entry),
    fingerprint: {
      fingerLabel: normalizedFingerLabel,
      templateFormat: "ansi-raw-image",
      templateHash: entry.fingerprint.templateHash,
      enrolledAt: entry.fingerprint.enrolledAt
    },
    scanReference
  };
};

const resolveFingerprintScanResultFromFileStore = async ({
  matchedFingerprintId,
  score,
  thresholdScore = Math.floor(0x7fffffff / 100000)
}) => {
  const store = await readStore();
  const now = new Date();
  const scanReference = `LOCAL-SCAN-${now.getTime()}-${randomUUID().slice(0, 8)}`;
  const numericScore = Number.isFinite(Number(score)) ? Number(score) : null;
  const numericThreshold = Number.isFinite(Number(thresholdScore))
    ? Number(thresholdScore)
    : Math.floor(0x7fffffff / 100000);

  if (!matchedFingerprintId) {
    store.scanEvents.push({
      scanReference,
      matchedMemberId: null,
      fingerprintId: null,
      matchStatus: "no_match",
      capturedAt: now.toISOString()
    });
    await writeStore(store);

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

  const matchedMember = store.members.find(
    (member) => member.fingerprint && member.fingerprint.fingerprintId === matchedFingerprintId
  );

  if (!matchedMember) {
    throw new Error("Matched fingerprint record could not be loaded.");
  }

  const member = buildMemberResponse(matchedMember);
  const outcome = getLookupOutcomeFromMember(member, now);

  matchedMember.lastScanAt = now.toISOString();
  if (outcome.lookupState === "member") {
    matchedMember.lastVisitAt = now.toISOString();
  }

  store.scanEvents.push({
    scanReference,
    matchedMemberId: matchedMember.id,
    fingerprintId: matchedMember.fingerprint.fingerprintId,
    matchStatus: outcome.matchStatus,
    capturedAt: now.toISOString()
  });
  await writeStore(store);

  return {
    matchFound: true,
    lookupState: outcome.lookupState,
    matchStatus: outcome.matchStatus,
    message: outcome.message,
    member: buildMemberResponse(matchedMember),
    fingerprint: {
      fingerprintId: matchedMember.fingerprint.fingerprintId,
      fingerLabel: matchedMember.fingerprint.fingerLabel,
      score: numericScore,
      thresholdScore: numericThreshold
    },
    scanReference
  };
};

const deleteMemberFromFileStore = async (memberUuid) => {
  const normalizedMemberUuid = String(memberUuid || "").trim();

  if (!normalizedMemberUuid) {
    throw new Error("Member id is required before deletion.");
  }

  const store = await readStore();
  const memberIndex = store.members.findIndex((member) => member.id === normalizedMemberUuid);

  if (memberIndex === -1) {
    throw createStatusError("Member record could not be found.", 404);
  }

  const [member] = store.members.splice(memberIndex, 1);
  const fingerprintId = member.fingerprint?.fingerprintId || null;

  store.scanEvents = store.scanEvents.filter(
    (event) =>
      event.matchedMemberId !== member.id &&
      (!fingerprintId || event.fingerprintId !== fingerprintId)
  );

  await writeStore(store);

  return {
    deleted: true,
    member: buildMemberResponse(member)
  };
};

const renewMemberMembershipInFileStore = async ({ memberUuid, planCode }) => {
  const normalizedMemberUuid = String(memberUuid || "").trim();
  const normalizedPlanCode = normalizePlanCode(planCode);

  if (!normalizedMemberUuid) {
    throw new Error("Member id is required before renewal.");
  }

  const store = await readStore();
  const member = store.members.find((entry) => entry.id === normalizedMemberUuid);

  if (!member) {
    throw createStatusError("Member record could not be found.", 404);
  }

  const selectedPlan = PLAN_CATALOG[normalizedPlanCode];
  if (!selectedPlan) {
    throw new Error(`Membership plan '${normalizedPlanCode}' does not exist.`);
  }

  const previousPlan = buildCurrentPlanFromMember(member);
  const now = new Date();
  member.plan = selectedPlan.plan;
  member.planCode = selectedPlan.planCode;
  member.status = selectedPlan.status;
  member.action = selectedPlan.action;
  member.amountPaid = selectedPlan.amountPaid;
  member.expiryDate = formatExpiryDate(selectedPlan.planCode, now);
  member.subscriptionStartedAt = now.toISOString();
  member.renewalHistory = Array.isArray(member.renewalHistory)
    ? member.renewalHistory
    : [];
  member.renewalHistory.push({
    renewedAt: now.toISOString(),
    previousPlanCode: previousPlan?.planCode || null,
    previousPlanName: previousPlan?.planName || null,
    nextPlanCode: selectedPlan.planCode,
    nextPlanName: selectedPlan.plan
  });

  store.scanEvents.push({
    scanReference: `LOCAL-RENEW-${now.getTime()}-${randomUUID().slice(0, 8)}`,
    matchedMemberId: normalizedMemberUuid,
    fingerprintId: member.fingerprint?.fingerprintId || null,
    matchStatus: "registered",
    capturedAt: now.toISOString(),
    source: "renewal"
  });
  await writeStore(store);

  const context = await getMemberRenewalContextFromFileStore(normalizedMemberUuid);

  return {
    member: context.member,
    currentPlan: context.currentPlan,
    metrics: context.metrics,
    previousPlan: previousPlan
      ? {
          planCode: previousPlan.planCode,
          planName: previousPlan.planName,
          expiresAt: previousPlan.expiresAt
        }
      : null
  };
};

module.exports = {
  deleteMemberFromFileStore,
  getMemberRenewalContextFromFileStore,
  listFingerprintMatchCandidatesFromFileStore,
  listMembershipPlansFromFileStore,
  listMembersFromFileStore,
  registerMemberFromScanToFileStore,
  renewMemberMembershipInFileStore,
  resolveFingerprintScanResultFromFileStore,
  STORE_PATH
};
