document.addEventListener("DOMContentLoaded", () => {
  const sidebar = document.querySelector("[data-sidebar]");
  const menuToggle = document.querySelector("[data-menu-toggle]");
  const modal = document.querySelector("[data-modal]");
  const modalBody = document.querySelector("[data-modal-body]");
  const modalTitle = document.querySelector("[data-modal-title]");
  const modalFoot = document.querySelector("[data-modal-foot]");

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
        const plan = button.dataset.memberPlan || "Monthly Payment";
        const status = button.dataset.memberStatus || "Active";
        const expires = button.dataset.memberExpiry || "May 20, 2026";
        renderModal({
          title: name,
          body: `
            <div class="grid grid-two">
              <div class="status-card">
                <small class="sidebar-label">Membership Plan</small>
                <h4>${plan}</h4>
                <p>Static demo information shown for UI presentation only.</p>
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

  const scanButton = document.querySelector("[data-scan-trigger]");
  const scanOutputs = document.querySelectorAll("[data-scan-output]");
  const scanLabel = document.querySelector("[data-scan-label]");
  const scanModes = ["ready", "scanning", "member", "nonmember", "expired"];
  let scanIndex = 0;

  if (scanButton && scanOutputs.length) {
    const scanDialogs = {
      member: {
        title: "Member detected",
        body: `
          <div class="grid grid-two">
            <div class="status-card">
              <small class="sidebar-label">Matched Member</small>
              <h4>Nicole Tan</h4>
              <p>Monthly Payment membership is active until May 19, 2026.</p>
            </div>
            <div class="status-card">
              <small class="sidebar-label">Access Result</small>
              <h4>Access allowed</h4>
              <p>Member may enter until gym closing time at 9:00 PM.</p>
            </div>
          </div>
        `,
        footer: `
          <button class="button-ghost" type="button" data-modal-close>Close</button>
          <a class="button" href="member-list.html">Open Member List</a>
        `
      },
      nonmember: {
        title: "No member record found",
        body: `
          <div class="status-card">
            <small class="sidebar-label">Fingerprint Result</small>
            <h4>Person is not a registered member</h4>
            <p>No matching member profile was found in this demo scan state. Continue to the registration page to create a new member profile.</p>
          </div>
        `,
        footer: `
          <button class="button-ghost" type="button" data-modal-close>Close</button>
          <a class="button" href="register-member.html">Register New Member</a>
        `
      },
      expired: {
        title: "Membership expired",
        body: `
          <div class="grid grid-two">
            <div class="status-card">
              <small class="sidebar-label">Matched Member</small>
              <h4>Joaquin Ramos</h4>
              <p>Monthly Payment membership expired on April 20, 2026.</p>
            </div>
            <div class="status-card">
              <small class="sidebar-label">Action Required</small>
              <h4>Renew membership</h4>
              <p>Front desk should renew before granting access to the gym floor.</p>
            </div>
          </div>
        `,
        footer: `
          <button class="button-ghost" type="button" data-modal-close>Close</button>
          <a class="button" href="renew-membership.html">Renew Membership</a>
        `
      }
    };

    const setScanState = (state) => {
      scanOutputs.forEach((panel) => {
        panel.classList.toggle("active", panel.dataset.scanOutput === state);
      });

      const labels = {
        ready: "Ready to scan",
        scanning: "Scanning fingerprint",
        member: "Member detected",
        nonmember: "Not a member",
        expired: "Renew membership"
      };

      if (scanLabel) {
        scanLabel.textContent = labels[state];
      }

       if (modal && scanDialogs[state]) {
        renderScanDialog(scanDialogs[state]);
      }
    };

    const renderScanDialog = (config) => {
      if (modalTitle) {
        modalTitle.textContent = config.title;
      }
      if (modalBody) {
        modalBody.innerHTML = config.body;
      }
      if (modalFoot) {
        modalFoot.innerHTML = config.footer;
      }
      modal.classList.add("open");
    };

    setScanState(scanModes[scanIndex]);

    scanButton.addEventListener("click", () => {
      scanIndex = (scanIndex + 1) % scanModes.length;
      setScanState(scanModes[scanIndex]);
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
