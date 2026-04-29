document.addEventListener("DOMContentLoaded", () => {
  const sidebar = document.querySelector("[data-sidebar]");
  const menuToggle = document.querySelector("[data-menu-toggle]");
  const modal = document.querySelector("[data-modal]");
  const modalBody = document.querySelector("[data-modal-body]");
  const modalTitle = document.querySelector("[data-modal-title]");
  const modalFoot = document.querySelector("[data-modal-foot]");
  const fingerprintApiBase =
    document.body.dataset.fingerprintApiBase ||
    (window.location.port === "4100" ? window.location.origin : "http://localhost:4100");
  const currentPageIsLocal = ["localhost", "127.0.0.1", "::1"].includes(
    window.location.hostname
  );
  const scanMode = document.body.dataset.scanMode || "lookup";
  const captureSaveMode = scanMode === "capture-save";
  const localApiStartHint = currentPageIsLocal
    ? "Start it with npm run dev, or run npm run fingerprint:bridge if the frontend is already open."
    : "Start it with npm run dev, or run npm run fingerprint:bridge if the frontend is already open. If this page is open from a deployed or public site, browsers may block requests to localhost. Open the local page from npm run web or npm run dev instead, then try again.";
  const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  });
  const longDateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
  const shortDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  const longDateTimeFormatter = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  const timeFormatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });
  const contactDetectionTimeoutMs = 2000;
  const recentActivityTestWindowMs = 2 * 60 * 1000;
  const recentActivityTestWindowLabel = "2 minutes";
  const directoryMembersById = new Map();

  if (menuToggle && sidebar) {
    menuToggle.addEventListener("click", () => {
      sidebar.classList.toggle("open");
    });

    document.addEventListener("click", (event) => {
      if (window.innerWidth > 980) return;
      const clickedInsideSidebar = sidebar.contains(event.target);
      const clickedToggle = menuToggle.contains(event.target);
      if (!clickedInsideSidebar && !clickedToggle) {
        sidebar.classList.remove("open");
      }
    });
  }

  const closeModal = () => {
    if (!modal) return;
    modal.classList.remove("open");
  };

  const renderModal = ({ title, body, footer }) => {
    if (!modal) return;

    if (modalTitle) {
      modalTitle.textContent = title;
    }

    if (modalBody) {
      modalBody.innerHTML = body;
    }

    if (modalFoot) {
      modalFoot.innerHTML = footer;
    }

    modal.classList.add("open");
  };

  const setDirectoryMembers = (members = []) => {
    directoryMembersById.clear();

    members.forEach((member) => {
      if (member && member.id) {
        directoryMembersById.set(String(member.id), member);
      }
    });
  };

  const getMemberRecordFromButton = (button) => {
    const memberKey = String(button?.dataset?.memberKey || "").trim();

    if (memberKey && directoryMembersById.has(memberKey)) {
      return directoryMembersById.get(memberKey);
    }

    return {
      id: memberKey || null,
      memberId: button?.dataset?.memberCode || "",
      fullName: button?.dataset?.memberName || "Member Snapshot",
      plan: button?.dataset?.memberPlan || "Hidden for privacy",
      status: button?.dataset?.memberStatus || "Active",
      expiryDate: button?.dataset?.memberExpiry || "",
      action: button?.dataset?.memberAction || "View",
      lastVisitAt: button?.dataset?.memberLastVisit || null,
      lastScanAt: button?.dataset?.memberLastScan || null,
      registeredAt: button?.dataset?.memberRegisteredAt || null
    };
  };

  const bindModalTriggers = (scope = document) => {
    if (!modal) return;

    scope.querySelectorAll("[data-modal-open]").forEach((button) => {
      if (button.dataset.modalBound === "true") {
        return;
      }

      button.dataset.modalBound = "true";
      button.addEventListener("click", () => {
        renderModal(buildMemberSnapshotModal(getMemberRecordFromButton(button)));
      });
    });
  };

  const bindDeleteTriggers = (scope = document) => {
    if (!modal) return;

    scope.querySelectorAll("[data-member-delete-open]").forEach((button) => {
      if (button.dataset.deleteBound === "true") {
        return;
      }

      button.dataset.deleteBound = "true";
      button.addEventListener("click", () => {
        renderModal(buildDeleteConfirmationModal(getMemberRecordFromButton(button)));
      });
    });
  };

  if (modal) {
    bindModalTriggers(document);
    bindDeleteTriggers(document);

    modal.addEventListener("click", async (event) => {
      const deleteConfirmButton = event.target.closest("[data-member-delete-confirm]");
      if (deleteConfirmButton) {
        event.preventDefault();
        if (deleteConfirmButton.disabled) {
          return;
        }

        deleteConfirmButton.disabled = true;
        deleteConfirmButton.textContent = "Deleting...";
        await deleteMemberRecord(getMemberRecordFromButton(deleteConfirmButton));
        return;
      }

      if (event.target.closest("[data-modal-close]") || event.target === modal) {
        closeModal();
      }
    });
  }

  const scanOutputs = document.querySelectorAll("[data-scan-output]");
  const inlineScanOutputs = document.querySelectorAll("[data-scan-inline]");
  const scanLabel = document.querySelector("[data-scan-label]");
  const scanShells = document.querySelectorAll(".scan-shell");
  const scanners = document.querySelectorAll(".scanner");
  const scanFeedbackBadges = document.querySelectorAll("[data-scan-feedback-badge]");
  const scanCardKickers = document.querySelectorAll("[data-scan-card-kicker]");
  const scanCardTitles = document.querySelectorAll("[data-scan-card-title]");
  const scanCardSummaries = document.querySelectorAll("[data-scan-card-summary]");
  const scanCardResults = document.querySelectorAll("[data-scan-card-result]");
  const scanCardStatuses = document.querySelectorAll("[data-scan-card-status]");
  const scanCardExpiries = document.querySelectorAll("[data-scan-card-expiry]");
  const scanCardActions = document.querySelectorAll("[data-scan-card-action]");
  const registerMemberForms = document.querySelectorAll("[data-register-member-form]");
  const phoneNumberInputs = document.querySelectorAll(
    "input[name='mobileNumber']"
  );
  const registerMemberMessages = document.querySelectorAll("[data-register-member-message]");
  const memberDirectoryBody = document.querySelector("[data-member-directory-body]");
  const staticMemberDirectoryMarkup = memberDirectoryBody ? memberDirectoryBody.innerHTML : "";
  const memberDirectoryNote = document.querySelector("[data-member-directory-note]");
  const memberDetailNames = document.querySelectorAll("[data-live-member-name]");
  const memberDetailSummaries = document.querySelectorAll("[data-live-member-summary]");
  const memberDetailIds = document.querySelectorAll("[data-live-member-id]");
  const memberDetailAccess = document.querySelectorAll("[data-live-member-access]");
  const expiredDetailNames = document.querySelectorAll("[data-live-expired-name]");
  const expiredDetailSummaries = document.querySelectorAll("[data-live-expired-summary]");
  const expiredDetailIds = document.querySelectorAll("[data-live-expired-id]");
  const expiredDetailAccess = document.querySelectorAll("[data-live-expired-access]");
  const memberStatusNames = document.querySelectorAll("[data-live-member-status-name]");
  const memberStatusSummaries = document.querySelectorAll("[data-live-member-status-summary]");
  const expiredStatusNames = document.querySelectorAll("[data-live-expired-status-name]");
  const expiredStatusSummaries = document.querySelectorAll(
    "[data-live-expired-status-summary]"
  );
  const directoryMemberNames = document.querySelectorAll("[data-live-directory-name]");
  const directoryMemberIds = document.querySelectorAll("[data-live-directory-member-id]");
  const directoryMemberStatuses = document.querySelectorAll("[data-live-directory-status]");
  const directoryMemberExpiries = document.querySelectorAll("[data-live-directory-expiry]");
  const expiredDirectoryNames = document.querySelectorAll(
    "[data-live-expired-directory-name]"
  );
  const expiredDirectoryIds = document.querySelectorAll(
    "[data-live-expired-directory-id]"
  );
  const expiredDirectoryStatuses = document.querySelectorAll(
    "[data-live-expired-directory-status]"
  );
  const expiredDirectoryExpiries = document.querySelectorAll(
    "[data-live-expired-directory-expiry]"
  );
  const contextualRenewLinks = document.querySelectorAll("[data-contextual-renew-link]");
  const scanLabelToneClasses = [
    "tag-primary",
    "tag-success",
    "tag-warning",
    "tag-danger"
  ];
  let lastCapturePayload = null;
  let lastLookupState = "ready";

  const setNodeText = (nodes, text) => {
    nodes.forEach((node) => {
      node.textContent = text;
    });
  };

  const formatDateInputValue = (value = new Date()) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const formatFingerLabel = (value) =>
    String(value || "RIGHT_INDEX")
      .toLowerCase()
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");

  const applyDefaultStartDates = (scope = document) => {
    const todayValue = formatDateInputValue(new Date());
    scope.querySelectorAll("[data-default-start-date]").forEach((input) => {
      if (!input.value) {
        input.value = todayValue;
      }

      input.max = todayValue;
    });
  };

  const submitRegistrationRequest = async (endpoint, payload, allowLegacyFallback = false) => {
    try {
      return await readFingerprintResponse(endpoint, {
        method: "POST",
        body: JSON.stringify(payload)
      });
    } catch (error) {
      const routeMissing = /route not found/i.test(String(error?.message || ""));
      if (
        allowLegacyFallback &&
        routeMissing &&
        endpoint !== "/api/members/register-from-scan"
      ) {
        return readFingerprintResponse("/api/members/register-from-scan", {
          method: "POST",
          body: JSON.stringify(payload)
        });
      }

      throw error;
    }
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const formatCurrency = (value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue)
      ? `P${numericValue.toLocaleString("en-PH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2
        })}`
      : "P0.00";
  };

  const getInitials = (fullName) =>
    String(fullName || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "GM";

  const formatLastVisit = (value) => {
    if (!value) {
      return "No visit yet";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    const today = new Date();
    const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
    const valueKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const yesterdayKey = `${yesterday.getFullYear()}-${yesterday.getMonth()}-${yesterday.getDate()}`;

    if (valueKey === todayKey) {
      return `Today, ${timeFormatter.format(date)}`;
    }

    if (valueKey === yesterdayKey) {
      return `Yesterday, ${timeFormatter.format(date)}`;
    }

    return shortDateTimeFormatter.format(date);
  };

  const formatExpiry = (value) => {
    if (!value) {
      return "No expiry";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }

    return longDateFormatter.format(date);
  };

  const getStatusTagClass = (status) => {
    const normalizedStatus = String(status || "").toLowerCase();

    if (normalizedStatus.includes("active")) return "tag-success";
    if (normalizedStatus.includes("day pass")) return "tag-primary";
    if (normalizedStatus.includes("expired")) return "tag-danger";
    if (normalizedStatus.includes("renew") || normalizedStatus.includes("due")) return "tag-warning";
    return "tag-danger";
  };

  const parseValidDate = (value) => {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const isSameCalendarDay = (left, right = new Date()) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();

  const formatDetailedTimestamp = (value, fallback = "No record yet") => {
    const date = parseValidDate(value);
    return date ? longDateTimeFormatter.format(date) : fallback;
  };

  const buildRenewalPageHref = (member, preferredPlanCode = null) => {
    const params = new URLSearchParams();
    const memberId = String(member?.id || "").trim();
    const planCode = String(preferredPlanCode || member?.planCode || "")
      .trim()
      .toUpperCase();

    if (memberId) {
      params.set("memberId", memberId);
      if (planCode) {
        params.set("planCode", planCode);
      }
    }

    const queryString = params.toString();
    return queryString ? `renew-membership.html?${queryString}` : "renew-membership.html";
  };

  const buildRecentActivityState = (member, now = new Date()) => {
    const lastScanDate = parseValidDate(member?.lastScanAt);
    const lastVisitDate = parseValidDate(member?.lastVisitAt);
    const scanReferenceDate = lastScanDate || lastVisitDate;

    if (!scanReferenceDate) {
      return {
        title: "No recent scan",
        summary:
          "No scan or visit record has been captured yet. Test mode will flag scans from the last 2 minutes as recent activity once this member scans in."
      };
    }

    const elapsedMs = now.getTime() - scanReferenceDate.getTime();
    const withinTestWindow =
      elapsedMs >= 0 && elapsedMs <= recentActivityTestWindowMs;
    const scannedToday = isSameCalendarDay(scanReferenceDate, now);
    const lastScanText = formatDetailedTimestamp(scanReferenceDate);
    const lastVisitText = lastVisitDate
      ? `Last granted visit: ${formatDetailedTimestamp(lastVisitDate)}.`
      : "No granted visit has been recorded yet.";

    if (withinTestWindow) {
      return {
        title: "Recent activity detected",
        summary: `Last scan: ${lastScanText}. Test mode treats scans from the last ${recentActivityTestWindowLabel} as recent activity. ${lastVisitText}`
      };
    }

    if (scannedToday) {
      return {
        title: "Visited today",
        summary: `Last scan: ${lastScanText}. This scan is outside the ${recentActivityTestWindowLabel} test window, but same-day tracking still rolls up from 12:00 AM. ${lastVisitText}`
      };
    }

    return {
      title: "No recent activity",
      summary: `Last recorded scan: ${lastScanText}. Test mode currently highlights only the last ${recentActivityTestWindowLabel} as recent activity. ${lastVisitText}`
    };
  };

  const buildMemberSnapshotModal = (member) => {
    const expiryText = formatExpiry(member?.expiryDate);
    const registeredText = formatDetailedTimestamp(
      member?.registeredAt,
      "Registration time unavailable"
    );
    const recentActivity = buildRecentActivityState(member);
    const primaryAction =
      String(member?.action || "").toLowerCase() === "renew"
        ? `<a class="button" href="${escapeHtml(
            buildRenewalPageHref(member)
          )}">Renew Membership</a>`
        : '<a class="button" href="member-list.html">Open Member List</a>';

    return {
      title: member?.fullName || "Member Snapshot",
      body: `
        <div class="grid grid-two">
          <div class="status-card">
            <small class="sidebar-label">Membership Record</small>
            <h4>${escapeHtml(member?.plan || "No plan assigned")}</h4>
            <p>Member ID: ${escapeHtml(member?.memberId || "Unavailable")} • Registered ${escapeHtml(registeredText)}</p>
          </div>
          <div class="status-card">
            <small class="sidebar-label">Current Status</small>
            <h4>${escapeHtml(member?.status || "Unknown")}</h4>
            <p>Expiry date: ${escapeHtml(expiryText)}</p>
          </div>
          <div class="status-card">
            <small class="sidebar-label">Recent Activity</small>
            <h4>${escapeHtml(recentActivity.title)}</h4>
            <p>${escapeHtml(recentActivity.summary)}</p>
          </div>
          <div class="status-card">
            <small class="sidebar-label">Phone Number</small>
            <h4>${escapeHtml(member?.mobileNumber || "No phone number on file")}</h4>
            <p>Use this contact number for renewal follow-up, access concerns, and front desk updates.</p>
          </div>
        </div>
      `,
      footer: `
        <button class="button-ghost" type="button" data-modal-close>Close</button>
        ${primaryAction}
      `
    };
  };

  const buildDeleteConfirmationModal = (member) => ({
    title: `Delete ${member?.fullName || "member"}?`,
    body: `
      <div class="grid">
        <div class="status-card">
          <small class="sidebar-label">Permanent Deletion</small>
          <h4>This action cannot be undone</h4>
          <p>${escapeHtml(member?.fullName || "This member")} (${escapeHtml(
            member?.memberId || "Unavailable"
          )}) will be permanently removed together with the linked fingerprint templates and related scan records in the active backend source.</p>
        </div>
        <div class="status-card">
          <small class="sidebar-label">Second Confirmation</small>
          <h4>Delete only if you are certain</h4>
          <p>Select <strong>Permanently Delete</strong> below to complete the removal.</p>
        </div>
      </div>
    `,
    footer: `
      <button class="button-ghost" type="button" data-modal-close>Cancel</button>
      <button
        class="button-danger"
        type="button"
        data-member-delete-confirm
        data-member-key="${escapeHtml(member?.id || "")}"
        data-member-code="${escapeHtml(member?.memberId || "")}"
        data-member-name="${escapeHtml(member?.fullName || "")}"
      >
        Permanently Delete
      </button>
    `
  });

  const deleteMemberRecord = async (member) => {
    if (!member?.id) {
      renderModal({
        title: "Delete unavailable",
        body: `
          <div class="status-card">
            <small class="sidebar-label">Delete Member</small>
            <h4>Live member id is missing</h4>
            <p>This row does not have a backend member id, so permanent deletion cannot continue from this state.</p>
          </div>
        `,
        footer: `
          <button class="button-ghost" type="button" data-modal-close>Close</button>
        `
      });
      return;
    }

    try {
      const payload = await readFingerprintResponse(
        `/api/members/${encodeURIComponent(member.id)}`,
        {
          method: "DELETE"
        }
      );

      await loadMemberDirectory({
        noteOverride: `${payload.member.fullName} (${payload.member.memberId}) was permanently deleted from ${
          payload.source === "file-store" ? "the backend local store" : "PostgreSQL"
        }.`
      });
      closeModal();
    } catch (error) {
      const isLocalApiOffline = /Cannot reach the local GymFlow API/i.test(
        String(error?.message || "")
      );

      if (isLocalApiOffline) {
        showStaticMemberDirectoryFallback(
          `${error.message} Showing the static demo rows instead.`
        );
      }

      renderModal({
        title: isLocalApiOffline ? "Local API offline" : "Delete failed",
        body: `
          <div class="status-card">
            <small class="sidebar-label">Delete Member</small>
            <h4>${
              isLocalApiOffline
                ? "Permanent deletion is unavailable while the local API is offline"
                : "Permanent deletion could not complete"
            }</h4>
            <p>${escapeHtml(error.message)}</p>
            ${
              isLocalApiOffline
                ? "<p>No member data was deleted. The directory has been switched back to the static demo rows until the local API is running again.</p>"
                : ""
            }
          </div>
        `,
        footer: `
          <button class="button-ghost" type="button" data-modal-close>Close</button>
        `
      });
    }
  };

  const setRegisterMemberMessage = (text, tone = "muted") => {
    registerMemberMessages.forEach((node) => {
      node.textContent = text;
      node.dataset.messageTone = tone;
      node.classList.remove("helper-success", "helper-danger", "helper-warning");

      if (tone === "success") {
        node.classList.add("helper-success");
      } else if (tone === "danger") {
        node.classList.add("helper-danger");
      } else if (tone === "warning") {
        node.classList.add("helper-warning");
      }
    });
  };

  const setRegisterFormBusy = (busy) => {
    registerMemberForms.forEach((form) => {
      form.querySelectorAll("input, select, button").forEach((control) => {
        control.disabled = busy;
      });
    });
  };

  const formatMatchScore = (value) => {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue.toLocaleString() : null;
  };

  const isLookupStateExpired = (lookupState) => lookupState === "expired";

  const buildMemberAccessText = (member, lookupState = "member") => {
    const expiryText = formatExpiry(member.expiryDate);
    const expiryDate = member.expiryDate ? new Date(member.expiryDate) : null;

    if (isLookupStateExpired(lookupState)) {
      return `Blocked. Membership expired on ${expiryText}.`;
    }

    if (
      member.planCode === "DAY_PASS" &&
      expiryDate &&
      !Number.isNaN(expiryDate.getTime())
    ) {
      return `Valid until ${timeFormatter.format(expiryDate)}`;
    }

    return `Active until ${expiryText}`;
  };

  const buildMemberSummaryText = (member, lookupState = "member") => {
    const expiryText = formatExpiry(member.expiryDate);

    if (isLookupStateExpired(lookupState)) {
      return `Fingerprint matched ${member.fullName}, but the membership expired on ${expiryText}. Renew before access is allowed.`;
    }

    return `Fingerprint matched ${member.fullName}. Membership is active until ${expiryText} and access is allowed.`;
  };

  const buildMemberStatusSummaryText = (member, lookupState = "member") => {
    const expiryText = formatExpiry(member.expiryDate);

    if (isLookupStateExpired(lookupState)) {
      return `Match found. ${member.fullName} has an expired membership. Last expiry date: ${expiryText}.`;
    }

    return `Match found. ${member.status} membership is active until ${expiryText}.`;
  };

  const buildRegisteredMemberSummaryText = (member) =>
    `${member.status} membership saved under ${member.memberId}. Start date: ${formatExpiry(
      member.registeredAt
    )}. Expiry date: ${formatExpiry(member.expiryDate)}.`;

  const buildRegisteredInlineSummaryText = (member) =>
    `${member.fullName} was saved as ${member.memberId}. Membership started on ${formatExpiry(
      member.registeredAt
    )} and expires on ${formatExpiry(member.expiryDate)}.`;

  const updateLiveMemberPanels = (
    member,
    { mode = "matched", lookupState = "member" } = {}
  ) => {
    if (!member) return;

    const expiryText = formatExpiry(member.expiryDate);
    const summaryText =
      mode === "registered"
        ? buildRegisteredMemberSummaryText(member)
        : buildMemberStatusSummaryText(member, lookupState);
    const inlineSummaryText =
      mode === "registered"
        ? buildRegisteredInlineSummaryText(member)
        : buildMemberSummaryText(member, "member");

    setNodeText(memberDetailNames, member.fullName);
    setNodeText(memberDetailSummaries, inlineSummaryText);
    setNodeText(memberDetailIds, member.memberId);
    setNodeText(memberDetailAccess, buildMemberAccessText(member, "member"));
    setNodeText(expiredDetailNames, member.fullName);
    setNodeText(expiredDetailSummaries, buildMemberSummaryText(member, "expired"));
    setNodeText(expiredDetailIds, member.memberId);
    setNodeText(expiredDetailAccess, buildMemberAccessText(member, "expired"));
    setNodeText(memberStatusNames, member.fullName);
    setNodeText(memberStatusSummaries, summaryText);
    setNodeText(expiredStatusNames, member.fullName);
    setNodeText(
      expiredStatusSummaries,
      buildMemberStatusSummaryText(member, "expired")
    );
    setNodeText(directoryMemberNames, member.fullName);
    setNodeText(directoryMemberIds, member.memberId);
    setNodeText(directoryMemberStatuses, `${member.status} membership`);
    setNodeText(directoryMemberExpiries, expiryText);
    setNodeText(expiredDirectoryNames, member.fullName);
    setNodeText(expiredDirectoryIds, member.memberId);
    setNodeText(expiredDirectoryStatuses, `${member.status} membership`);
    setNodeText(expiredDirectoryExpiries, expiryText);
    contextualRenewLinks.forEach((link) => {
      link.setAttribute("href", buildRenewalPageHref(member));
    });
  };

  const resetContextualRenewLinks = () => {
    contextualRenewLinks.forEach((link) => {
      link.setAttribute("href", "renew-membership.html");
    });
  };

  const normalizeRenewRouteError = (error) => {
    const message = String(error?.message || error || "");

    if (/route not found/i.test(message)) {
      return "Renewal routes are unavailable on the running local API. Restart `npm run fingerprint:bridge` or `npm run dev`, then try again.";
    }

    return message;
  };

  const defaultScanVisualConfigs = {
    ready: {
      badge: "Scanner Ready",
      kicker: "Fingerprint Verification",
      title: "Scanner ready for member check-in",
      summary:
        "Check the fingerprint reader first. Once the scanner is online, detect a fingerprint and verify whether this person already has a valid member record.",
      result: "Waiting for fingerprint",
      status: "Scanner online",
      expiry: "No expiry on file",
      action: "Detect member"
    },
    checking: {
      badge: "Checking Reader",
      kicker: "Fingerprint Hardware",
      title: "Verifying scanner connection",
      summary: "The front desk is confirming that the fingerprint reader bridge is online before a member check starts.",
      result: "Reader status request sent",
      status: "Reader check in progress",
      expiry: "No member lookup yet",
      action: "Access pending"
    },
    listening: {
      badge: "Detecting Finger",
      kicker: "Fingerprint Capture",
      title: "Waiting for fingerprint touch",
      summary:
        "The reader is active and waiting for one finger contact so the member verification can continue.",
      result: "Capture window open",
      status: "Waiting for member match",
      expiry: "No expiry on file",
      action: "Access pending"
    },
    detected: {
      badge: "Fingerprint Captured",
      kicker: "Fingerprint Capture",
      title: "Fingerprint captured successfully",
      summary:
        "A usable fingerprint was detected. The system is preparing the verification result now.",
      result: "Capture complete",
      status: "Preparing member lookup",
      expiry: "Reading stored expiry",
      action: "Access pending"
    },
    scanning: {
      badge: "Matching Record",
      kicker: "Fingerprint Verification",
      title: "Checking the member database",
      summary:
        "The fingerprint is being matched against the saved member database and access status.",
      result: "Fingerprint under review",
      status: "Matching member record",
      expiry: "Reading stored expiry",
      action: "Access pending"
    },
    member: {
      badge: "Active Member",
      kicker: "Fingerprint Verification",
      title: "Registered member verified",
      summary:
        "This fingerprint matches an active member record, so the front desk can continue the access flow.",
      result: "Profile match confirmed",
      status: "Active membership",
      expiry: "Expires May 19, 2026",
      action: "Allowed until 9:00 PM"
    },
    registered: {
      badge: "Member Registered",
      kicker: "New Member Enrollment",
      title: "New gym member saved",
      summary: "The member profile and captured fingerprint were saved successfully. The next scan can start from the default reader state.",
      result: "Member profile saved",
      status: "Active membership",
      expiry: "Expiry date available",
      action: "Allowed until 9:00 PM"
    },
    nonmember: {
      badge: "Not Found",
      kicker: "Gym Member Detection",
      title: "No gym member record found",
      summary: "This fingerprint does not match any registered gym-member profile in the current lookup result.",
      result: "No profile match",
      status: "Not registered",
      expiry: "No expiry on file",
      action: "Registration required"
    },
    expired: {
      badge: "Expired",
      kicker: "Gym Member Detection",
      title: "Matched member has expired membership",
      summary: "The fingerprint matches a stored member, but the membership is already expired and access stays blocked.",
      result: "Profile match confirmed",
      status: "Expired membership",
      expiry: "Expired April 20, 2026",
      action: "Blocked until renewed"
    },
    missing: {
      badge: "No Finger",
      kicker: "Fingerprint Capture",
      title: "No finger was detected",
      summary: "The reader did not detect a usable fingerprint within the scan window, so the member lookup did not start.",
      result: "Capture timed out",
      status: "Verification not started",
      expiry: "No expiry available",
      action: "Access pending"
    },
    error: {
      badge: "Scan Failed",
      kicker: "Fingerprint Capture",
      title: "Fingerprint scan could not complete",
      summary: "The scanner bridge or capture request did not return a valid result, so the member lookup is unavailable.",
      result: "Bridge or capture error",
      status: "Verification unavailable",
      expiry: "No expiry available",
      action: "Access pending"
    }
  };

  const captureSaveVisualConfigs = {
    ready: {
      badge: "Standby",
      kicker: "Fingerprint Capture",
      title: "Ready to capture fingerprint template",
      summary:
        "Check the reader, capture the fingerprint template, then complete the detailed member form.",
      result: "Waiting for fingerprint",
      status: "No template saved yet",
      expiry: "Start date comes from the form",
      action: "Check reader, then capture fingerprint"
    },
    checking: {
      badge: "Checking Reader",
      kicker: "Fingerprint Hardware",
      title: "Verifying scanner connection",
      summary:
        "The page is confirming that the fingerprint reader bridge is ready before capture starts.",
      result: "Reader status request sent",
      status: "Bridge check in progress",
      expiry: "Form save is waiting",
      action: "Wait for reader readiness"
    },
    listening: {
      badge: "Capture In Progress",
      kicker: "Fingerprint Capture",
      title: "Waiting for finger contact",
      summary:
        "The reader is active and waiting for a finger so the template can be stored in this page session.",
      result: "Capture window open",
      status: "Reader is listening",
      expiry: "Save route not called yet",
      action: "Ask the person to touch the reader"
    },
    detected: {
      badge: "Template Ready",
      kicker: "Fingerprint Capture",
      title: "Fingerprint template captured",
      summary:
        "The fingerprint template has been captured and is ready to be saved with the member form.",
      result: "Capture complete",
      status: "Ready for form submission",
      expiry: "Use the selected start date",
      action: "Complete the form and save"
    },
    scanning: {
      badge: "Saving Record",
      kicker: "Backend Submission",
      title: "Saving member record",
      summary:
        "The page is sending the member details and captured fingerprint template to the backend save route.",
      result: "Submission in progress",
      status: "Waiting for backend response",
      expiry: "Save pending",
      action: "Do not close the page"
    },
    registered: {
      badge: "Saved",
      kicker: "Registration Complete",
      title: "Member record saved",
      summary:
        "The member profile and captured fingerprint template were saved successfully. You can open the member directory or capture the next record.",
      result: "Member profile saved",
      status: "Save complete",
      expiry: "Expiry date available",
      action: "Open member list"
    },
    missing: {
      badge: "No Finger",
      kicker: "Fingerprint Capture",
      title: "No finger was detected",
      summary:
        "The reader did not detect a usable fingerprint within the scan window, so no template was saved.",
      result: "Capture timed out",
      status: "No template available",
      expiry: "Form save blocked",
      action: "Clear the reader and retry"
    },
    error: {
      badge: "Capture Failed",
      kicker: "Fingerprint Capture",
      title: "Fingerprint capture could not complete",
      summary:
        "The scanner bridge or capture request did not return a valid fingerprint template, so the member form cannot be saved yet.",
      result: "Bridge or capture error",
      status: "Template unavailable",
      expiry: "Form save blocked",
      action: "Check the bridge and retry"
    }
  };

  const scanVisualConfigs = captureSaveMode
    ? {
        ...defaultScanVisualConfigs,
        ...captureSaveVisualConfigs
      }
    : defaultScanVisualConfigs;

  const defaultScanLabelConfigs = {
    ready: { text: "Ready to scan", tone: "primary" },
    checking: { text: "Checking reader", tone: "warning" },
    listening: { text: "Detecting finger", tone: "warning" },
    detected: { text: "Fingerprint captured", tone: "warning" },
    scanning: { text: "Matching member", tone: "warning" },
    member: { text: "Member verified", tone: "success" },
    registered: { text: "Member registered", tone: "success" },
    nonmember: { text: "Save member record", tone: "danger" },
    expired: { text: "Expired member", tone: "danger" },
    missing: { text: "No finger detected", tone: "danger" },
    error: { text: "Capture failed", tone: "danger" }
  };

  const captureSaveScanLabelConfigs = {
    ready: { text: "Ready to capture", tone: "primary" },
    checking: { text: "Checking reader", tone: "warning" },
    listening: { text: "Capture in progress", tone: "warning" },
    detected: { text: "Capture ready", tone: "success" },
    scanning: { text: "Saving record", tone: "warning" },
    registered: { text: "Record saved", tone: "success" },
    missing: { text: "No finger detected", tone: "danger" },
    error: { text: "Capture failed", tone: "danger" }
  };

  const scanLabelConfigs = captureSaveMode
    ? {
        ...defaultScanLabelConfigs,
        ...captureSaveScanLabelConfigs
      }
    : defaultScanLabelConfigs;

  const scanPanelFallbacks = captureSaveMode
    ? {
        checking: "ready",
        listening: "ready",
        detected: "detected",
        scanning: "scanning",
        registered: "registered",
        missing: "missing",
        error: "error"
      }
    : {
        checking: "ready",
        listening: "scanning",
        detected: "scanning",
        registered: "registered",
        missing: "ready",
        error: "ready"
      };

  const setInlineScanState = (state) => {
    inlineScanOutputs.forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.scanInline === state);
    });
  };

  const setSidebarScanState = (state) => {
    const sidebarState = scanPanelFallbacks[state] || state;
    scanOutputs.forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.scanOutput === sidebarState);
    });
  };

  const setLiveScanLabel = (state, textOverride) => {
    if (!scanLabel) return;

    const config = scanLabelConfigs[state] || scanLabelConfigs.ready;
    scanLabel.classList.remove(...scanLabelToneClasses);
    scanLabel.classList.add(`tag-${config.tone}`);
    scanLabel.textContent = textOverride || config.text;
  };

  const setScanVisualState = (state = "ready", overrides = {}) => {
    const config = {
      ...(scanVisualConfigs[state] || scanVisualConfigs.ready),
      ...overrides
    };

    scanShells.forEach((shell) => {
      shell.dataset.scanVisualState = state;
    });

    scanners.forEach((scanner) => {
      scanner.dataset.scanFeedback = config.badge;
      scanner.setAttribute("aria-label", `${config.badge}: ${config.title}`);
    });

    setScanFeedbackBadgeState(state);
    setNodeText(scanFeedbackBadges, config.badge);
    setNodeText(scanCardKickers, config.kicker);
    setNodeText(scanCardTitles, config.title);
    setNodeText(scanCardSummaries, config.summary);
    setNodeText(scanCardResults, config.result);
    setNodeText(scanCardStatuses, config.status);
    setNodeText(scanCardExpiries, config.expiry);
    setNodeText(scanCardActions, config.action);
  };

  const setScanState = (state = "ready", overrides = {}) => {
    lastLookupState = state;
    setInlineScanState(state);
    setSidebarScanState(state);
    setLiveScanLabel(state, overrides.label);
    setScanVisualState(state, overrides.visual);
  };

  const buildLookupOutcome = (lookupPayload, capturePayload) => {
    const lookupState = lookupPayload.lookupState || "nonmember";
    const member = lookupPayload.member;
    const capturedAt = capturePayload.timestamp
      ? new Date(capturePayload.timestamp).toLocaleString()
      : "Unknown time";
    const scoreText = formatMatchScore(lookupPayload.fingerprint?.score);
    const thresholdText = formatMatchScore(
      lookupPayload.fingerprint?.thresholdScore
    );
    const scoreSummary =
      scoreText && thresholdText
        ? ` • Score ${scoreText} / ${thresholdText}`
        : "";
    const sharedDetail = `Reader: ${capturePayload.readerSerial || "Detected"} • Mode: ${capturePayload.captureMode || "Unavailable"} • Delta: ${capturePayload.contactMeanAbsDiff ?? "n/a"}`;

    if (lookupState === "member" && member) {
      return {
        alert: {
          tone: "success",
          title: "Match found",
          text: buildMemberSummaryText(member, "member"),
          readerState: capturePayload.readerStatus || "Member matched",
          serial: capturePayload.readerSerial || "Reader detected",
          detail: sharedDetail,
          captureState: "Matched member",
          captureMetaText: `Captured at ${capturedAt}${scoreSummary}`
        },
        visual: {
          badge: "Active Member",
          title: member.fullName,
          summary: buildMemberSummaryText(member, "member"),
          result: "Match found",
          status: `${member.status} membership`,
          expiry: `Expires ${formatExpiry(member.expiryDate)}`,
          action: buildMemberAccessText(member, "member")
        }
      };
    }

    if (lookupState === "expired" && member) {
      return {
        alert: {
          tone: "danger",
          title: "Match found but membership is expired",
          text: buildMemberSummaryText(member, "expired"),
          readerState: capturePayload.readerStatus || "Match found",
          serial: capturePayload.readerSerial || "Reader detected",
          detail: sharedDetail,
          captureState: "Expired membership",
          captureMetaText: `Captured at ${capturedAt}${scoreSummary}`
        },
        visual: {
          title: member.fullName,
          summary: buildMemberSummaryText(member, "expired"),
          badge: "Expired",
          result: "Match found",
          status: `${member.status} membership`,
          expiry: `Expired ${formatExpiry(member.expiryDate)}`,
          action: buildMemberAccessText(member, "expired")
        }
      };
    }

    return {
      alert: {
        tone: "danger",
        title: "No match found",
        text: "Fingerprint was captured, but no registered gym member record matched. Continue with the member form.",
        readerState: capturePayload.readerStatus || "No match found",
        serial: capturePayload.readerSerial || "Reader detected",
        detail: sharedDetail,
        captureState: "No member match",
        captureMetaText: scoreSummary
          ? `Captured at ${capturedAt}${scoreSummary} • Member form required`
          : `Captured at ${capturedAt} • Member form required`
      },
      visual: {
        badge: "Not Found",
        result: "No match found",
        status: "Not registered",
        expiry: "No expiry on file",
        action: "Complete member form"
      }
    };
  };

  const showNonMemberFallback = (capturePayload, reasonMessage) => {
    const outcome = buildLookupOutcome(
      {
        lookupState: "nonmember",
        matchFound: false
      },
      capturePayload
    );

    setCaptureAlert({
      ...outcome.alert,
      title: "Save member record",
      text: reasonMessage
    });
    setScanState("nonmember", {
      visual: outcome.visual
    });
    setRegisterMemberMessage(
      "No member matched. Complete the member form to save the profile and captured fingerprint.",
      "warning"
    );
    resetContextualRenewLinks();
  };

  const readerCheckButton = document.querySelector("[data-reader-check]");
  const captureButton = document.querySelector("[data-capture-trigger]");
  const captureAlert = document.querySelector("[data-capture-alert]");
  const captureTitle = document.querySelector("[data-capture-title]");
  const captureText = document.querySelector("[data-capture-text]");
  const readerStatus = document.querySelector("[data-reader-status]");
  const readerSerial = document.querySelector("[data-reader-serial]");
  const readerDetail = document.querySelector("[data-reader-detail]");
  const captureStatus = document.querySelector("[data-capture-status]");
  const captureMeta = document.querySelector("[data-capture-meta]");

  const captureToneClasses = [
    "capture-alert-info",
    "capture-alert-success",
    "capture-alert-warning",
    "capture-alert-danger"
  ];
  const captureStatusToneClasses = [
    "tag-primary",
    "tag-success",
    "tag-warning",
    "tag-danger"
  ];
  const readerStatusStateClasses = [
    "reader-status-checked",
    "reader-status-warning",
    "reader-status-danger"
  ];
  const scanFeedbackBadgeStateClasses = [
    "scanner-badge-checked",
    "scanner-badge-warning",
    "scanner-badge-danger"
  ];

  const hasOwn = (object, key) =>
    Object.prototype.hasOwnProperty.call(object, key);

  const setReaderStatusBadgeState = (tone = "info") => {
    if (!readerStatus) return;

    readerStatus.classList.remove(...readerStatusStateClasses);
    if (tone === "success") {
      readerStatus.classList.add("reader-status-checked");
      return;
    }

    if (tone === "warning") {
      readerStatus.classList.add("reader-status-warning");
      return;
    }

    if (tone === "danger") {
      readerStatus.classList.add("reader-status-danger");
    }
  };

  const setScanFeedbackBadgeState = (state = "ready") => {
    const variant =
      state === "ready" || state === "member" || state === "registered"
        ? "scanner-badge-checked"
        : state === "checking" || state === "listening" || state === "detected" || state === "scanning"
          ? "scanner-badge-warning"
          : state === "expired" || state === "missing" || state === "error" || state === "nonmember"
            ? "scanner-badge-danger"
            : "";

    scanFeedbackBadges.forEach((badge) => {
      badge.classList.remove(...scanFeedbackBadgeStateClasses);
      if (variant) {
        badge.classList.add(variant);
      }
    });
  };

  const setCaptureAlert = (config = {}) => {
    if (!captureAlert) return;

    const tone = config.tone || "info";
    captureAlert.classList.remove(...captureToneClasses);
    captureAlert.classList.add(`capture-alert-${tone}`);

    if (captureTitle && hasOwn(config, "title")) {
      captureTitle.textContent = config.title;
    }

    if (captureText && hasOwn(config, "text")) {
      captureText.textContent = config.text;
    }

    if (readerStatus && hasOwn(config, "readerState")) {
      readerStatus.classList.remove(...captureStatusToneClasses);
      readerStatus.classList.add(
        tone === "success"
          ? "tag-success"
          : tone === "warning"
            ? "tag-warning"
            : tone === "danger"
              ? "tag-danger"
              : "tag-primary"
      );
      setReaderStatusBadgeState(tone);
      readerStatus.textContent = config.readerState;
    }

    if (readerSerial && hasOwn(config, "serial")) {
      readerSerial.textContent = config.serial;
    }

    if (readerDetail && hasOwn(config, "detail")) {
      readerDetail.textContent = config.detail;
    }

    if (captureStatus && hasOwn(config, "captureState")) {
      captureStatus.textContent = config.captureState;
    }

    if (captureMeta && hasOwn(config, "captureMetaText")) {
      captureMeta.textContent = config.captureMetaText;
    }
  };

  const readFingerprintResponse = async (path, init = {}) => {
    const headers = {
      Accept: "application/json",
      ...(init.headers || {})
    };

    if (init.body && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    let response;

    try {
      response = await fetch(`${fingerprintApiBase}${path}`, {
        method: "GET",
        headers,
        ...init
      });
    } catch (error) {
      throw new Error(
        `Cannot reach the local GymFlow API at ${fingerprintApiBase}. ${localApiStartHint}`
      );
    }

    let payload;

    try {
      payload = await response.json();
    } catch (error) {
      payload = {
        success: false,
        message: "Bridge returned an unreadable response."
      };
    }

    if (!response.ok || payload.success === false) {
      const reason =
        payload.message ||
        `Bridge request failed with status ${response.status}.`;
      throw new Error(reason);
    }

    return payload;
  };

  const setFingerprintBusy = (busy) => {
    if (captureButton) {
      captureButton.disabled = busy;
    }
  };

  let readerReady = false;

  const classifyReaderStatusError = (error) => {
    const message = String(error?.message || error || "");

    if (/Cannot reach the local GymFlow API/i.test(message)) {
      return {
        title: "Bridge offline",
        text: `${message} Start the local API, then press Check Reader to retry the scanner check.`,
        readerState: "Bridge offline",
        serial: "Bridge not connected",
        detail: "The page could not reach the local fingerprint bridge.",
        captureState: "Scanner unavailable",
        captureMetaText: `Expected bridge URL: ${fingerprintApiBase}/api/fingerprint/status`,
        label: "Bridge offline",
        visual: {
          badge: "Bridge Offline",
          result: "Scanner bridge unavailable",
          status: "Verification paused",
          expiry: "No expiry available",
          action: "Start the local API and retry"
        }
      };
    }

    if (/No DigitalPersona reader was detected/i.test(message)) {
      return {
        title: "Scanner not detected",
        text: "The bridge is online, but no DigitalPersona reader is connected. Reconnect the reader, then press Check Reader to retry.",
        readerState: "Reader disconnected",
        serial: "No scanner connected",
        detail: "The bridge responded, but the fingerprint reader was not detected.",
        captureState: "Scanner unavailable",
        captureMetaText: "Reconnect the reader cable or power, then retry the reader status check.",
        label: "Reader disconnected",
        visual: {
          badge: "Reader Offline",
          result: "No scanner detected",
          status: "Verification paused",
          expiry: "No expiry available",
          action: "Reconnect the reader and retry"
        }
      };
    }

    if (/busy|in use|already open|already in use/i.test(message)) {
      return {
        title: "Scanner busy",
        text: "The fingerprint reader is currently busy with another request. Wait a moment, then press Check Reader to retry.",
        readerState: "Reader busy",
        serial: "Reader in use",
        detail: "Another capture session or status check is still using the scanner.",
        captureState: "Scanner temporarily busy",
        captureMetaText: "Wait for the current scanner session to finish before retrying.",
        label: "Reader busy",
        visual: {
          badge: "Reader Busy",
          result: "Scanner in use",
          status: "Verification paused",
          expiry: "No expiry available",
          action: "Wait, then retry"
        }
      };
    }

    if (/unreadable response/i.test(message)) {
      return {
        title: "Bridge response invalid",
        text: "The fingerprint bridge responded with unreadable data. Restart the bridge, then press Check Reader to retry.",
        readerState: "Bridge error",
        serial: "Invalid scanner response",
        detail: "The fingerprint status route returned a response that could not be parsed.",
        captureState: "Scanner unavailable",
        captureMetaText: `Bridge URL: ${fingerprintApiBase}/api/fingerprint/status`,
        label: "Bridge error",
        visual: {
          badge: "Bridge Error",
          result: "Invalid scanner response",
          status: "Verification paused",
          expiry: "No expiry available",
          action: "Restart the bridge and retry"
        }
      };
    }

    return {
      title: "Reader check failed",
      text: `${message} Press Check Reader to retry the scanner check.`,
      readerState: "Scanner unavailable",
      serial: "Reader state unknown",
      detail: "The scanner status request did not complete successfully.",
      captureState: "Verification unavailable",
      captureMetaText: `Bridge URL: ${fingerprintApiBase}/api/fingerprint/status`,
      label: "Scanner unavailable",
      visual: {
        badge: "Scanner Error",
        result: "Reader status unavailable",
        status: "Verification paused",
        expiry: "No expiry available",
        action: "Retry the scanner check"
      }
    };
  };

  const checkFingerprintReader = async () => {
    setFingerprintBusy(true);
    setScanState("checking", {
      label: "Checking reader"
    });
    setCaptureAlert({
      tone: "warning",
      title: "Checking DigitalPersona reader",
      text: "Opening the local bridge and verifying the connected fingerprint reader.",
      readerState: "Checking reader"
    });

    try {
      const payload = await readFingerprintResponse("/api/fingerprint/status");
      readerReady = true;
      setCaptureAlert({
        tone: "success",
        title: "Scanner online",
        text: captureSaveMode
          ? `DigitalPersona reader ${payload.readerSerial} is connected and ready to capture a fingerprint template.`
          : `DigitalPersona reader ${payload.readerSerial} is connected and ready for member verification.`,
        readerState: captureSaveMode
          ? payload.readerStatus || "Reader ready"
          : "Scanner ready",
        serial: payload.readerSerial || "Reader detected",
        detail: `SDK: ${payload.paths?.sdkAssemblyPath || "Unavailable"} • Driver: ${payload.paths?.deviceDriverPath || "Unavailable"}`,
        captureState: captureSaveMode
          ? "Ready to capture fingerprint"
          : "Ready for member verification",
        captureMetaText: captureSaveMode
          ? `Keep the scanner clear, click Capture Fingerprint, then touch the reader within ${contactDetectionTimeoutMs / 1000} seconds.`
          : `Keep the scanner clear, then press Detect Member and touch the reader within ${contactDetectionTimeoutMs / 1000} seconds.`
      });
      setScanState("ready", {
        label: captureSaveMode ? "Reader ready" : "Scanner ready",
        visual: {
          badge: "Scanner Ready",
          result: "Scanner online",
          status: captureSaveMode
            ? payload.readerStatus || "Ready for fingerprint capture"
            : "Waiting for active member scan",
          expiry: captureSaveMode ? "Form save pending" : "Member verification pending",
          action: captureSaveMode ? "Capture fingerprint" : "Detect member"
        }
      });
      return true;
    } catch (error) {
      readerReady = false;
      const failure = classifyReaderStatusError(error);
      setCaptureAlert({
        tone: "danger",
        title: failure.title,
        text: failure.text,
        readerState: failure.readerState,
        serial: failure.serial,
        detail: failure.detail,
        captureState: failure.captureState,
        captureMetaText: failure.captureMetaText
      });
      setScanState("error", {
        label: failure.label,
        visual: failure.visual
      });
      return false;
    } finally {
      setFingerprintBusy(false);
    }
  };

  if (scanShells.length || scanners.length || scanOutputs.length || inlineScanOutputs.length) {
    setScanState("ready");
    resetContextualRenewLinks();
  }

  if (readerCheckButton || captureButton) {
    if (readerCheckButton) {
      readerCheckButton.addEventListener("click", async () => {
        await checkFingerprintReader();
      });
    }

    if (captureButton) {
      captureButton.addEventListener("click", async () => {
        if (!readerReady) {
          setCaptureAlert({
            tone: "warning",
            title: "Reader check required",
            text: captureSaveMode
              ? "Check the reader first so the page can confirm the scanner is connected before fingerprint capture starts."
              : "Check the reader first so the page can confirm the scanner is connected before member detection starts.",
            readerState: "Reader check required",
            captureState: captureSaveMode
              ? "Reader must be verified before capture"
              : "Reader must be verified before member detection",
            captureMetaText: `Bridge URL: ${fingerprintApiBase}/api/fingerprint/status`
          });
          setScanState("ready", {
            label: "Check reader first",
            visual: {
              badge: "Reader Check Required",
              result: "Scanner status not verified",
              status: "Verification paused",
              expiry: captureSaveMode ? "Form save pending" : "Member verification pending",
              action: "Run Check Reader"
            }
          });
          return;
        }

        setFingerprintBusy(true);
        setScanState("listening");
        setCaptureAlert({
          tone: "warning",
          title: "Waiting for finger contact",
          text: captureSaveMode
            ? `Keep the reader clear, then place a finger on the DigitalPersona 4500 reader and hold it steady until the fingerprint template capture finishes.`
            : `Keep the reader clear, then place a finger on the DigitalPersona 4500 reader and hold it steady until the capture finishes. Contact detection will wait up to ${contactDetectionTimeoutMs / 1000} seconds.`,
          readerState: "Detection in progress",
          captureState: "Listening for contact"
        });

        try {
          const payload = await readFingerprintResponse("/api/fingerprint/capture", {
            method: "POST",
            body: JSON.stringify({
              timeout: contactDetectionTimeoutMs
            })
          });

          if (payload.captured) {
            lastCapturePayload = payload;
            if (captureSaveMode) {
              setCaptureAlert({
                tone: "success",
                title: payload.contactDetected ? "Fingerprint captured" : "Capture completed",
                text: "The fingerprint template was captured successfully. Complete the form, then save the member record.",
                readerState: payload.readerStatus || "Reader ready",
                serial: payload.readerSerial || "Reader detected",
                detail: `Driver: ${payload.paths?.deviceDriverPath || "Unavailable"} • Mode: ${payload.captureMode || "Unavailable"} • Delta: ${payload.contactMeanAbsDiff ?? "n/a"}`,
                captureState: "Template ready to save",
                captureMetaText: `Captured at ${new Date(payload.timestamp).toLocaleString()} • Form submission is now enabled`
              });
              setScanState("detected", {
                label: "Capture ready",
                visual: {
                  badge: "Template Ready",
                  result: payload.contactDetected
                    ? "Fingerprint captured"
                    : "Capture complete",
                  status: "Ready for form submission",
                  expiry: "Use the selected start date",
                  action: "Complete the form and save"
                }
              });
              setRegisterMemberMessage(
                "Fingerprint captured. Complete the detailed form, then save the member record.",
                "success"
              );
            } else {
              setCaptureAlert({
                tone: "warning",
                title: payload.contactDetected ? "Fingerprint captured" : "Capture completed",
                text: payload.contactDetected
                  ? "Finger contact was detected and a final fingerprint capture was completed. Matching the captured fingerprint to the inline member result now."
                  : "A fingerprint image was captured. Matching the inline member result now.",
                readerState: payload.readerStatus || "Reader ready",
                serial: payload.readerSerial || "Reader detected",
                detail: `Driver: ${payload.paths?.deviceDriverPath || "Unavailable"} • Mode: ${payload.captureMode || "Unavailable"} • Delta: ${payload.contactMeanAbsDiff ?? "n/a"}`,
                captureState: "Matching member record",
                captureMetaText: `Captured at ${new Date(payload.timestamp).toLocaleString()} • Inline result is loading`
              });
              setScanState("scanning", {
                visual: {
                  badge: payload.contactDetected ? "Finger Detected" : "Fingerprint Captured",
                  result: payload.contactDetected
                    ? "Fingerprint captured"
                    : "Capture complete",
                  status: "Matching member record",
                  expiry: "Result pending",
                  action: "Wait for the inline result"
                }
              });

              try {
                const lookupPayload = await readFingerprintResponse(
                  "/api/fingerprint/identify",
                  {
                    method: "POST",
                    body: JSON.stringify({
                      fingerLabel: "RIGHT_INDEX",
                      scanPayload: payload
                    })
                  }
                );
                const resultState = lookupPayload.lookupState || "nonmember";

                if (lookupPayload.member) {
                  updateLiveMemberPanels(lookupPayload.member, {
                    mode: "matched",
                    lookupState: resultState
                  });
                }

                const outcome = buildLookupOutcome(lookupPayload, payload);
                setCaptureAlert(outcome.alert);
                setScanState(resultState, {
                  visual: outcome.visual
                });

                if (resultState === "nonmember") {
                  setRegisterMemberMessage(
                    "No member matched. Complete the member form to save the profile and captured fingerprint.",
                    "warning"
                  );
                } else {
                  setRegisterMemberMessage(
                    "Capture a fingerprint with no match before saving the member record.",
                    "muted"
                  );
                }
              } catch (lookupError) {
                if (/route not found/i.test(lookupError.message)) {
                  showNonMemberFallback(
                    payload,
                    "The backend identify route is not available yet, so this scan is being treated as a new-member registration."
                  );
                } else {
                  throw lookupError;
                }
              }
            }
          } else {
            lastCapturePayload = null;
            setCaptureAlert({
              tone: "danger",
              title: "No finger contact detected",
              text: payload.message || "The reader did not detect finger contact.",
              readerState: payload.readerStatus || "Reader ready",
              serial: payload.readerSerial || "Reader detected",
              detail: `SDK: ${payload.paths?.sdkAssemblyPath || "Unavailable"} • Mode: ${payload.captureMode || "Unavailable"} • Delta: ${payload.contactMeanAbsDiff ?? "n/a"}`,
              captureState: payload.quality || payload.resultCode || "Capture incomplete",
              captureMetaText: captureSaveMode
                ? `Result: ${payload.resultCode || "Unknown"} • Keep the reader clear before pressing Capture Fingerprint, then touch the scanner.`
                : `Result: ${payload.resultCode || "Unknown"} • Keep the reader clear before pressing Detect Finger Contact, then touch the scanner.`
            });
            setScanState("missing", {
              label:
                payload.quality === "DP_QUALITY_TIMED_OUT"
                  ? "No finger detected"
                  : "Capture incomplete",
              visual: {
                badge:
                  payload.quality === "DP_QUALITY_TIMED_OUT"
                    ? "No Finger"
                    : "Capture Incomplete",
                result:
                  payload.quality === "DP_QUALITY_TIMED_OUT"
                    ? "No finger detected"
                    : payload.quality || payload.resultCode || "Capture incomplete",
                status: captureSaveMode ? "No template captured" : "No member lookup started",
                expiry: captureSaveMode ? "Form save blocked" : "No expiry available",
                action: "Clear the reader and retry"
              }
            });
            setRegisterMemberMessage(
              captureSaveMode
                ? "No fingerprint template was saved. Capture a fingerprint before submitting the form."
                : "No fingerprint was saved. Capture a no-match fingerprint before registering a new member.",
              "danger"
            );
          }
        } catch (error) {
          lastCapturePayload = null;
          readerReady = false;
          setCaptureAlert({
            tone: "danger",
            title: captureSaveMode ? "Fingerprint capture failed" : "Fingerprint lookup failed",
            text: captureSaveMode
              ? `${error.message} Check the local bridge and fingerprint reader setup, then try the capture again.`
              : `${error.message} Check the local bridge, the database connection, and the matcher setup, then try the scan again.`,
            readerState: captureSaveMode ? "Capture failed" : "Lookup failed",
            serial: "Reader not available",
            detail: captureSaveMode
              ? "The fingerprint capture request did not complete successfully."
              : "The fingerprint capture or backend comparison did not complete successfully.",
            captureState: captureSaveMode ? "No template saved" : "No lookup result",
            captureMetaText: captureSaveMode
              ? `Bridge URL: ${fingerprintApiBase}/api/fingerprint/capture`
              : `Bridge URL: ${fingerprintApiBase}/api/fingerprint/identify`
          });
          setScanState("error", {
            label: captureSaveMode ? "Capture failed" : "Lookup failed",
            visual: {
              badge: captureSaveMode ? "Capture Failed" : "Lookup Failed",
              result: captureSaveMode
                ? "Capture request failed"
                : "Capture or match request failed",
              status: captureSaveMode
                ? "Template unavailable"
                : "Backend comparison unavailable",
              expiry: captureSaveMode ? "Form save blocked" : "No expiry available",
              action: "Check the bridge and retry"
            }
          });
          setRegisterMemberMessage(
            captureSaveMode
              ? "Fingerprint capture failed. Fix the bridge or reader setup, then capture again before saving."
              : "Fingerprint capture or backend comparison failed. Fix the bridge or database setup, then scan again before registration.",
            "danger"
          );
        } finally {
          setFingerprintBusy(false);
        }
      });
    }
  }

  if (registerMemberForms.length) {
    applyDefaultStartDates(document);
    setRegisterMemberMessage(
      captureSaveMode
        ? "Capture a fingerprint before saving the member record."
        : "Capture a fingerprint with no match before saving the member record.",
      "muted"
    );

    registerMemberForms.forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const submitEndpoint =
          form.dataset.registerEndpoint || "/api/members/register-from-scan";
        const requiresLookupClearance = !captureSaveMode;
        const canSubmit =
          Boolean(lastCapturePayload) &&
          (!requiresLookupClearance || lastLookupState === "nonmember");

        if (!canSubmit) {
          setRegisterMemberMessage(
            captureSaveMode
              ? "Capture a fingerprint successfully before submitting the member form."
              : "The last scan must end in a no-match result before the member record can be saved.",
            "danger"
          );
          return;
        }

        if (!form.reportValidity()) {
          setRegisterMemberMessage(
            "Complete the required registration fields before saving. Phone number must use 10 to 15 digits.",
            "danger"
          );
          return;
        }

        const formData = new FormData(form);
        const fullName = formData.get("fullName");
        const mobileNumber = String(formData.get("mobileNumber") || "").replace(
          /\D+/g,
          ""
        );
        const planCode = formData.get("planCode");
        const startDate = formData.get("startDate");
        const fingerLabel =
          String(formData.get("fingerLabel") || "RIGHT_INDEX").trim() ||
          "RIGHT_INDEX";

        if (mobileNumber.length < 10 || mobileNumber.length > 15) {
          setRegisterMemberMessage(
            "Enter a valid phone number using 10 to 15 digits before saving.",
            "danger"
          );
          const phoneField = form.querySelector("input[name='mobileNumber']");
          if (phoneField) {
            phoneField.focus();
          }
          return;
        }

        const registrationPayload = {
          fullName,
          mobileNumber,
          planCode,
          startDate,
          fingerLabel,
          scanPayload: lastCapturePayload
        };

        setRegisterFormBusy(true);
        setScanState("scanning", {
          label: "Saving record",
          visual: {
            badge: "Saving Record",
            result: "Submitting member details",
            status: "Waiting for backend response",
            expiry: "Save pending",
            action: "Do not close the page"
          }
        });
        setRegisterMemberMessage(
          "Saving member profile and fingerprint template through the backend registration route...",
          "warning"
        );

        try {
          const payload = await submitRegistrationRequest(
            submitEndpoint,
            registrationPayload,
            captureSaveMode
          );

          updateLiveMemberPanels(payload.member, {
            mode: "registered",
            lookupState: "member"
          });
          setCaptureAlert({
            tone: "success",
            title: "Member record saved",
            text:
              payload.source === "postgres"
                ? `${payload.member.fullName} was saved as ${payload.member.memberId} with the ${payload.member.plan} plan in PostgreSQL.`
                : `${payload.member.fullName} was saved as ${payload.member.memberId} with the ${payload.member.plan} plan in the backend local store.`,
            readerState: "Member saved",
            serial: lastCapturePayload.readerSerial || "Reader detected",
            detail: `Plan: ${payload.member.plan} • Finger: ${formatFingerLabel(
              fingerLabel
            )} • Template: ${payload.fingerprint?.templateFormat || "Saved"}`,
            captureState: "Fingerprint enrolled",
            captureMetaText: `Registered at ${longDateTimeFormatter.format(new Date(payload.member.registeredAt))} • Source: ${payload.source === "postgres" ? "PostgreSQL" : "Local store"}`
          });
          setScanState("registered", {
            label: captureSaveMode ? "Record saved" : "Member registered",
            visual: {
              badge: payload.source === "postgres" ? "Saved to SQL" : "Saved to Local Store",
              title: payload.member.fullName,
              summary: buildRegisteredInlineSummaryText(payload.member),
              result: `${payload.member.memberId} saved`,
              status: payload.member.status,
              expiry: `Expires ${formatExpiry(payload.member.expiryDate)}`,
              action: "Open member list"
            }
          });
          setRegisterMemberMessage(
            payload.source === "postgres"
              ? `${payload.member.fullName} saved as ${payload.member.memberId} in PostgreSQL. Open Member List to verify the stored record.`
              : `${payload.member.fullName} saved as ${payload.member.memberId} in the backend local store because PostgreSQL was unavailable${payload.fallbackReason ? `: ${payload.fallbackReason}` : "."}`,
            "success"
          );
          form.reset();
          applyDefaultStartDates(form);
          lastCapturePayload = null;
        } catch (error) {
          if (captureSaveMode) {
            setCaptureAlert({
              tone: "danger",
              title: "Member save failed",
              text: `${error.message} The captured fingerprint template is still available in this page session, so you can review the form and submit again.`,
              readerState: "Save failed",
              serial: lastCapturePayload?.readerSerial || "Reader detected",
              detail: "Capture already succeeded. Fix the form or backend route issue, then retry the save.",
              captureState: "Save failed",
              captureMetaText: `Route: ${submitEndpoint} • Template remains available for retry`
            });
            setScanState("detected", {
              label: "Retry save",
              visual: {
                badge: "Template Ready",
                result: "Fingerprint still captured",
                status: "Review the error and submit again",
                expiry: "Template still in session",
                action: "Retry the save"
              }
            });
          }
          setRegisterMemberMessage(error.message, "danger");
        } finally {
          setRegisterFormBusy(false);
        }
      });
    });
  }

  const weeklyAttendanceChart = document.querySelector("[data-weekly-attendance-chart]");
  const weeklyAttendanceRange = document.querySelector("[data-weekly-attendance-range]");
  const weeklyAttendanceSubtitle = document.querySelector("[data-weekly-attendance-subtitle]");
  const weeklyAttendanceHighlight = document.querySelector("[data-weekly-attendance-highlight]");
  const weeklyAttendanceHighlightCopy = document.querySelector("[data-weekly-attendance-highlight-copy]");

  const padNumber = (value) => String(value).padStart(2, "0");
  const formatDateKey = (date) =>
    `${date.getFullYear()}-${padNumber(date.getMonth() + 1)}-${padNumber(date.getDate())}`;
  const addDays = (date, days) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  };
  const getWeekStart = (date = new Date()) => {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const normalizedDay = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - normalizedDay);
    return start;
  };
  const weekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short" });
  const weeklyAttendanceStorageKey = "gymflow.weeklyAttendance";

  const buildWeekSeed = (weekStartKey) =>
    weekStartKey.split("").reduce((seed, char) => seed + char.charCodeAt(0), 0);

  const createWeeklyAttendanceData = (weekStart) => {
    const weekStartKey = formatDateKey(weekStart);
    const seed = buildWeekSeed(weekStartKey);

    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(weekStart, index);
      const daySeed = seed + index * 19;
      const isWeekend = index >= 5;
      const approved = 82 + (daySeed % 31) + (isWeekend ? 18 : 0);
      const blocked = 7 + (daySeed % 9) + (isWeekend ? 2 : 0);

      return {
        date: formatDateKey(date),
        approved,
        blocked
      };
    });
  };

  const readWeeklyAttendanceData = () => {
    const weekStart = getWeekStart(new Date());
    const weekStartKey = formatDateKey(weekStart);

    try {
      const storedValue = window.localStorage.getItem(weeklyAttendanceStorageKey);
      if (storedValue) {
        const parsed = JSON.parse(storedValue);
        if (
          parsed &&
          parsed.weekStart === weekStartKey &&
          Array.isArray(parsed.days) &&
          parsed.days.length === 7
        ) {
          return parsed;
        }
      }
    } catch (error) {
      // Ignore storage errors and fall back to regenerated demo data.
    }

    const nextValue = {
      weekStart: weekStartKey,
      days: createWeeklyAttendanceData(weekStart)
    };

    try {
      window.localStorage.setItem(weeklyAttendanceStorageKey, JSON.stringify(nextValue));
    } catch (error) {
      // Storage is optional for this demo chart.
    }

    return nextValue;
  };

  const renderWeeklyAttendanceChart = () => {
    if (!weeklyAttendanceChart) return;

    const weeklyData = readWeeklyAttendanceData();
    const weekStart = new Date(`${weeklyData.weekStart}T00:00:00`);
    const weekEnd = addDays(weekStart, 6);
    const maxTotal = Math.max(
      ...weeklyData.days.map((entry) => entry.approved + entry.blocked),
      1
    );

    weeklyAttendanceChart.innerHTML = weeklyData.days
      .map((entry) => {
        const entryDate = new Date(`${entry.date}T00:00:00`);
        const approvedHeight = Math.max(14, Math.round((entry.approved / maxTotal) * 100));
        const blockedHeight = Math.max(8, Math.round((entry.blocked / maxTotal) * 100));
        const weekdayLabel = weekdayFormatter.format(entryDate);
        const dateLabel = shortDateFormatter.format(entryDate);

        return `
          <div class="bar-group" title="${weekdayLabel} ${dateLabel}: ${entry.approved} approved, ${entry.blocked} blocked">
            <div class="bar-stack">
              <div class="bar" style="height: ${approvedHeight}%;" aria-hidden="true"></div>
              <div class="bar alt" style="height: ${blockedHeight}%;" aria-hidden="true"></div>
            </div>
            <div class="bar-label">${weekdayLabel}<br>${dateLabel}</div>
          </div>
        `;
      })
      .join("");

    if (weeklyAttendanceRange) {
      weeklyAttendanceRange.textContent = `${shortDateFormatter.format(weekStart)} - ${shortDateFormatter.format(weekEnd)}`;
    }

    if (weeklyAttendanceSubtitle) {
      weeklyAttendanceSubtitle.textContent = `Seven-day chart for ${longDateFormatter.format(weekStart)} to ${longDateFormatter.format(weekEnd)}. The chart resets automatically when a new week starts.`;
    }

    const strongestDay = [...weeklyData.days].sort((left, right) => right.approved - left.approved)[0];
    if (strongestDay && weeklyAttendanceHighlight) {
      const strongestDate = new Date(`${strongestDay.date}T00:00:00`);
      weeklyAttendanceHighlight.textContent = `${weekdayFormatter.format(strongestDate)} leads the current week`;
      if (weeklyAttendanceHighlightCopy) {
        weeklyAttendanceHighlightCopy.textContent = `${strongestDay.approved} approved check-ins and ${strongestDay.blocked} blocked attempts were recorded on ${longDateFormatter.format(strongestDate)}.`;
      }
    }
  };

  renderWeeklyAttendanceChart();

  if (weeklyAttendanceChart) {
    window.setInterval(renderWeeklyAttendanceChart, 60 * 1000);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        renderWeeklyAttendanceChart();
      }
    });
  }

  phoneNumberInputs.forEach((input) => {
    input.addEventListener("input", () => {
      const sanitized = String(input.value || "").replace(/\D+/g, "");
      if (input.value !== sanitized) {
        input.value = sanitized;
      }

      const hasLengthError =
        sanitized.length > 0 && (sanitized.length < 10 || sanitized.length > 15);
      input.setCustomValidity(
        hasLengthError ? "Phone number must contain 10 to 15 digits." : ""
      );
    });
  });

  document.querySelectorAll("[data-filter-group]").forEach((group) => {
    const chips = group.querySelectorAll("[data-filter]");
    chips.forEach((chip) => {
      chip.addEventListener("click", () => {
        chips.forEach((item) => item.classList.remove("active"));
        chip.classList.add("active");
      });
    });
  });

  const memberSearch = document.querySelector("[data-member-search]");
  const memberSearchSubmit = document.querySelector("[data-member-search-submit]");
  const memberFilterGroup = document.querySelector("[data-member-filter-group]");
  const empty = document.querySelector("[data-empty-state]");
  const getMemberRows = () => document.querySelectorAll("[data-member-row]");
  let activeMemberFilter = "all";

  const getMemberRowFilterData = (row) => {
    const name =
      row.querySelector("td[data-label='Member'] strong")?.textContent?.trim() || "";
    const memberId =
      row.querySelector("td[data-label='Member'] .list-meta")?.textContent?.trim() || "";
    const plan = row.querySelector("td[data-label='Plan']")?.textContent?.trim() || "";
    const status =
      row.querySelector("td[data-label='Status'] .tag")?.textContent?.trim() || "";

    return {
      name: name.toLowerCase(),
      memberId: memberId.toLowerCase(),
      plan: plan.toLowerCase(),
      status: status.toLowerCase()
    };
  };

  const matchesMemberFilter = (filterValue, filterData) => {
    switch (filterValue) {
      case "active":
        return filterData.status.includes("active");
      case "expired":
        return (
          filterData.status.includes("renew") ||
          filterData.status.includes("expired")
        );
      case "monthly":
        return filterData.plan.includes("monthly");
      case "single-day":
        return (
          filterData.plan.includes("single day") ||
          filterData.status.includes("day pass")
        );
      case "all":
      default:
        return true;
    }
  };

  const applyMemberSearchFilter = () => {
    const query = memberSearch ? memberSearch.value.trim().toLowerCase() : "";
    let visible = 0;

    getMemberRows().forEach((row) => {
      const filterData = getMemberRowFilterData(row);
      const matchesQuery =
        !query ||
        filterData.name.includes(query) ||
        filterData.memberId.includes(query);
      const matchesFilter = matchesMemberFilter(activeMemberFilter, filterData);
      const match = matchesQuery && matchesFilter;
      row.style.display = match ? "" : "none";

      if (match) {
        visible += 1;
      }
    });

    if (empty) {
      empty.textContent = "No Member Data Exist";
      empty.hidden = visible !== 0;
    }
  };

  const showStaticMemberDirectoryFallback = (noteText) => {
    if (!memberDirectoryBody) return;

    setDirectoryMembers([]);
    memberDirectoryBody.innerHTML = staticMemberDirectoryMarkup;
    bindModalTriggers(memberDirectoryBody);
    bindDeleteTriggers(memberDirectoryBody);

    if (memberDirectoryNote && noteText) {
      memberDirectoryNote.textContent = noteText;
    }

    applyMemberSearchFilter();
  };

  const renderMemberDirectoryRows = (members) => {
    if (!memberDirectoryBody) return;

    setDirectoryMembers(members);
    memberDirectoryBody.innerHTML = members
      .map((member) => {
        const initials = getInitials(member.fullName);
        const expiryText = formatExpiry(member.expiryDate);
        const statusClass = getStatusTagClass(member.status);
        const primaryActionMarkup =
          String(member.action || "").toLowerCase() === "renew"
            ? `<a class="button-ghost" href="${escapeHtml(
                buildRenewalPageHref(member)
              )}">Renew</a>`
            : `
              <button
                class="button-ghost"
                type="button"
                data-modal-open
                data-member-key="${escapeHtml(member.id)}"
                data-member-code="${escapeHtml(member.memberId)}"
                data-member-name="${escapeHtml(member.fullName)}"
                data-member-plan="${escapeHtml(member.plan)}"
                data-member-status="${escapeHtml(member.status)}"
                data-member-expiry="${escapeHtml(expiryText)}"
                data-member-action="${escapeHtml(member.action || "View")}"
                data-member-last-visit="${escapeHtml(member.lastVisitAt || "")}"
                data-member-last-scan="${escapeHtml(member.lastScanAt || "")}"
                data-member-registered-at="${escapeHtml(member.registeredAt || "")}"
              >
                View
              </button>
            `;
        const actionMarkup = `
          <div class="member-row-actions">
            ${primaryActionMarkup}
            <button
              class="button-ghost button-ghost-danger"
              type="button"
              data-member-delete-open
              data-member-key="${escapeHtml(member.id)}"
              data-member-code="${escapeHtml(member.memberId)}"
              data-member-name="${escapeHtml(member.fullName)}"
            >
              Delete
            </button>
          </div>
        `;

        return `
          <tr data-member-row>
            <td data-label="Member">
              <div class="table-member">
                <div class="member-photo">${escapeHtml(initials)}</div>
                <div>
                  <strong>${escapeHtml(member.fullName)}</strong>
                  <div class="list-meta">${escapeHtml(member.memberId)}</div>
                </div>
              </div>
            </td>
            <td data-label="Plan">${escapeHtml(member.plan)}</td>
            <td data-label="Status"><span class="tag ${statusClass}">${escapeHtml(member.status)}</span></td>
            <td data-label="Last Visit">${escapeHtml(formatLastVisit(member.lastVisitAt))}</td>
            <td data-label="Expiry">${escapeHtml(expiryText)}</td>
            <td data-label="Action">${actionMarkup}</td>
          </tr>
        `;
      })
      .join("");

    bindModalTriggers(memberDirectoryBody);
    bindDeleteTriggers(memberDirectoryBody);
    applyMemberSearchFilter();
  };

  const loadMemberDirectory = async ({ noteOverride } = {}) => {
    if (!memberDirectoryBody) return;

    try {
      const payload = await readFingerprintResponse("/api/members?limit=100");
      const members = Array.isArray(payload.members) ? payload.members : [];

      if (members.length > 0) {
        renderMemberDirectoryRows(members);
      } else {
        setDirectoryMembers([]);
        memberDirectoryBody.innerHTML = "";
        applyMemberSearchFilter();
      }

      if (memberDirectoryNote) {
        memberDirectoryNote.textContent =
          noteOverride ||
          (payload.source === "file-store"
            ? `Live backend local-store directory loaded from ${fingerprintApiBase}.`
            : `Live PostgreSQL directory loaded from ${fingerprintApiBase}.`);
      }
    } catch (error) {
      showStaticMemberDirectoryFallback(
        `${error.message} Showing the static demo rows instead.`
      );
    }
  };

  const renewForm = document.querySelector("[data-renew-form]");
  const renewDataNote = document.querySelector("[data-renew-data-note]");
  const renewStatusTag = document.querySelector("[data-renew-status-tag]");
  const renewMemberInitials = document.querySelector("[data-renew-member-initials]");
  const renewMemberName = document.querySelector("[data-renew-member-name]");
  const renewMemberMeta = document.querySelector("[data-renew-member-meta]");
  const renewMemberSummary = document.querySelector("[data-renew-member-summary]");
  const renewCurrentPlan = document.querySelector("[data-renew-current-plan]");
  const renewCurrentPlanCopy = document.querySelector("[data-renew-current-plan-copy]");
  const renewLastScan = document.querySelector("[data-renew-last-scan]");
  const renewLastScanCopy = document.querySelector("[data-renew-last-scan-copy]");
  const renewExpiry = document.querySelector("[data-renew-expiry]");
  const renewExpiryCopy = document.querySelector("[data-renew-expiry-copy]");
  const renewVisits = document.querySelector("[data-renew-visits]");
  const renewVisitsCopy = document.querySelector("[data-renew-visits-copy]");
  const renewPlanGroup = document.querySelector("[data-renew-plan-group]");
  const renewPlanHelp = document.querySelector("[data-renew-plan-help]");
  const renewSelectedPlanName = document.querySelector("[data-renew-selected-plan-name]");
  const renewSelectedPlanCopy = document.querySelector("[data-renew-selected-plan-copy]");
  const renewSelectedPlanPrice = document.querySelector("[data-renew-selected-plan-price]");
  const renewSelectedPlanExpiry = document.querySelector("[data-renew-selected-plan-expiry]");
  const renewSubmitButton = document.querySelector("[data-renew-submit]");
  const renewMessage = document.querySelector("[data-renew-message]");
  const renewState = {
    member: null,
    currentPlan: null,
    metrics: null,
    plans: [],
    selectedPlanCode: "",
    source: null
  };

  const setRenewMessage = (text, tone = "muted") => {
    if (!renewMessage) return;

    renewMessage.textContent = text;
    renewMessage.dataset.messageTone = tone;
    renewMessage.classList.remove("helper-success", "helper-danger", "helper-warning");

    if (tone === "success") {
      renewMessage.classList.add("helper-success");
    } else if (tone === "danger") {
      renewMessage.classList.add("helper-danger");
    } else if (tone === "warning") {
      renewMessage.classList.add("helper-warning");
    }
  };

  const setRenewFormBusy = (busy) => {
    if (!renewForm) return;

    renewForm.querySelectorAll("button, input, select, textarea").forEach((control) => {
      control.disabled = busy;
    });
  };

  const getRenewQueryState = () => {
    const params = new URLSearchParams(window.location.search);
    return {
      memberId: String(params.get("memberId") || "").trim(),
      planCode: String(params.get("planCode") || "").trim().toUpperCase()
    };
  };

  const syncRenewQueryState = () => {
    if (!renewState.member?.id) {
      return;
    }

    const params = new URLSearchParams();
    params.set("memberId", renewState.member.id);

    if (renewState.selectedPlanCode) {
      params.set("planCode", renewState.selectedPlanCode);
    }

    window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
  };

  const buildProjectedRenewalExpiry = (plan) => {
    if (!plan) {
      return null;
    }

    const now = new Date();
    const expiryDate = new Date(now);

    if (String(plan.planCode || "").toUpperCase() === "DAY_PASS") {
      expiryDate.setMinutes(expiryDate.getMinutes() + 1);
      return expiryDate;
    }

    if (String(plan.planCode || "").toUpperCase() === "MONTHLY") {
      expiryDate.setMinutes(expiryDate.getMinutes() + 2);
      return expiryDate;
    }

    expiryDate.setDate(expiryDate.getDate() + Number(plan.durationDays || 0));
    return expiryDate;
  };

  const getRenewPlanByCode = (planCode) =>
    renewState.plans.find(
      (plan) => String(plan.planCode || "").toUpperCase() === String(planCode || "").toUpperCase()
    );

  const updateRenewSelectedPlanSummary = () => {
    const selectedPlan = getRenewPlanByCode(renewState.selectedPlanCode);
    const projectedExpiry = buildProjectedRenewalExpiry(selectedPlan);
    const currentPlanName =
      renewState.currentPlan?.planName || renewState.member?.plan || "the current plan";

    if (renewSelectedPlanName) {
      renewSelectedPlanName.textContent = selectedPlan?.planName || "Select a plan";
    }

    if (renewSelectedPlanCopy) {
      renewSelectedPlanCopy.textContent = selectedPlan
        ? selectedPlan.planCode === renewState.currentPlan?.planCode
          ? `${selectedPlan.description || "Selected plan."} The member will start a new ${selectedPlan.planName.toLowerCase()} cycle immediately.`
          : `${selectedPlan.description || "Selected plan."} This will switch the member from ${currentPlanName} to ${selectedPlan.planName}.`
        : "The next membership cycle preview will update when a plan is selected.";
    }

    if (renewSelectedPlanPrice) {
      renewSelectedPlanPrice.textContent = formatCurrency(selectedPlan?.price || 0);
    }

    if (renewSelectedPlanExpiry) {
      renewSelectedPlanExpiry.textContent = projectedExpiry
        ? formatExpiry(projectedExpiry.toISOString())
        : "No preview";
    }

    if (renewSubmitButton) {
      renewSubmitButton.disabled = !renewState.member?.id || !selectedPlan;
    }
  };

  const setActiveRenewPlanCard = (planCode) => {
    if (!renewPlanGroup) return;

    renewPlanGroup.querySelectorAll("[data-plan-card]").forEach((card) => {
      card.classList.toggle(
        "active",
        String(card.dataset.planCode || "").toUpperCase() === String(planCode || "").toUpperCase()
      );
    });
  };

  const selectRenewPlan = (planCode) => {
    const selectedPlan = getRenewPlanByCode(planCode);
    renewState.selectedPlanCode = selectedPlan?.planCode || "";
    setActiveRenewPlanCard(renewState.selectedPlanCode);
    updateRenewSelectedPlanSummary();
    syncRenewQueryState();
  };

  const renderRenewPlanCards = () => {
    if (!renewPlanGroup) return;

    renewPlanGroup.innerHTML = renewState.plans
      .map((plan) => {
        const isSelected = plan.planCode === renewState.selectedPlanCode;
        const isCurrentPlan = plan.planCode === renewState.currentPlan?.planCode;
        return `
          <button
            class="pricing-card${isSelected ? " active" : ""}"
            type="button"
            data-plan-card
            data-plan-code="${escapeHtml(plan.planCode)}"
          >
            <span class="tag ${isCurrentPlan ? "tag-primary" : "tag-success"}">
              ${escapeHtml(isCurrentPlan ? "Current Plan" : "Available")}
            </span>
            <h4>${escapeHtml(plan.planName)}</h4>
            <p>${escapeHtml(plan.description || "Renew this membership plan.")}</p>
            <div class="renewal-plan-meta">${escapeHtml(
              plan.durationDays === 1
                ? "Valid for 1 day"
                : `${plan.durationDays} day membership cycle`
            )}</div>
            <strong>${escapeHtml(formatCurrency(plan.price))}</strong>
          </button>
        `;
      })
      .join("");

    if (renewPlanHelp) {
      renewPlanHelp.textContent =
        renewState.plans.length > 0
          ? "The current plan is preselected. Choose another card to switch the renewal plan."
          : "No membership plans are available from the active backend source.";
    }
  };

  const renderRenewMemberContext = () => {
    if (!renewState.member) {
      return;
    }

    const member = renewState.member;
    const currentPlan = renewState.currentPlan;
    const metrics = renewState.metrics || {};
    const statusClass = getStatusTagClass(member.status);

    if (renewDataNote) {
      renewDataNote.textContent =
        renewState.source === "file-store"
          ? `Renewal data loaded from the backend local store at ${fingerprintApiBase}.`
          : `Renewal data loaded from PostgreSQL at ${fingerprintApiBase}.`;
    }

    if (renewStatusTag) {
      renewStatusTag.className = `tag ${statusClass}`;
      renewStatusTag.textContent = member.status || "Unknown";
    }

    if (renewMemberInitials) {
      renewMemberInitials.textContent = getInitials(member.fullName);
    }

    if (renewMemberName) {
      renewMemberName.textContent = member.fullName || "Selected member";
    }

    if (renewMemberMeta) {
      renewMemberMeta.textContent = `${member.memberId || "No member id"} • ${member.mobileNumber || "No mobile number"}`;
    }

    if (renewMemberSummary) {
      renewMemberSummary.textContent = currentPlan
        ? `${member.fullName} is currently enrolled in ${currentPlan.planName}. Review the latest activity and choose the next renewal plan below.`
        : `${member.fullName} has no active subscription record loaded. Select a plan below to create the next renewal cycle.`;
    }

    if (renewCurrentPlan) {
      renewCurrentPlan.textContent = currentPlan?.planName || member.plan || "No active plan";
    }

    if (renewCurrentPlanCopy) {
      renewCurrentPlanCopy.textContent = currentPlan
        ? `Started ${formatExpiry(currentPlan.startedAt)} • Last payment ${formatCurrency(
            currentPlan.amountPaid
          )}`
        : "No current subscription was found for this member.";
    }

    if (renewLastScan) {
      renewLastScan.textContent = formatDetailedTimestamp(
        metrics.lastFingerprintDetectedAt,
        "No scan yet"
      );
    }

    if (renewLastScanCopy) {
      renewLastScanCopy.textContent = `Last granted visit: ${formatDetailedTimestamp(
        member.lastVisitAt,
        "No granted visit yet"
      )}.`;
    }

    if (renewExpiry) {
      renewExpiry.textContent = formatExpiry(metrics.expiryDate);
    }

    if (renewExpiryCopy) {
      renewExpiryCopy.textContent = currentPlan
        ? `Current cycle ends on ${formatExpiry(currentPlan.expiresAt)}.`
        : "No current expiry is available.";
    }

    if (renewVisits) {
      renewVisits.textContent = String(metrics.totalVisitsInPlanMonth || 0);
    }

    if (renewVisitsCopy) {
      renewVisitsCopy.textContent =
        metrics.visitWindowStartedAt && metrics.visitWindowEndsAt
          ? `Visits counted from ${formatExpiry(metrics.visitWindowStartedAt)} to ${formatExpiry(
              metrics.visitWindowEndsAt
            )}.`
          : "Visit counting starts once an active plan cycle is available.";
    }
  };

  const loadRenewalPage = async () => {
    if (!renewForm) return;

    const { memberId, planCode } = getRenewQueryState();

    if (!memberId) {
      setRenewMessage(
        "Open this page from Member List so the selected member can be loaded for renewal.",
        "warning"
      );
      updateRenewSelectedPlanSummary();
      return;
    }

    setRenewFormBusy(true);
    setRenewMessage("Loading live renewal data...", "warning");

    try {
      const payload = await readFingerprintResponse(
        `/api/members/${encodeURIComponent(memberId)}/renewal-context`
      );

      renewState.member = payload.member || null;
      renewState.currentPlan = payload.currentPlan || null;
      renewState.metrics = payload.metrics || null;
      renewState.plans = Array.isArray(payload.plans) ? payload.plans : [];
      renewState.source = payload.source || "postgres";
      renderRenewMemberContext();
      renderRenewPlanCards();

      const initialPlanCode =
        getRenewPlanByCode(planCode)?.planCode ||
        renewState.currentPlan?.planCode ||
        renewState.member?.planCode ||
        renewState.plans[0]?.planCode ||
        "";
      selectRenewPlan(initialPlanCode);
      setRenewMessage(
        `Live renewal data loaded for ${renewState.member?.fullName || "the selected member"}.`,
        "success"
      );
    } catch (error) {
      setRenewMessage(normalizeRenewRouteError(error), "danger");
    } finally {
      setRenewFormBusy(false);
      updateRenewSelectedPlanSummary();
    }
  };

  if (memberSearch) {
    memberSearch.addEventListener("input", applyMemberSearchFilter);
    memberSearch.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        applyMemberSearchFilter();
      }
    });
  }

  if (memberSearchSubmit) {
    memberSearchSubmit.addEventListener("click", applyMemberSearchFilter);
  }

  if (memberFilterGroup) {
    memberFilterGroup.querySelectorAll("[data-filter]").forEach((chip) => {
      chip.addEventListener("click", () => {
        activeMemberFilter = String(chip.dataset.filterValue || "all")
          .trim()
          .toLowerCase();
        applyMemberSearchFilter();
      });
    });
  }

  loadMemberDirectory();
  loadRenewalPage();

  if (memberDirectoryBody) {
    window.setInterval(() => {
      loadMemberDirectory();
    }, 30 * 1000);

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        loadMemberDirectory();
      }
    });
  }

  document.addEventListener("click", (event) => {
    const card = event.target.closest("[data-plan-card]");
    if (!card) return;

    const scope = card.closest("[data-plan-group]");
    if (!scope) return;

    scope.querySelectorAll("[data-plan-card]").forEach((item) => item.classList.remove("active"));
    card.classList.add("active");

    if (scope === renewPlanGroup) {
      selectRenewPlan(card.dataset.planCode || "");
    }
  });

  if (renewForm) {
    renewForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      if (!renewState.member?.id) {
        setRenewMessage("Select a member from Member List before saving a renewal.", "warning");
        return;
      }

      if (!renewState.selectedPlanCode) {
        setRenewMessage("Select a renewal plan before saving.", "warning");
        return;
      }

      setRenewFormBusy(true);
      setRenewMessage("Saving renewal...", "warning");

      try {
        const payload = await readFingerprintResponse(
          `/api/members/${encodeURIComponent(renewState.member.id)}/renew`,
          {
            method: "POST",
            body: JSON.stringify({
              planCode: renewState.selectedPlanCode
            })
          }
        );

        renewState.member = payload.member || renewState.member;
        renewState.currentPlan = payload.currentPlan || renewState.currentPlan;
        renewState.metrics = payload.metrics || renewState.metrics;
        renewState.source = payload.source || renewState.source;
        renderRenewMemberContext();
        renderRenewPlanCards();
        selectRenewPlan(renewState.currentPlan?.planCode || renewState.selectedPlanCode);
        setRenewMessage(
          `${renewState.member.fullName} was renewed to ${
            renewState.currentPlan?.planName || "the selected plan"
          }. New expiry: ${formatExpiry(renewState.member.expiryDate)}.`,
          "success"
        );
      } catch (error) {
        setRenewMessage(normalizeRenewRouteError(error), "danger");
      } finally {
        setRenewFormBusy(false);
      }
    });
  }

  window.addEventListener("resize", () => {
    if (window.innerWidth > 980 && sidebar) {
      sidebar.classList.remove("open");
    }
  });
});
