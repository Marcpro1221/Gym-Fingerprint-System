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

  if (modal) {
    const closeModal = () => modal.classList.remove("open");

    const renderModal = ({ title, body, footer }) => {
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

    document.querySelectorAll("[data-modal-open]").forEach((button) => {
      button.addEventListener("click", () => {
        const name = button.dataset.memberName || "Member Snapshot";
        const plan = button.dataset.memberPlan || "Hidden for privacy";
        const status = button.dataset.memberStatus || "Active";
        const expires = button.dataset.memberExpiry || "May 20, 2026";
        renderModal({
          title: name,
          body: `
            <div class="grid grid-two">
              <div class="status-card">
                <small class="sidebar-label">Membership Record</small>
                <h4>${plan}</h4>
                <p>Member record details shown here are limited for UI presentation only.</p>
              </div>
              <div class="status-card">
                <small class="sidebar-label">Current Status</small>
                <h4>${status}</h4>
                <p>Expiry date: ${expires}</p>
              </div>
              <div class="status-card">
                <small class="sidebar-label">Recent Activity</small>
                <h4>8 visits this month</h4>
                <p>Last recorded visits are kept as sample dashboard content only.</p>
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
            <a class="button" href="member-list.html">Open Member List</a>
          `
        });
      });
    });

    modal.addEventListener("click", (event) => {
      if (event.target.matches("[data-modal-close]") || event.target === modal) {
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
  const scanLabelToneClasses = [
    "tag-primary",
    "tag-success",
    "tag-warning",
    "tag-danger"
  ];
  const previewLookupStates = ["member", "nonmember", "expired"];
  let previewLookupIndex = 0;

  const setNodeText = (nodes, text) => {
    nodes.forEach((node) => {
      node.textContent = text;
    });
  };

  const wait = (ms) =>
    new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });

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
    nonmember: { text: "Register new member", tone: "danger" },
    expired: { text: "Renew membership", tone: "warning" },
    missing: { text: "No finger detected", tone: "danger" },
    error: { text: "Capture failed", tone: "danger" }
  };

  const scanPanelFallbacks = {
    checking: "ready",
    listening: "scanning",
    detected: "scanning",
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
    setInlineScanState(state);
    setSidebarScanState(state);
    setLiveScanLabel(state, overrides.label);
    setScanVisualState(state, overrides.visual);
  };

  const nextPreviewLookupState = () => {
    const state = previewLookupStates[previewLookupIndex % previewLookupStates.length];
    previewLookupIndex += 1;
    return state;
  };

  const buildLookupOutcome = (state, payload) => {
    const capturedAt = payload.timestamp
      ? new Date(payload.timestamp).toLocaleString()
      : "Unknown time";

    const sharedDetail = `Reader: ${payload.readerSerial || "Detected"} • Mode: ${payload.captureMode || "Unavailable"} • Delta: ${payload.contactMeanAbsDiff ?? "n/a"}`;

    if (state === "member") {
      return {
        alert: {
          tone: "success",
          title: "Member matched",
          text: "Fingerprint matched Nicole Tan. Membership is active and gym access is allowed.",
          readerState: payload.readerStatus || "Member detected",
          serial: payload.readerSerial || "Reader detected",
          detail: sharedDetail,
          captureState: "Matched member",
          captureMetaText: `Captured at ${capturedAt} • Expiry date May 19, 2026`
        },
        visual: {
          badge: "Member Found",
          result: "Profile match confirmed",
          status: "Access allowed",
          expiry: "Expires May 19, 2026",
          action: "Open member list"
        }
      };
    }

    if (state === "expired") {
      return {
        alert: {
          tone: "warning",
          title: "Renew membership required",
          text: "Fingerprint matched Joaquin Ramos, but the membership expired on April 20, 2026.",
          readerState: payload.readerStatus || "Renewal needed",
          serial: payload.readerSerial || "Reader detected",
          detail: sharedDetail,
          captureState: "Matched member",
          captureMetaText: `Captured at ${capturedAt} • Renewal required before access`
        },
        visual: {
          badge: "Renewal Needed",
          result: "Profile match confirmed",
          status: "Access blocked",
          expiry: "Expired April 20, 2026",
          action: "Open renewal page"
        }
      };
    }

    return {
      alert: {
        tone: "danger",
        title: "Register new member",
        text: "Fingerprint was captured, but no registered gym member record matched. Continue with new member intake.",
        readerState: payload.readerStatus || "No match found",
        serial: payload.readerSerial || "Reader detected",
        detail: sharedDetail,
        captureState: "No member match",
        captureMetaText: `Captured at ${capturedAt} • Registration intake required`
      },
      visual: {
        badge: "Not Found",
        result: "No profile match",
        status: "Not registered",
        expiry: "No expiry on file",
        action: "Start new member intake"
      }
    };
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
        `Cannot reach the local fingerprint bridge at ${fingerprintApiBase}. Start it with npm run fingerprint:bridge.`
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
            captureMetaText: "Keep the scanner clear, click Detect Finger Contact, then touch the reader within 5 seconds."
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
            text: `${error.message} Start the bridge with npm run fingerprint:bridge, then try again.`,
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
          text: "Keep the reader clear, then place a finger on the DigitalPersona 4500 reader. Contact detection will wait up to 5 seconds.",
          readerState: "Detection in progress",
          captureState: "Listening for contact"
        });

        try {
          const payload = await readFingerprintResponse("/api/fingerprint/capture", {
            method: "POST",
            body: JSON.stringify({
              timeout: 5000
            })
          });

          if (payload.captured) {
            setCaptureAlert({
              tone: "warning",
              title: payload.contactDetected ? "Fingerprint captured" : "Capture completed",
              text: payload.contactDetected
                ? "Finger contact was detected. Matching the captured fingerprint to the inline member result now."
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

            await wait(900);

            const resultState = nextPreviewLookupState();
            const outcome = buildLookupOutcome(resultState, payload);
            setCaptureAlert(outcome.alert);
            setScanState(resultState, {
              visual: outcome.visual
            });
          } else {
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
          }
        } catch (error) {
          setCaptureAlert({
            tone: "danger",
            title: "Capture request failed",
            text: `${error.message} Check the reader bridge, then try the capture again.`,
            readerState: "Capture failed",
            serial: "Reader not available",
            detail: "Fingerprint capture request did not reach the DigitalPersona bridge.",
            captureState: "No fingerprint captured",
            captureMetaText: `Bridge URL: ${fingerprintApiBase}/api/fingerprint/capture`
          });
          setScanState("error", {
            label: "Capture failed",
            visual: {
              badge: "Capture Failed",
              result: "Capture request failed",
              status: "Reader unavailable",
              expiry: "No expiry available",
              action: "Check the bridge and retry"
            }
          });
        } finally {
          setFingerprintBusy(false);
        }
      });
    }
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
  const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  });
  const longDateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric"
  });
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
  const rows = document.querySelectorAll("[data-member-row]");

  if (memberSearch && rows.length) {
    memberSearch.addEventListener("input", () => {
      const query = memberSearch.value.trim().toLowerCase();
      let visible = 0;

      rows.forEach((row) => {
        const haystack = row.textContent.toLowerCase();
        const match = !query || haystack.includes(query);
        row.style.display = match ? "" : "none";
        if (match) visible += 1;
      });

      const empty = document.querySelector("[data-empty-state]");
      if (empty) {
        empty.hidden = visible !== 0;
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
