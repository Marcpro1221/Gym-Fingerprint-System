"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const {
  buildMatcherTemplateFromScanPayload,
  sanitizeMatcherTemplate
} = require("./service");

const STORE_PATH = path.resolve(__dirname, "../../../data/local-member-store.json");
const DEFAULT_MEMBER_SEQUENCE = 1200;
const PLAN_CATALOG = {
  MONTHLY: {
    plan: "Monthly Payment",
    planCode: "MONTHLY",
    amountPaid: 1999,
    durationDays: 30,
    status: "Active",
    action: "View"
  },
  DAY_PASS: {
    plan: "Single Day Access",
    planCode: "DAY_PASS",
    amountPaid: 250,
    durationDays: 1,
    status: "Day Pass",
    action: "View"
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
  const expiryDate = new Date(now);

  if (planCode === "DAY_PASS") {
    expiryDate.setHours(21, 0, 0, 0);
    if (expiryDate <= now) {
      expiryDate.setDate(expiryDate.getDate() + 1);
    }
    return expiryDate.toISOString();
  }

  expiryDate.setDate(expiryDate.getDate() + PLAN_CATALOG[planCode].durationDays);
  return expiryDate.toISOString();
};

const buildMemberResponse = (entry) => ({
  id: entry.id,
  memberId: entry.memberId,
  fullName: entry.fullName,
  mobileNumber: entry.mobileNumber,
  plan: entry.plan,
  planCode: entry.planCode,
  status: entry.status,
  lastVisitAt: entry.lastVisitAt,
  lastScanAt: entry.lastScanAt,
  expiryDate: entry.expiryDate,
  action: entry.action,
  registeredAt: entry.registeredAt,
  amountPaid: entry.amountPaid
});

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
    expiryDate: formatExpiryDate(normalizedPlanCode, now),
    registeredAt: now.toISOString(),
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

module.exports = {
  deleteMemberFromFileStore,
  listFingerprintMatchCandidatesFromFileStore,
  listMembersFromFileStore,
  registerMemberFromScanToFileStore,
  resolveFingerprintScanResultFromFileStore,
  STORE_PATH
};
