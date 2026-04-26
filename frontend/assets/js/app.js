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

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

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
        ? '<a class="button" href="renew-membership.html">Renew Membership</a>'
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
            <small class="sidebar-label">Access Window</small>
            <h4>Gym closes at 9:00 PM</h4>
            <p>Front desk should advise all members about the closing time.</p>
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
      return `Blocked until renewal. Last expiry: ${expiryText}`;
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
      return `Fingerprint matched ${member.fullName}, but the membership expired on ${expiryText}. Renewal is required before access.`;
    }

    return `Fingerprint matched ${member.fullName}. Membership is active until ${expiryText} and access is allowed.`;
  };

  const buildMemberStatusSummaryText = (member, lookupState = "member") => {
    const expiryText = formatExpiry(member.expiryDate);

    if (isLookupStateExpired(lookupState)) {
      return `Match found. ${member.fullName} is blocked until renewal. Last expiry date: ${expiryText}.`;
    }

    return `Match found. ${member.status} membership is active until ${expiryText}.`;
  };

  const buildRegisteredMemberSummaryText = (member) =>
    `${member.status} membership saved under ${member.memberId}. Expiry date: ${formatExpiry(
      member.expiryDate
    )}.`;

  const buildRegisteredInlineSummaryText = (member) =>
    `${member.fullName} was saved as ${member.memberId}. Membership expires on ${formatExpiry(
      member.expiryDate
    )}.`;

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
  };

  const scanVisualConfigs = {
    ready: {
      badge: "Standby",
      kicker: "Gym Member Detection",
      title: "Ready to verify gym member",
      summary: "Check the reader, capture a fingerprint, and confirm whether this person has a registered gym membership.",
      result: "Waiting for fingerprint",
      status: "No member decision yet",
      expiry: "Pending verification",
      action: "Check reader and start capture"
    },
    checking: {
      badge: "Checking Reader",
      kicker: "Fingerprint Hardware",
      title: "Verifying scanner connection",
      summary: "The front desk is confirming that the fingerprint reader bridge is online before a member check starts.",
      result: "Reader status request sent",
      status: "Bridge check in progress",
      expiry: "No member lookup yet",
      action: "Wait for reader readiness"
    },
    listening: {
      badge: "Detecting Finger",
      kicker: "Fingerprint Capture",
      title: "Listening for finger contact",
      summary: "The reader is active and waiting for a finger so the system can continue to the member lookup result.",
      result: "Capture window open",
      status: "Reader is listening",
      expiry: "Member match pending",
      action: "Ask the person to touch the reader"
    },
    detected: {
      badge: "Fingerprint Captured",
      kicker: "Fingerprint Capture",
      title: "Fingerprint captured successfully",
      summary: "A usable fingerprint was detected. The scanner is preparing the inline member result panel now.",
      result: "Capture complete",
      status: "Preparing member lookup",
      expiry: "Match result pending",
      action: "Wait for the inline result"
    },
    scanning: {
      badge: "Matching Record",
      kicker: "Gym Member Detection",
      title: "Checking the member database",
      summary: "The fingerprint is being routed into the inline member result card while the full database match service is being connected.",
      result: "Fingerprint under review",
      status: "Lookup in progress",
      expiry: "Profile validation pending",
      action: "Wait for the match result"
    },
    member: {
      badge: "Member Found",
      kicker: "Gym Member Detection",
      title: "Registered gym member detected",
      summary: "This fingerprint matches an active gym member record, so the front desk can continue the access flow.",
      result: "Profile match confirmed",
      status: "Access allowed",
      expiry: "Expires May 19, 2026",
      action: "Open member list"
    },
    registered: {
      badge: "Member Registered",
      kicker: "New Member Enrollment",
      title: "New gym member saved",
      summary: "The member profile and captured fingerprint were saved successfully. The next scan can start from the default reader state.",
      result: "Member profile saved",
      status: "Enrollment complete",
      expiry: "Expiry date available",
      action: "Open member list"
    },
    nonmember: {
      badge: "Not Found",
      kicker: "Gym Member Detection",
      title: "No gym member record found",
      summary: "This fingerprint does not match any registered gym-member profile in the current lookup result.",
      result: "No profile match",
      status: "Not registered",
      expiry: "No expiry on file",
      action: "Start new member intake"
    },
    expired: {
      badge: "Renewal Needed",
      kicker: "Gym Member Detection",
      title: "Matched member requires renewal",
      summary: "The fingerprint matches a stored member, but the membership is already expired and access stays blocked.",
      result: "Profile match confirmed",
      status: "Access blocked",
      expiry: "Expired April 20, 2026",
      action: "Open renewal page"
    },
    missing: {
      badge: "No Finger",
      kicker: "Fingerprint Capture",
      title: "No finger was detected",
      summary: "The reader did not detect a usable fingerprint within the scan window, so the member lookup did not start.",
      result: "Capture timed out",
      status: "No contact detected",
      expiry: "No expiry available",
      action: "Clear the reader and retry"
    },
    error: {
      badge: "Scan Failed",
      kicker: "Fingerprint Capture",
      title: "Fingerprint scan could not complete",
      summary: "The scanner bridge or capture request did not return a valid result, so the member lookup is unavailable.",
      result: "Bridge or capture error",
      status: "Reader unavailable",
      expiry: "No expiry available",
      action: "Check the bridge and retry"
    }
  };

  const scanLabelConfigs = {
    ready: { text: "Ready to scan", tone: "primary" },
    checking: { text: "Checking reader", tone: "warning" },
    listening: { text: "Detecting finger", tone: "warning" },
    detected: { text: "Fingerprint captured", tone: "warning" },
    scanning: { text: "Matching member", tone: "warning" },
    member: { text: "Member detected", tone: "success" },
    registered: { text: "Member registered", tone: "success" },
    nonmember: { text: "Register new member", tone: "danger" },
    expired: { text: "Renew membership", tone: "warning" },
    missing: { text: "No finger detected", tone: "danger" },
    error: { text: "Capture failed", tone: "danger" }
  };

  const scanPanelFallbacks = {
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
          badge: "Member Found",
          result: "Match found",
          status: "Access allowed",
          expiry: `Expires ${formatExpiry(member.expiryDate)}`,
          action: "Open member list"
        }
      };
    }

    if (lookupState === "expired" && member) {
      return {
        alert: {
          tone: "warning",
          title: "Match found but renewal is required",
          text: buildMemberSummaryText(member, "expired"),
          readerState: capturePayload.readerStatus || "Match found",
          serial: capturePayload.readerSerial || "Reader detected",
          detail: sharedDetail,
          captureState: "Renewal required",
          captureMetaText: `Captured at ${capturedAt}${scoreSummary}`
        },
        visual: {
          badge: "Renewal Needed",
          result: "Match found",
          status: "Access blocked",
          expiry: `Expired ${formatExpiry(member.expiryDate)}`,
          action: "Open renewal page"
        }
      };
    }

    return {
      alert: {
        tone: "danger",
        title: "No match found",
        text: "Fingerprint was captured, but no registered gym member record matched. Continue with new member intake.",
        readerState: capturePayload.readerStatus || "No match found",
        serial: capturePayload.readerSerial || "Reader detected",
        detail: sharedDetail,
        captureState: "No member match",
        captureMetaText: scoreSummary
          ? `Captured at ${capturedAt}${scoreSummary} • Registration intake required`
          : `Captured at ${capturedAt} • Registration intake required`
      },
      visual: {
        badge: "Not Found",
        result: "No match found",
        status: "Not registered",
        expiry: "No expiry on file",
        action: "Start new member intake"
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
      title: "Register new member",
      text: reasonMessage
    });
    setScanState("nonmember", {
      visual: outcome.visual
    });
    setRegisterMemberMessage(
      "No member matched. Fill out the form below to save the new member and the captured fingerprint.",
      "warning"
    );
  };

  if (scanShells.length || scanners.length || scanOutputs.length || inlineScanOutputs.length) {
    setScanState("ready");
  }

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

  const hasOwn = (object, key) =>
    Object.prototype.hasOwnProperty.call(object, key);

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
    if (readerCheckButton) {
      readerCheckButton.disabled = busy;
    }

    if (captureButton) {
      captureButton.disabled = busy;
    }
  };

  if (readerCheckButton || captureButton) {
    if (readerCheckButton) {
      readerCheckButton.addEventListener("click", async () => {
        setFingerprintBusy(true);
        setScanState("checking");
        setCaptureAlert({
          tone: "warning",
          title: "Checking DigitalPersona reader",
          text: "Opening the local bridge and verifying the connected fingerprint reader.",
          readerState: "Checking bridge"
        });

        try {
          const payload = await readFingerprintResponse("/api/fingerprint/status");

          setCaptureAlert({
            tone: "success",
            title: "Reader detected",
            text: `DigitalPersona reader ${payload.readerSerial} is connected and ready for contact detection.`,
            readerState: payload.readerStatus || "Reader ready",
            serial: payload.readerSerial || "Reader detected",
            detail: `SDK: ${payload.paths?.sdkAssemblyPath || "Unavailable"} • Driver: ${payload.paths?.deviceDriverPath || "Unavailable"}`,
            captureState: "Ready for finger contact detection",
            captureMetaText: `Keep the scanner clear, click Detect Finger Contact, then touch the reader within ${contactDetectionTimeoutMs / 1000} seconds.`
          });
          setScanState("ready", {
            label: "Reader ready",
            visual: {
              badge: "Reader Ready",
              result: "Reader connected",
              status: payload.readerStatus || "Waiting for fingerprint",
              expiry: "Member verification pending",
              action: "Detect finger contact"
            }
          });
        } catch (error) {
          setCaptureAlert({
            tone: "danger",
            title: "Reader bridge unavailable",
            text: `${error.message} Try again after the local API is running.`,
            readerState: "Bridge offline",
            serial: "Reader not available",
            detail: "Reader status check did not complete.",
            captureState: "Cannot capture",
            captureMetaText: `Expected bridge URL: ${fingerprintApiBase}/api/fingerprint/status`
          });
          setScanState("error", {
            label: "Bridge offline",
            visual: {
              badge: "Bridge Offline",
              result: "Reader bridge unavailable",
              status: "Scanner unavailable",
              expiry: "No expiry available",
              action: "Start the bridge and retry"
            }
          });
        } finally {
          setFingerprintBusy(false);
        }
      });
    }

    if (captureButton) {
      captureButton.addEventListener("click", async () => {
        setFingerprintBusy(true);
        setScanState("listening");
        setCaptureAlert({
          tone: "warning",
          title: "Waiting for finger contact",
          text: `Keep the reader clear, then place a finger on the DigitalPersona 4500 reader and hold it steady until the capture finishes. Contact detection will wait up to ${contactDetectionTimeoutMs / 1000} seconds.`,
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
                  "No member matched. Fill out the form below to save the new member and the captured fingerprint.",
                  "warning"
                );
              } else {
                setRegisterMemberMessage(
                  "Capture a fingerprint with no match before saving a new member.",
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
              captureMetaText: `Result: ${payload.resultCode || "Unknown"} • Keep the reader clear before pressing Detect Finger Contact, then touch the scanner.`
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
                status: "No member lookup started",
                expiry: "No expiry available",
                action: "Clear the reader and retry"
              }
            });
            setRegisterMemberMessage(
              "No fingerprint was saved. Capture a no-match fingerprint before registering a new member.",
              "danger"
            );
          }
        } catch (error) {
          lastCapturePayload = null;
          setCaptureAlert({
            tone: "danger",
            title: "Fingerprint lookup failed",
            text: `${error.message} Check the local bridge, the database connection, and the matcher setup, then try the scan again.`,
            readerState: "Lookup failed",
            serial: "Reader not available",
            detail: "The fingerprint capture or backend comparison did not complete successfully.",
            captureState: "No lookup result",
            captureMetaText: `Bridge URL: ${fingerprintApiBase}/api/fingerprint/identify`
          });
          setScanState("error", {
            label: "Lookup failed",
            visual: {
              badge: "Lookup Failed",
              result: "Capture or match request failed",
              status: "Backend comparison unavailable",
              expiry: "No expiry available",
              action: "Check the bridge and retry"
            }
          });
          setRegisterMemberMessage(
            "Fingerprint capture or backend comparison failed. Fix the bridge or database setup, then scan again before registration.",
            "danger"
          );
        } finally {
          setFingerprintBusy(false);
        }
      });
    }
  }

  if (registerMemberForms.length) {
    setRegisterMemberMessage(
      "Capture a fingerprint with no match before saving a new member.",
      "muted"
    );

    registerMemberForms.forEach((form) => {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (!lastCapturePayload || lastLookupState !== "nonmember") {
          setRegisterMemberMessage(
            "The last scan must end in a no-match result before a new member can be registered.",
            "danger"
          );
          return;
        }

        const formData = new FormData(form);
        const fullName = formData.get("fullName");
        const mobileNumber = formData.get("mobileNumber");
        const planCode = formData.get("planCode");

        setRegisterFormBusy(true);
        setRegisterMemberMessage(
          "Saving member profile, fingerprint record, and attendance log to PostgreSQL...",
          "warning"
        );

        try {
          const payload = await readFingerprintResponse("/api/members/register-from-scan", {
            method: "POST",
            body: JSON.stringify({
              fullName,
              mobileNumber,
              planCode,
              fingerLabel: "RIGHT_INDEX",
              scanPayload: lastCapturePayload
            })
          });

          updateLiveMemberPanels(payload.member, {
            mode: "registered",
            lookupState: "member"
          });
          setCaptureAlert({
            tone: "success",
            title: "New member registered",
            text: `${payload.member.fullName} was saved as ${payload.member.memberId} with the ${payload.member.plan} plan.`,
            readerState: "Member saved",
            serial: lastCapturePayload.readerSerial || "Reader detected",
            detail: `Plan: ${payload.member.plan} • Finger: RIGHT_INDEX • Template: ${payload.fingerprint?.templateFormat || "Saved"}`,
            captureState: "Fingerprint enrolled",
            captureMetaText: `Registered at ${longDateTimeFormatter.format(new Date(payload.member.registeredAt))}`
          });
          setScanState("registered", {
            label: "Member registered",
            visual: {
              badge: "Member Registered",
              result: `${payload.member.memberId} saved`,
              status: payload.member.status,
              expiry: `Expires ${formatExpiry(payload.member.expiryDate)}`,
              action: "Open member list"
            }
          });
          setRegisterMemberMessage(
            `${payload.member.fullName} saved as ${payload.member.memberId}. Open Member List to verify the stored record.`,
            "success"
          );
          form.reset();
          lastCapturePayload = null;
        } catch (error) {
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
  const empty = document.querySelector("[data-empty-state]");
  const getMemberRows = () => document.querySelectorAll("[data-member-row]");
  const applyMemberSearchFilter = () => {
    const query = memberSearch ? memberSearch.value.trim().toLowerCase() : "";
    let visible = 0;

    getMemberRows().forEach((row) => {
      const haystack = row.textContent.toLowerCase();
      const match = !query || haystack.includes(query);
      row.style.display = match ? "" : "none";
      if (match) visible += 1;
    });

    if (empty) {
      empty.hidden = visible !== 0;
    }
  };

  const getInitials = (fullName) =>
    String(fullName || "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "GM";

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
            ? '<a class="button-ghost" href="renew-membership.html">Renew</a>'
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

  if (memberSearch) {
    memberSearch.addEventListener("input", applyMemberSearchFilter);
  }

  loadMemberDirectory();

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

  document.querySelectorAll("[data-plan-card]").forEach((card) => {
    card.addEventListener("click", () => {
      const scope = card.closest("[data-plan-group]");
      if (!scope) return;
      scope.querySelectorAll("[data-plan-card]").forEach((item) => item.classList.remove("active"));
      card.classList.add("active");
    });
  });

  document.querySelectorAll("form[data-demo-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const target = form.querySelector("[data-form-message]");
      if (target) {
        target.textContent = "Demo only: form submission is disabled in this offline UI.";
      }
    });
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 980 && sidebar) {
      sidebar.classList.remove("open");
    }
  });
});
