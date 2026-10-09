/* ============================================================
   app.js
   Application controller: holds in-memory state, wires UI
   events, manages the medication selection flow, and persists
   changes via PharmacyStorage.
   ============================================================ */

(function (global) {
  "use strict";

  // -------- In-memory state (mirror of storage for fast renders) --------
  const state = {
    patients: {},          // bedKey -> patient
    medications: [],       // catalog
    currentBed: null,      // { key, roomId, bed }
    // bottom-sheet selection state
    sheet: {
      open: false,
      activeTab: "vial",         // "vial" (default) | "tablet" — which form is shown
      selected: new Set(),        // med ids
      selectedList: [],          // [{ id, nameTrade, nameAr, nameEn, form, dose, frequency }]
      filter: ""
    },
    // admin editor state
    admin: {
      editingId: null,         // med id being edited; null = new
      isNew: false,
      selectedId: null         // row highlight
    }
  };

  // -------- Shortcuts --------
  const Storage = global.PharmacyStorage;
  const Ward    = global.PharmacyWard;
  const Meds    = global.PharmacyMedications;
  const UI      = global.PharmacyUI;
  const SB      = global.PharmacySupabase;          // may be undefined on very old browsers
  const SBSync  = global.PharmacySupabaseSync;      // may be undefined
  const Auth    = global.PharmacyAuth;             // auth module
  const $ = (id) => document.getElementById(id);

  // -------- Init --------
  function init() {
    hydrate();
    bindAuthEvents();
    bindEvents();
    bindPwaInstall();
    applyRoleVisibility();
    initDarkMode();
    initDisplayMode();
    // Show login overlay if not logged in, otherwise show the app
    if (Auth && Auth.isLoggedIn()) {
      showApp();
      refreshAll();
      UI.showView("home");
      pullCatalogOnBoot();
      initRealtime();
      // Start periodic polling as a backup for Realtime. Realtime
      // should deliver changes within 100-500ms, but it can fail
      // silently (channel timeouts, network blips, mobile sleep).
      // The poller pulls every 30s + refreshes local state — so
      // even if Realtime drops, the user sees fresh data within
      // 30s. This is the safety net that catches the doctor-to-
      // pharmacist sync when Realtime is unreliable.
      startPolling();
    } else {
      showLogin();
    }
  }

  // -------- Periodic polling fallback --------
  // Pulls patients + catalog from Supabase every POLL_INTERVAL_MS
  // (30s). This is the safety net for when Realtime fails to deliver
  // a change (which happens more often than expected on mobile +
  // flaky networks + when the Supabase project goes to sleep).
  //
  // The poller is cheap: pullPatients only fetches the deltas (via
  // the merge function that compares updatedAt), so it doesn't
  // transfer the full table every time.
  //
  // The poller is also triggered immediately when the page becomes
  // visible again (after the user switches back to the app tab).
  const POLL_INTERVAL_MS = 30000;
  let _pollTimer = null;
  function startPolling() {
    stopPolling();
    _pollTimer = setInterval(pollOnce, POLL_INTERVAL_MS);
    // Also poll when the tab becomes visible again (user switches
    // back to the app). This catches changes that arrived while
    // the tab was hidden (mobile browsers throttle/suspend timers
    // in background tabs, so the interval might have been paused).
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  function stopPolling() {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }
  function onVisibilityChange() {
    if (!document.hidden) {
      // Tab became visible — poll immediately for fresh data.
      pollOnce();
    }
  }
  async function pollOnce() {
    if (!SB || !SBSync || !SB.isConfigured()) return;
    try {
      // Only pull patients if we're NOT currently viewing a patient.
      // Pulling while viewing would overwrite local edits (like med
      // deletes) with a potentially stale cloud version (the push
      // may still be in flight). The patient view is always saved
      // on blur + on back-button, so the local state is always
      // fresher than the cloud while the patient view is open.
      if (!state.currentBed) {
        const pres = await SBSync.pullPatients();
        if (pres && pres.ok) {
          state.patients = Storage.loadPatients();
          refreshStatsAndRooms();
        }
      }
      // Also pull med requests from Supabase (so the admin sees new
      // doctor requests even if Realtime failed to deliver them).
      // This is the safety net for the med-request workflow.
      const client = SB.getClient();
      if (client) {
        const { data: medReqData, error: medReqErr } = await client
          .from("med_requests")
          .select("*")
          .order("requested_at", { ascending: false });
        if (!medReqErr && Array.isArray(medReqData)) {
          // Convert Supabase rows → local format + save
          const localRequests = medReqData.map(r => ({
            id: r.id, nameTrade: r.name_trade || "", nameEn: r.name_en || "",
            nameAr: r.name_ar || "", dose: r.dose || "", form: r.form || "tablet",
            frequency: r.frequency || "1×1", notes: r.notes || "",
            requestedBy: r.requested_by || "", requestedAt: r.requested_at || "",
            status: r.status || "pending", reviewedBy: r.reviewed_by || "",
            reviewedAt: r.reviewed_at || "", approvedMedId: r.approved_med_id || ""
          }));
          // Only update if something changed (compare count to avoid
          // unnecessary re-renders on every poll)
          const oldCount = Storage.loadMedRequests().length;
          Storage.saveMedRequests(localRequests);
          if (localRequests.length !== oldCount) {
            console.log("[Poll] med requests changed:", oldCount, "→", localRequests.length);
            // Re-render the admin med requests list if open
            const adminView = document.getElementById("view-admin");
            if (adminView && !adminView.hidden) {
              renderMedRequests();
            }
            // Update the settings row badge count
            if (Auth && Auth.isAdmin && Auth.isAdmin()) {
              const pendingCount = Storage.getPendingMedRequestsCount();
              const valEl = $("settings-med-request-value");
              if (valEl) valEl.textContent = pendingCount > 0 ? `${pendingCount} طلب` : "";
            }
          }
        }
      }
    } catch (e) {
      console.warn("[Poll] pull failed:", e);
    }
  }

  // -------- Pull med requests from Supabase --------
  // Called on boot (onLoginSuccess) + on openAdminView + every 30s
  // via pollOnce. Pulls all med_requests from Supabase, saves them
  // locally, and pushes a notification for any NEW pending requests
  // that the admin hasn't seen yet.
  async function pullMedRequestsFromCloud() {
    if (!SB || !SB.isConfigured || !SB.isConfigured()) return;
    const client = SB.getClient();
    if (!client) return;
    try {
      const { data, error } = await client
        .from("med_requests")
        .select("*")
        .order("requested_at", { ascending: false });
      if (error || !Array.isArray(data)) return;
      // Convert Supabase rows → local format
      const localRequests = data.map(r => ({
        id: r.id, nameTrade: r.name_trade || "", nameEn: r.name_en || "",
        nameAr: r.name_ar || "", dose: r.dose || "", form: r.form || "tablet",
        frequency: r.frequency || "1×1", notes: r.notes || "",
        requestedBy: r.requested_by || "", requestedAt: r.requested_at || "",
        status: r.status || "pending", reviewedBy: r.reviewed_by || "",
        reviewedAt: r.reviewed_at || "", approvedMedId: r.approved_med_id || ""
      }));
      // Detect NEW pending requests that we didn't have locally
      const oldRequests = Storage.loadMedRequests();
      const oldIds = new Set(oldRequests.map(r => r.id));
      const newPending = localRequests.filter(r =>
        r.status === "pending" && !oldIds.has(r.id)
      );
      // Save to localStorage
      Storage.saveMedRequests(localRequests);
      // For each NEW pending request, push a notification + play sound
      // (so the admin actually hears/sees the alert)
      const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
      newPending.forEach(r => {
        // Don't notify about our own requests
        if (r.requestedBy !== (user ? user.username : "")) {
          pushNotification("med_request",
            `طلب دواء جديد: ${r.nameTrade} — من ${r.requestedBy}`,
            r.nameTrade, "");
        }
      });
      // Re-render admin list if open
      const adminView = document.getElementById("view-admin");
      if (adminView && !adminView.hidden) {
        renderMedRequests();
      }
      // Update settings badge
      if (Auth && Auth.isAdmin && Auth.isAdmin()) {
        const pendingCount = Storage.getPendingMedRequestsCount();
        const valEl = $("settings-med-request-value");
        if (valEl) valEl.textContent = pendingCount > 0 ? `${pendingCount} طلب` : "";
      }
    } catch (e) {
      console.warn("[Pull] med requests failed:", e);
    }
  }

  function hydrate() {
    const data = Storage.loadAll();
    state.patients    = data.patients || {};
    state.medications = data.medications && data.medications.length
      ? data.medications
      : Meds.DEFAULT_MEDICATIONS.slice();
  }

  // -------- Dark mode --------
  function initDarkMode() {
    // Restore saved preference
    try {
      const saved = localStorage.getItem("pharma.darkmode");
      if (saved === "true") {
        document.documentElement.setAttribute("data-theme", "dark");
      }
    } catch (e) { /* ignore */ }
    const btn = $("darkmode-toggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const html = document.documentElement;
      const isDark = html.getAttribute("data-theme") === "dark";
      if (isDark) {
        html.removeAttribute("data-theme");
        try { localStorage.setItem("pharma.darkmode", "false"); } catch (e) {}
      } else {
        html.setAttribute("data-theme", "dark");
        try { localStorage.setItem("pharma.darkmode", "true"); } catch (e) {}
      }
    });
  }

  // -------- Display Mode (TV / large screen, view-only) --------
  // Detects large screens (>= 1280px) or TV user agents, and offers
  // a full-screen display mode showing the ward map for monitoring.
  let _displayModeActive = false;
  let _displayClockTimer = null;

  // -------- Last supply distribution memory --------
  // When the user generates the chart via the supply-order modal, the
  // supplyDistribution is saved here. Later, if the user opens the
  // med summary modal via the red button (without re-running through
  // the supply-order flow), this saved distribution is used so the
  // Supplies category reflects what was last distributed.
  let _lastSupplyDistribution = null;

  function initDisplayMode() {
    const btn = $("display-mode-exit");
    if (btn) {
      btn.addEventListener("click", exitDisplayMode);
    }
    // Check if we should auto-enter display mode
    // (after login, not on first load — user might want normal mode)
    // We add a button in the header for manual toggle, and auto-enter
    // only if the screen is very large AND user agent suggests a TV.
  }

  function shouldOfferDisplayMode() {
    const isLargeScreen = window.innerWidth >= 1280;
    const ua = (navigator.userAgent || "").toLowerCase();
    const isTV = ua.indexOf("tv") >= 0 || ua.indexOf("smarttv") >= 0 ||
                 ua.indexOf("webos") >= 0 || ua.indexOf("tizen") >= 0;
    return isLargeScreen || isTV;
  }

  function enterDisplayMode() {
    const dm = $("display-mode");
    if (!dm) return;
    _displayModeActive = true;
    dm.hidden = false;
    // Try to enter browser fullscreen
    try {
      if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen();
      }
    } catch (e) { /* may fail if not user-initiated */ }
    renderDisplayMode();
    // Start clock
    updateDisplayClock();
    _displayClockTimer = setInterval(updateDisplayClock, 1000);
  }

  function exitDisplayMode() {
    const dm = $("display-mode");
    if (!dm) return;
    _displayModeActive = false;
    dm.hidden = true;
    if (_displayClockTimer) {
      clearInterval(_displayClockTimer);
      _displayClockTimer = null;
    }
    // Exit fullscreen if active
    try {
      if (document.fullscreenElement && document.exitFullscreen) {
        document.exitFullscreen();
      }
    } catch (e) { /* ignore */ }
  }

  function updateDisplayClock() {
    const el = $("display-mode-time");
    if (!el) return;
    const now = new Date();
    const dateStr = now.toLocaleDateString("ar", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
    const timeStr = now.toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    el.textContent = dateStr + " · " + timeStr;
  }

  function renderDisplayMode() {
    const container = $("display-mode-rooms");
    if (!container) return;
    container.innerHTML = "";
    const Ward = global.PharmacyWard;
    if (!Ward || !Ward.ROOMS) return;

    // Local copy of bedSpecialFlags to avoid dependency on UI export
    const dmBedFlags = (patient) => {
      const flags = { hasAlbumin: false, hasMeronem: false };
      if (!patient || !Array.isArray(patient.medications)) return flags;
      for (const pm of patient.medications) {
        if (!pm) continue;
        const id = (pm.id || "").toLowerCase();
        const name = ((pm.nameTrade || "") + " " + (pm.nameEn || "") + " " + (pm.nameAr || "")).toLowerCase();
        if (id.indexOf("albumin") >= 0 || name.indexOf("albumin") >= 0 || name.indexOf("ألبومين") >= 0) flags.hasAlbumin = true;
        if (id.indexOf("meronem") >= 0 || id.indexOf("meropenem") >= 0 || name.indexOf("meronem") >= 0 || name.indexOf("meropenem") >= 0 || name.indexOf("ميرونيم") >= 0 || name.indexOf("ميروبينيم") >= 0) flags.hasMeronem = true;
      }
      return flags;
    };

    Ward.ROOMS.forEach(room => {
      const occupied = room.beds.filter(b => {
        const key = Ward.bedKey(room.id, b.number);
        const p = state.patients[key];
        return p && p.name && p.name.trim();
      }).length;
      const roomCard = document.createElement("div");
      roomCard.className = "dm-room";
      roomCard.innerHTML = `
        <div class="dm-room-head">
          <div class="dm-room-num">غرفة ${room.id}</div>
          <div class="dm-room-occ">${occupied} / ${room.bedCount} مشغول</div>
        </div>
        <div class="dm-beds"></div>
      `;
      const bedsGrid = roomCard.querySelector(".dm-beds");
      room.beds.forEach(bed => {
        const key = Ward.bedKey(room.id, bed.number);
        const p = state.patients[key] || null;
        const hasName = p && p.name && p.name.trim();
        const hasMeds = hasName && Array.isArray(p.medications) && p.medications.length > 0;
        const flags = hasName ? dmBedFlags(p) : { hasAlbumin: false, hasMeronem: false };
        let cls = "dm-bed-empty";
        let nameText = "فارغ";
        let flagHtml = "";
        if (hasName) {
          if (flags.hasAlbumin && flags.hasMeronem) {
            cls = "dm-bed-albumin-meronem";
            flagHtml = '<span class="dm-bed-flag">🟡🔴</span>';
          } else if (flags.hasAlbumin) {
            cls = "dm-bed-albumin";
            flagHtml = '<span class="dm-bed-flag">🟡</span>';
          } else if (flags.hasMeronem) {
            cls = "dm-bed-meronem";
            flagHtml = '<span class="dm-bed-flag">🔴</span>';
          } else if (hasMeds) {
            cls = "dm-bed-meds";
          } else {
            cls = "dm-bed-occupied";
          }
          nameText = p.name.trim();
        }
        const bedEl = document.createElement("div");
        bedEl.className = "dm-bed " + cls;
        bedEl.innerHTML = `
          <div class="dm-bed-num">سرير ${bed.number}</div>
          <div class="dm-bed-name">${nameText}</div>
          ${flagHtml}
        `;
        bedsGrid.appendChild(bedEl);
      });
      container.appendChild(roomCard);
    });
  }
  // We toggle the `is-authed` / `is-unauthed` class on <html> so the
  // pre-paint CSS gate (in <head>) stays in sync with runtime auth
  // state. The HTML default has `#app` visible and `#login-screen`
  // hidden, but the CSS in <head> overrides that based on the class
  // on <html>, so we must update the class whenever auth state changes
  // (login, logout, session expiry, etc.).
  function setAuthClass(loggedIn) {
    const html = document.documentElement;
    html.classList.toggle("is-authed",   !!loggedIn);
    html.classList.toggle("is-unauthed", !loggedIn);
  }

  function showLogin() {
    setAuthClass(false);
    $("login-screen").hidden = false;
    // Reset any previous form state
    $("login-username").value = "";
    $("login-password").value = "";
    $("login-error").hidden = true;
    // Focus the username field for fast typing on phones
    setTimeout(() => { try { $("login-username").focus(); } catch (e) {} }, 100);
  }

  function showApp() {
    setAuthClass(true);
    $("login-screen").hidden = true;
  }

  // Apply role-based visibility — controls which buttons appear on the
  // header for each role.
  //
  // Role permissions matrix:
  //   Button               | admin | pharmacist | doctor
  //   -------------------- | ----- | ---------- | ------
  //   ⚙ settings/admin     |  ✅   |  ✅        | ✅ (settings view)
  //   ⚫ chart (print)      |  ✅   |  ✅        | ❌ (doctors don't print)
  //   🔴 med summary        |  ✅   |  ✅        | ❌
  //   🟣 pills form        |  ✅   |  ✅        | ❌
  //   🔵 Excel export       |  ✅   |  ✅        | ❌
  //   🌙 dark mode         |  ✅   |  ❌ (in settings) | ❌ (in settings)
  //   📺 TV display        |  ✅   |  ❌ (in settings) | ❌ (in settings)
  //   🚪 logout (header)   |  ✅   |  ❌ (in settings) | ❌ (in settings)
  function applyRoleVisibility() {
    if (!Auth) return;
    const isAdmin = Auth.isAdmin();
    const isDoctor = Auth.isDoctor && Auth.isDoctor();

    // Update the role class on <html> so the pre-paint CSS gate
    // shows the correct header buttons. The pre-paint script in
    // <head> sets this class synchronously on page load, but we
    // re-apply it here so live role changes (login / logout /
    // switching user) also update the buttons.
    const root = document.documentElement;
    root.classList.remove('role-admin', 'role-doctor', 'role-pharmacist');
    if (isAdmin) {
      root.classList.add('role-admin');
    } else if (isDoctor) {
      root.classList.add('role-doctor');
    } else {
      root.classList.add('role-pharmacist');
    }

    // Gear button (settings/admin): always visible for ALL roles.
    // For admin → opens full admin view (med catalog + users + audit).
    // For pharmacist/doctor → opens simple settings view (dark mode +
    // TV + logout).
    const adminBtn = $("open-admin");
    if (adminBtn) adminBtn.hidden = false;

    // Chart + summary + pills-form + Excel buttons: pharmacist & admin only.
    // Hidden for doctors (doctors don't do chart printing or supply
    // distribution — that's the pharmacist's job).
    // NOTE: The CSS pre-paint gate handles the visual display via the
    // role class. We still set the `hidden` attribute here for
    // accessibility (screen readers honor `hidden`) and to ensure
    // the buttons aren't clickable when they shouldn't be.
    const isChartRole = isAdmin || !isDoctor;
    const chartBtn = $("print-chart-btn");
    if (chartBtn) chartBtn.hidden = !isChartRole;
    // Note: med-summary-btn was removed from the header (its modal
    // is still opened programmatically by the distribute-send-btn
    // workflow). No need to set its hidden attribute.
    const pillsBtn = $("print-pills-form-btn");
    if (pillsBtn) pillsBtn.hidden = !isChartRole;
    // Distribute + Send button: pharmacist + admin only (same access
    // as the chart / summary / pills buttons). Hidden for doctors.
    const distributeSendBtn = $("distribute-send-btn");
    if (distributeSendBtn) distributeSendBtn.hidden = !isChartRole;

    // Print ALL patient sheets button: admin + doctor only.
    // The pharmacist prints individual sheets from the patient view.
    const isPrintAllRole = isAdmin || isDoctor;
    const allSheetsBtn = $("print-all-sheets-btn");
    if (allSheetsBtn) allSheetsBtn.hidden = !isPrintAllRole;

    // Discharged list now in settings — no header button needed

    // Dark mode + TV + logout: only visible to admins (non-admins
    // access them via the Settings view instead).
    const darkBtn = $("darkmode-toggle");
    if (darkBtn) darkBtn.hidden = !isAdmin;
    const displayBtn = $("display-mode-btn");
    if (displayBtn) displayBtn.hidden = !isAdmin;
    const logoutBtn = $("logout-btn");
    if (logoutBtn) logoutBtn.hidden = !isAdmin;

    // Seniors tab: doctors + admins only (hidden for pharmacists).
    // The tab button is initially display:none in HTML, so we need
    // to explicitly clear that for authorized roles.
    const seniorsTab = document.querySelector('.nav-item[data-nav="seniors"]');
    if (seniorsTab) {
      seniorsTab.style.display = (isAdmin || isDoctor) ? "" : "none";
    }
  }

  // Bind login form + quick buttons + logout
  function bindAuthEvents() {
    if (!Auth) return;

    // Login form submit
    $("login-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = $("login-username").value;
      const password = $("login-password").value;
      // Show a loading state on the submit button so the user knows
      // the auth check is happening (especially with cloud login which
      // can take 1-2 seconds).
      const submitBtn = e.target.querySelector("button[type=submit]");
      const origText = submitBtn.textContent;
      submitBtn.textContent = "جارٍ التحقق…";
      submitBtn.disabled = true;
      try {
        const res = await Auth.login(username, password);
        if (res.ok) {
          onLoginSuccess();
        } else {
          const errEl = $("login-error");
          errEl.textContent = res.error;
          errEl.hidden = false;
        }
      } catch (err) {
        const errEl = $("login-error");
        errEl.textContent = (err && err.message) ? err.message : String(err);
        errEl.hidden = false;
      } finally {
        submitBtn.textContent = origText;
        submitBtn.disabled = false;
      }
    });

    // (Quick pharmacist login button was removed from the login
    // screen — all users must use the login form with username +
    // password now.)

    // Logout button in header
    $("logout-btn").addEventListener("click", () => {
      if (!confirm("هل تريد تسجيل الخروج؟")) return;
      // Unsubscribe from Realtime before logging out
      if (realtimeChannel) {
        try { realtimeChannel.unsubscribe(); } catch (e) { /* ignore */ }
        realtimeChannel = null;
      }
      Auth.logout();
      applyRoleVisibility();
      showLogin();
      flashHint("تم تسجيل الخروج");
    });
  }

  function onLoginSuccess() {
    $("login-error").hidden = true;
    applyRoleVisibility();
    showApp();
    refreshAll();
    // All roles (admin / pharmacist / doctor) use the SAME app view —
    // the home view (rooms grid). Role-based permissions (which buttons
    // are visible / which actions are allowed) are applied in
    // applyRoleVisibility() and the action handlers.
    UI.showView("home");
    pullCatalogOnBoot();
    initRealtime();
    // Also pull med requests immediately on login (so the admin sees
    // pending requests without waiting 30s for the first poll)
    pullMedRequestsFromCloud();
    updateNotifBadge();
    const user = Auth.getCurrentUser();
    // Personalized welcome: "أهلاً دكتور [name]" or "أهلاً دكتورة [name]"
    // depending on the user's gender (stored in the session).
    if (user) {
      const title = user.gender === "female" ? "دكتورة" : "دكتور";
      // Use only the first name (first word) for a warmer greeting
      // e.g. "عبدالله رائد" → "عبدالله", "زينب جمال" → "زينب"
      const firstName = (user.displayName || "").split(" ")[0] || user.displayName;
      flashHint(`أهلاً ${title} ${firstName}`);
    }
  }

  // -------- Supabase: pull catalog on boot --------
  // If Supabase is configured and reachable, replace the local catalog
  // with the cloud version — UNLESS the last push failed recently,
  // in which case the local catalog is fresher and we skip the pull
  // to avoid blowing away local edits that never made it to the cloud.
  async function pullCatalogOnBoot() {
    if (!SB || !SBSync || !SB.isConfigured()) {
      updateSupabaseStatusUI("غير مربوط");
      return;
    }
    updateSupabaseStatusUI("جارٍ المزامنة…", "loading");

    // If DEFAULT_MEDICATIONS is empty, it means the user wants a
    // completely empty catalog. Delete all rows from Supabase's
    // medications table + clear the local cache too.
    const def = (Meds && Meds.DEFAULT_MEDICATIONS) || [];
    if (def.length === 0) {
      console.log("[Sync] DEFAULT_MEDICATIONS is empty — wiping cloud + local catalog");
      const client = SB.getClient();
      if (client) {
        try {
          await client.from("medications").delete().neq("id", "");
          console.log("[Sync] cloud medications table cleared");
        } catch (e) {
          console.warn("[Sync] failed to clear cloud medications:", e);
        }
      }
      // Clear local cache
      Storage.saveMedications([]);
      state.medications = [];
      UI.renderAdminMedList([], null);
      updateSupabaseStatusUI("مربوط · 0 دواء", "connected");
      return;
    }

    // Cloud is the source of truth: pullCatalog() overwrites the
    // local cache with the cloud version. No merge, no push-back
    // needed — the cloud is what every device reads from.
    const res = await SBSync.pullCatalog();
    if (res.ok) {
      state.medications = Storage.loadMedications();
      UI.renderAdminMedList(state.medications, null);
      updateSupabaseStatusUI(`مربوط · ${res.count} دواء`, "connected");
      // ONE-TIME CLOUD SEED: if the cloud is empty or has fewer meds
      // than DEFAULT_MEDICATIONS, push the local defaults up so the
      // cloud becomes the source of truth with the full catalog.
      if (Array.isArray(state.medications) && def.length > 0 &&
          state.medications.length < def.length) {
        console.log("[Sync] cloud has " + state.medications.length + " meds, defaults have " + def.length + " — seeding cloud");
        state.medications = def.slice();
        Storage.saveMedications(def);
        UI.renderAdminMedList(def, null);
        updateSupabaseStatusUI(`مربوط · جارٍ رفع ${def.length} دواء للسحابة…`, "loading");
        SBSync.pushCatalog().then(r => {
          if (r.ok) updateSupabaseStatusUI(`مربوط · ${r.count} دواء`, "connected");
          else updateSupabaseStatusUI("فشل رفع الكتالوج: " + r.error, "error");
        });
      }
    } else if (res.skipped) {
      updateSupabaseStatusUI("يعمل محليًا · السحب متأخر", "error");
    } else {
      updateSupabaseStatusUI("خطأ: " + res.error, "error");
    }
    // Pull patients too
    const pres = await SBSync.pullPatients();
    if (pres.ok) {
      state.patients = Storage.loadPatients();
      refreshStatsAndRooms();
    }
  }

  // -------- Supabase Realtime --------
  // Subscribes to changes on the `patients` and `medications` tables.
  // When another device inserts/updates/deletes a patient or med,
  // the local state is updated in real-time without needing to press
  // the sync button.
  let realtimeChannel = null;
  function initRealtime() {
    if (!SB || !SB.isConfigured()) return;
    const client = SB.getClient();
    if (!client) return;
    // Don't subscribe twice
    if (realtimeChannel) {
      try { realtimeChannel.unsubscribe(); } catch (e) { /* ignore */ }
      realtimeChannel = null;
    }
    try {
      realtimeChannel = client
        .channel("pharma-realtime")
        .on("postgres_changes",
          { event: "*", schema: "public", table: "patients" },
          (payload) => {
            handlePatientRealtimeChange(payload);
          }
        )
        .on("postgres_changes",
          { event: "*", schema: "public", table: "medications" },
          (payload) => {
            handleMedicationRealtimeChange(payload);
          }
        )
        .on("postgres_changes",
          { event: "*", schema: "public", table: "med_requests" },
          (payload) => {
            handleMedRequestRealtimeChange(payload);
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            console.log("[Realtime] connected");
          } else if (status === "CHANNEL_ERROR") {
            console.warn("[Realtime] channel error");
          } else if (status === "TIMED_OUT") {
            console.warn("[Realtime] timed out, will retry");
          }
        });
    } catch (e) {
      console.warn("[Realtime] init failed:", e);
    }
  }

  function handlePatientRealtimeChange(payload) {
    // payload: { eventType: 'INSERT'|'UPDATE'|'DELETE', old: {...}, new: {...} }
    const bedKey = payload.new?.bed_key || payload.old?.bed_key;
    if (!bedKey) return;
    // Track whether this is a NEW patient (INSERT) or an UPDATE/
    // DELETE — used to play the right notification sound.
    let isInsert = false;
    let isDelete = false;
    if (payload.eventType === "DELETE") {
      // Another device deleted this patient
      isDelete = true;
      delete state.patients[bedKey];
      Storage.deletePatient(bedKey);
      Storage.saveLocalDeletion(bedKey);
    } else {
      // INSERT or UPDATE — sync this patient from the cloud
      // We do a lightweight local update rather than a full pull
      const row = payload.new;
      if (row) {
        // Detect INSERT (new patient) vs UPDATE (existing patient with
        // changed meds/info). If we don't have this bedKey locally, it's
        // an INSERT from another device.
        if (!state.patients[bedKey] || !state.patients[bedKey].name) {
          isInsert = true;
        }
        let meds = [];
        try {
          meds = typeof row.medications === "string"
            ? JSON.parse(row.medications)
            : (row.medications || []);
        } catch (e) { meds = []; }
        state.patients[bedKey] = {
          name:        row.name || "",
          plateNumber: row.plate_number || "",
          doctor:      row.doctor || "",
          diagnosis:   row.diagnosis || "",
          age:         row.age || "",
          gender:      row.gender || "",
          firstMedDate: row.first_med_date || "",
          labs:        row.labs ? (typeof row.labs === "string" ? JSON.parse(row.labs) : (row.labs || {})) : {},
          labHistory:  row.lab_history ? (typeof row.lab_history === "string" ? JSON.parse(row.lab_history) : (row.lab_history || [])) : [],
          medications: Array.isArray(meds) ? meds : [],
          updatedAt:   Date.parse(row.updated_at) || Date.now()
        };
        Storage.upsertPatient(bedKey, state.patients[bedKey]);
      }
    }
    refreshStatsAndRooms();
    // If display mode is active, refresh it too
    if (_displayModeActive) renderDisplayMode();
    // If the patient view is open, refresh it
    if (state.currentBed) {
      const p = state.patients[state.currentBed.key] || null;
      UI.renderPatientView(p, state.currentBed.roomId, state.currentBed.bed);
    }
    // Play a notification sound so the pharmacist (or any user on
    // another device) hears audible feedback when a doctor on
    // another device adds/changes/discharges a patient. We skip
    // the sound if the change was triggered by THIS device (the
    // same user already heard the sound when they made the change
    // via pushNotification). We detect this by comparing the
    // updated_at timestamp — if it's within 3 seconds of now, it's
    // likely this device's own write.
    //
    // Note: this is a heuristic. Real cross-user detection would
    // require a server-side "actor" field on each row. The 3-second
    // window is short enough to skip most echoes while still
    // catching genuine cross-device updates (which usually arrive
    // 100-500ms after the write).
    const updatedAt = payload.new?.updated_at
      ? Date.parse(payload.new.updated_at)
      : 0;
    const isOwnEcho = updatedAt > 0 && (Date.now() - updatedAt) < 3000;
    if (!isOwnEcho) {
      if (isInsert) {
        // Another device added a new patient — play the patient_added
        // chime so the pharmacist hears audible feedback.
        playNotificationSound("patient_added");
      }
      // Note: we no longer play sounds for UPDATE or DELETE events
      // from other devices. Only NEW patient additions get a chime.
      // This matches the user's preference: "play the sound only when
      // registering a new patient."
    }
  }

  function handleMedicationRealtimeChange(payload) {
    if (!SBSync || !SBSync.pullCatalog) return;
    // Don't re-pull the catalog if the admin view is currently open
    // and we just made an edit (delete/add). The push may still be
    // in flight to Supabase, and pulling now would get the OLD cloud
    // version (without our edit) and overwrite the local version
    // (with our edit). The admin view always saves on edit, so
    // the local state is fresher while the admin view is open.
    const adminView = document.getElementById("view-admin");
    if (adminView && !adminView.hidden) {
      // Skip this Realtime echo — our own edit just triggered it
      console.log("[Realtime] skipping catalog pull (admin view open, likely our own edit)");
      return;
    }
    SBSync.pullCatalog().then(res => {
      if (res.ok) {
        state.medications = Storage.loadMedications();
        UI.renderAdminMedList(state.medications, null);
      }
    });
  }

  // Handles Realtime changes to the 'med_requests' table from OTHER
  // devices. When a doctor submits a med request, it's pushed to
  // Supabase. This handler fires on the admin's device → adds the
  // request to the local list + plays a notification sound + pushes
  // a local notification so the admin sees the badge update.
  function handleMedRequestRealtimeChange(payload) {
    if (!SB || !SB.isConfigured()) return;
    const row = payload.new || payload.old;
    if (!row || !row.id) return;
    // Pull all med requests from Supabase + merge with local
    const client = SB.getClient();
    if (!client) return;
    client.from("med_requests").select("*").order("requested_at", { ascending: false }).then(({ data, error }) => {
      if (error || !Array.isArray(data)) return;
      // Convert Supabase rows → local format + save
      const localRequests = data.map(r => ({
        id: r.id,
        nameTrade: r.name_trade || "",
        nameEn: r.name_en || "",
        nameAr: r.name_ar || "",
        dose: r.dose || "",
        form: r.form || "tablet",
        frequency: r.frequency || "1×1",
        notes: r.notes || "",
        requestedBy: r.requested_by || "",
        requestedAt: r.requested_at || "",
        status: r.status || "pending",
        reviewedBy: r.reviewed_by || "",
        reviewedAt: r.reviewed_at || "",
        approvedMedId: r.approved_med_id || ""
      }));
      Storage.saveMedRequests(localRequests);
      // Re-render the med requests list if the admin view is open
      const adminView = document.getElementById("view-admin");
      if (adminView && !adminView.hidden) {
        renderMedRequests();
      }
      // If this is a NEW request (INSERT) from another device, play
      // the notification sound + push a local notification
      if (payload.eventType === "INSERT") {
        const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
        // Don't echo back to the sender
        if (row.requested_by !== (user ? user.username : "")) {
          pushNotification("med_request",
            `طلب دواء جديد: ${row.name_trade || "—"} — من ${row.requested_by || "—"}`,
            row.name_trade || "", "");
        }
      }
      // Update the settings row badge count (for admin)
      if (Auth && Auth.isAdmin && Auth.isAdmin()) {
        const pendingCount = Storage.getPendingMedRequestsCount();
        const valEl = $("settings-med-request-value");
        if (valEl) valEl.textContent = pendingCount > 0 ? `${pendingCount} طلب` : "";
      }
    });
  }
  // Push the local catalog to Supabase (called after every admin save).
  // If the push fails, the user is shown a clear warning so they know
  // their edits are local-only and won't appear on other devices until
  // the next successful push.
  async function pushCatalogAfterEdit(onRevert) {
    if (!SB || !SBSync || !SB.isConfigured()) {
      // Cloud not configured — nothing to sync. Skip silently (this
      // happens before Supabase setup; the local cache is the only
      // source then).
      return { ok: true, syncSkipped: true };
    }
    // Cloud is the source of truth: push the edit, and revert the
    // local cache if the push fails (so local reflects cloud truth).
    // `onRevert` (optional) is called when we revert, so the caller
    // can restore its in-memory state.medications to the pre-edit
    // version (re-read from storage after the revert).
    const res = await SBSync.pushCatalog();
    if (res.ok) {
      updateSupabaseStatusUI(`مربوط · ${res.count} دواء`, "connected");
      return { ok: true };
    }
    updateSupabaseStatusUI("خطأ في الرفع: " + res.error, "error");
    flashHint("⚠ فشل رفع التعديل — تم إلغاؤه. تحقق من الشبكة وحاول مرة أخرى.");
    console.warn("[Supabase] push failed:", res.error);
    // Cloud is the source of truth — reload from local cache (which
    // we need to reset to the cloud's current state). But we don't
    // have the cloud's current state since push failed; the safest
    // is to refresh state.medications from storage (which still
    // holds the edited version). The caller's onRevert callback is
    // responsible for undoing its in-memory edit.
    if (typeof onRevert === "function") {
      try { onRevert(); } catch (e) { /* ignore */ }
    }
    return { ok: false, error: res.error };
  }

  // Manual "push now" — used by the manual push button in advanced settings
  async function pushCatalogManual() {
    if (!SB || !SBSync || !SB.isConfigured()) {
      flashHint("Supabase غير مُهيّأ");
      return;
    }
    updateSupabaseStatusUI("جارٍ الرفع…", "loading");
    const res = await SBSync.pushCatalog();
    if (res.ok) {
      state.medications = Storage.loadMedications();
      UI.renderAdminMedList(state.medications, null);
      updateSupabaseStatusUI(`مربوط · ${res.count} دواء`, "connected");
      flashHint(`تم رفع ${res.count} دواء للسحابة`);
    } else {
      updateSupabaseStatusUI("فشل الرفع: " + res.error, "error");
      flashHint("فشل الرفع للسحابة: " + res.error);
    }
  }

  // Manual "pull now" — used by the manual pull button in advanced settings
  async function pullCatalogManual() {
    if (!SB || !SBSync || !SB.isConfigured()) {
      flashHint("Supabase غير مُهيّأ");
      return;
    }
    if (!confirm("سحب الكتالوج من السحابة سيستبدل نسختك المحلية.\nملاحظة: بيانات المرضى لن تُستبدل بل ستُدمج (الأحدث يفوز).\nهل تريد المتابعة؟")) return;
    updateSupabaseStatusUI("جارٍ السحب…", "loading");
    const res = await SBSync.pullCatalog(true);  // force = true
    if (res.ok) {
      state.medications = Storage.loadMedications();
      UI.renderAdminMedList(state.medications, null);
      updateSupabaseStatusUI(`مربوط · ${res.count} دواء`, "connected");
      flashHint(`تم سحب ${res.count} دواء من السحابة`);
    } else {
      updateSupabaseStatusUI("فشل السحب: " + res.error, "error");
      flashHint("فشل السحب من السحابة: " + res.error);
    }
    // Also merge-pull patients (non-destructive)
    const pres = await SBSync.pullPatients();
    if (pres.ok) {
      state.patients = Storage.loadPatients();
      refreshStatsAndRooms();
      flashHint(`تم دمج ${pres.count} مريض من السحابة`);
    }
  }

  // -------- Manual sync from the header button --------
  // Single tap → pulls catalog (force) + merge-pulls patients, with
  // a simple success message ("تمت المزامنة بنجاح") or a detailed
  // error message. Disables the button + spins the icon while the
  // sync is running so the user can't double-trigger it.
  let _syncInFlight = false;
  async function syncNow() {
    if (_syncInFlight) return; // prevent double-tap
    if (!SB || !SBSync || !SB.isConfigured()) {
      flashHint("Supabase غير مُهيّأ — افتح الإعدادات لربط الحساب");
      return;
    }

    const btn = $("sync-now-btn");
    const wasDisabled = btn ? btn.disabled : false;
    if (btn) {
      btn.disabled = true;
      btn.classList.add("is-syncing");
    }
    _syncInFlight = true;
    updateSupabaseStatusUI("جارٍ المزامنة…", "loading");

    let okCount = 0;
    let failCount = 0;
    let firstError = "";

    try {
      // 1) Pull catalog (force = true to bypass the "unsynced local
      //    edits" guard, since the user explicitly asked for a sync).
      //    Cloud is the source of truth — pullCatalog() overwrites
      //    the local cache.
      const cres = await SBSync.pullCatalog(true);
      if (cres.ok) {
        state.medications = Storage.loadMedications();
        UI.renderAdminMedList(state.medications, null);
        okCount++;
      } else if (cres.skipped) {
        // skipped is not really a failure — local catalog is fresher
        okCount++;
      } else {
        failCount++;
        firstError = firstError || ("الكتالوج: " + cres.error);
      }

      // 2) Merge-pull patients (non-destructive, last-write-wins)
      const pres = await SBSync.pullPatients();
      if (pres.ok) {
        state.patients = Storage.loadPatients();
        refreshStatsAndRooms();
        okCount++;
      } else {
        failCount++;
        firstError = firstError || ("المرضى: " + pres.error);
      }

      // 3) Report result
      if (failCount === 0) {
        updateSupabaseStatusUI(
          `مربوط · ${state.medications.length} دواء · ${Object.keys(state.patients).length} مريض`,
          "connected"
        );
        flashHint("تمت المزامنة بنجاح");
      } else if (okCount === 0) {
        updateSupabaseStatusUI("فشلت المزامنة: " + firstError, "error");
        flashHint("فشلت المزامنة: " + firstError);
      } else {
        // partial: one part failed, the other succeeded
        updateSupabaseStatusUI("مزامنة جزئية — فشل: " + firstError, "error");
        flashHint("مزامنة جزئية — فشل: " + firstError);
      }
    } catch (e) {
      const msg = (e && e.message) ? e.message : String(e);
      updateSupabaseStatusUI("فشلت المزامنة: " + msg, "error");
      flashHint("فشلت المزامنة: " + msg);
    } finally {
      _syncInFlight = false;
      if (btn) {
        btn.classList.remove("is-syncing");
        btn.disabled = wasDisabled;
      }
    }
  }

  // -------- iOS PWA print workaround --------
  // window.print() doesn't work in iOS Safari's standalone mode
  // (when the app is added to the home screen). The workaround: open
  // a NEW Safari tab containing only the chart + the print CSS, then
  // call window.print() inside that new tab. Safari proper has full
  // AirPrint support, so the print dialog opens normally.
  //
  // Returns true if the new window was opened successfully, false
  // otherwise (popup blocked, no permission, etc.).
  function printChartInNewWindow() {
    const chartRoot = document.getElementById("chart-print-root");
    if (!chartRoot) return false;

    // Get the chart HTML (already built by UI.buildChartReport)
    const chartHTML = chartRoot.innerHTML;

    // Open a new tab. _blank + no features so iOS Safari opens a
    // full Safari tab (not a PWA child window).
    const printWindow = window.open("", "_blank");
    if (!printWindow) return false; // popup blocked

    // Self-contained HTML doc with:
    // - Google Fonts (Tajawal, Cairo) for proper Arabic rendering
    // - The chart print CSS (extracted from styles.css, no @media
    //   print wrapper needed since the whole document is the print
    //   content)
    // - The chart HTML
    // - An inline script that triggers print() after the fonts
    //   have had a chance to load, then closes the tab.
    const doc = printWindow.document;
    doc.open();
    doc.write([
      '<!DOCTYPE html>',
      '<html lang="ar" dir="rtl">',
      '<head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
      '<title>طباعة التشارت</title>',
      '<link rel="preconnect" href="https://fonts.googleapis.com">',
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
      '<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet">',
      '<style>',
      '@page { size: A4 landscape; margin: 3mm; }',
      'body { background: #fff; margin: 0; padding: 0; color: #000; font-family: "Tajawal", "Cairo", "Arial", sans-serif; }',
      '.chart-print-root { display: table; width: 100%; height: 100%; }',
      '.chart-page { display: table-cell; vertical-align: middle; }',
      '.chart-matrix { width: calc(100% - 8px); margin: 4px; border-collapse: collapse; font-size: 7px; table-layout: fixed; border: 2px solid #000; box-shadow: 0 0 0 2px #fff, 0 0 0 3.5px #000; }',
      '.chart-patient-col-header { background: #fff; color: #000; font-weight: 800; padding: 1px 2px; border: 1.5px solid #000; text-align: center; font-size: 9px; width: 60px; min-width: 60px; vertical-align: middle; line-height: 1.3; }',
      '.chart-med-col-header { background: #fff; color: #000; border: 1.5px solid #000; padding: 1px 0; text-align: center; vertical-align: middle; height: 70px; width: 16px; min-width: 16px; }',
      '.chart-med-label { writing-mode: vertical-rl; text-orientation: mixed; font-size: 10px; font-weight: 700; line-height: 1.05; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-height: 65px; margin: auto 0; display: block; }',
      '.chart-patient-cell { background: #fff; font-weight: 700; padding: 0 3px; border: 1.5px solid #000; text-align: center; vertical-align: middle; width: 60px; min-width: 60px; height: 16px; font-size: 8px; color: #000; line-height: 16px; }',
      '.chart-cell { border: 1.5px solid #000; text-align: center !important; vertical-align: middle; padding: 0; font-size: 11px; font-weight: 800; color: #000; width: 16px; min-width: 16px; height: 16px; line-height: 16px; background: #fff; box-sizing: border-box; display: table-cell; }',
      '.chart-matrix tr { height: 16px; }',
      '.chart-cell-custom { font-size: 11px; font-weight: 700; line-height: 1; }',
      '.chart-page-break { page-break-before: always; }',
      '.chart-matrix th, .chart-matrix td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
      '/* iOS smaller cells */',
      'html.is-ios .chart-cell { height: 14px; line-height: 14px; font-size: 10px; }',
      'html.is-ios .chart-patient-cell { height: 14px; line-height: 14px; font-size: 7px; }',
      'html.is-ios .chart-matrix tr { height: 14px; }',
      'html.is-ios .chart-cell-custom { font-size: 10px; }',
      'html.is-ios .chart-med-col-header { height: 60px; }',
      'html.is-ios .chart-med-label { max-height: 55px; }',
      '</style>',
      '<script>document.documentElement.className += " is-ios";</script>',
      '</head>',
      '<body>',
      '<div class="chart-print-root">',
      chartHTML,
      '</div>',
      '<script>',
      // Wait for fonts to load before printing. We try a few
      // strategies: (1) wait for window.load (fonts cached), then
      // (2) wait a short delay to ensure layout has settled.
      'window.addEventListener("load", function() {',
      // 800ms gives the fonts time to load even on slow networks.
      // The chart is already rendered visually; print is just
      // snapshotting what's on screen.
      '  setTimeout(function() {',
      '    try { window.print(); } catch (e) {}',
      // Try to close the tab after printing. iOS Safari may block
      // window.close() for tabs the user opened (vs. those opened
      // by script), but since we opened this via window.open(), it
      // should be closeable. Wrap in try/catch in case it isn't.
      '    setTimeout(function() { try { window.close(); } catch (e) {} }, 1000);',
      '  }, 800);',
      '});',
      '<\/script>',
      '</body>',
      '</html>'
    ].join('\n'));
    doc.close();
    return true;
  }

  // Update the small status badge in the Supabase settings panel.
  function updateSupabaseStatusUI(text, kind) {
    const el = $("sb-status");
    if (!el) return;
    el.textContent = "الحالة: " + text;
    el.classList.remove("is-connected", "is-error", "is-loading");
    if (kind === "connected") el.classList.add("is-connected");
    else if (kind === "error") el.classList.add("is-error");
    else if (kind === "loading") el.classList.add("is-loading");
  }

  // Pre-fill the Supabase settings inputs if already configured.
  function refreshSupabaseInputs() {
    if (!SB) return;
    const cfg = SB.loadConfig();
    if (cfg) {
      $("sb-url").value = cfg.url || "";
      $("sb-key").value = cfg.anonKey || "";
    }
  }

  // -------- Render refresh --------
  function refreshAll() {
    UI.renderStats(state.patients);
    UI.renderRooms(state.patients);
    UI.renderPatientsList(state.patients);
    if (state.currentBed) {
      const p = state.patients[state.currentBed.key] || null;
      UI.renderPatientView(p, state.currentBed.roomId, state.currentBed.bed);
    }
  }

  function refreshPatientViewOnly() {
    if (!state.currentBed) return;
    const p = state.patients[state.currentBed.key] || null;
    UI.renderPatientView(p, state.currentBed.roomId, state.currentBed.bed);
  }

  function refreshStatsAndRooms() {
    // Save scroll position before re-rendering rooms (renderRooms
    // clears innerHTML which resets scroll to top).
    const scrollY = window.scrollY;
    UI.renderStats(state.patients);
    UI.renderRooms(state.patients);
    UI.renderPatientsList(state.patients);
    // Restore scroll position if we were on the home view
    // (so the user doesn't lose their place in the rooms grid).
    const homeView = document.getElementById("view-home");
    if (homeView && !homeView.hidden && scrollY > 0) {
      window.scrollTo(0, scrollY);
    }
  }

  // -------- Patient helpers --------
  function ensurePatient(bedKey) {
    if (!state.patients[bedKey]) state.patients[bedKey] = { name: "", plateNumber: "", medications: [] };
    if (!Array.isArray(state.patients[bedKey].medications)) {
      state.patients[bedKey].medications = [];
    }
    // Backfill plateNumber for patients created before this field
    // existed (legacy patient objects don't have the property).
    if (!("plateNumber" in state.patients[bedKey])) {
      state.patients[bedKey].plateNumber = "";
    }
    // Backfill age + gender for patients created before these fields
    // existed. Both are optional but should always be defined as a
    // string (never undefined) so the UI can render them safely.
    if (!("age" in state.patients[bedKey])) {
      state.patients[bedKey].age = "";
    }
    if (!("gender" in state.patients[bedKey])) {
      state.patients[bedKey].gender = "";  // "" | "male" | "female"
    }
    return state.patients[bedKey];
  }
  function persistPatient(bedKey) {
    Storage.upsertPatient(bedKey, state.patients[bedKey]);
    refreshStatsAndRooms();
    // Push patients to Supabase (fire-and-forget, with one retry)
    if (SBSync && SBSync.pushPatients) {
      SBSync.pushPatients().then(r => {
        if (!r.ok) {
          console.warn("[Supabase] patient push failed, retrying once:", r.error);
          // Retry once after a short delay (network blip recovery)
          setTimeout(() => {
            SBSync.pushPatients().then(r2 => {
              if (!r2.ok) console.warn("[Supabase] patient push retry failed:", r2.error);
            });
          }, 2000);
        }
      });
    }
  }

  // Flush any pending patient changes to Storage + Supabase. Called
  // when the user navigates away from the patient page (back button,
  // room grid tap, etc.) to ensure click-based changes (gender
  // toggle, lab values) — which don't fire blur events — are still
  // persisted before the current bed is cleared.
  function flushPendingPatientChanges() {
    if (!state.currentBed) return;
    const bedKey = state.currentBed.key;
    const p = state.patients[bedKey];
    if (!p) return;
    persistPatient(bedKey);
  }

  // -------- GFR (eGFR) calculator --------
  // Computes the estimated Glomerular Filtration Rate using the
  // CKD-EPI 2021 refit equation (the latest version, which dropped
  // the race coefficient). Returns null when any input is missing
  // or invalid so the UI can hide the card.
  //
  // Formula (CKD-EPI 2021):
  //   eGFR = 142 × min(Scr/κ, 1)^α × max(Scr/κ, 1)^-1.200 × 0.9938^age × (1.012 if female)
  //   where:
  //     Scr  = serum creatinine in mg/dL
  //     κ    = 0.7 (female) or 0.9 (male)
  //     α    = -0.241 (female) or -0.302 (male)
  //
  // Returns:
  //   { gfr: <number rounded to 1 decimal>, stage: <G1..G5>, stageLabel: <string> }
  //   or null if age/gender/creatinine missing/invalid.
  function calculateGFR(patient) {
    if (!patient) return null;
    const ageRaw = String(patient.age || "").trim();
    const gender = patient.gender || "";
    const scrRaw = patient.labs && patient.labs.creatinine
      ? String(patient.labs.creatinine).trim()
      : "";
    if (!ageRaw || !scrRaw || !gender) return null;
    const age = parseFloat(ageRaw);
    const scr = parseFloat(scrRaw);
    if (!isFinite(age) || age <= 0 || age > 120) return null;
    if (!isFinite(scr) || scr <= 0) return null;
    if (gender !== "male" && gender !== "female") return null;

    // CKD-EPI 2021 coefficients by gender
    const k = (gender === "female") ? 0.7 : 0.9;
    const a = (gender === "female") ? -0.241 : -0.302;
    const ratio = scr / k;
    const minTerm = Math.min(ratio, 1);
    const maxTerm = Math.max(ratio, 1);
    let eGFR = 142
      * Math.pow(minTerm, a)
      * Math.pow(maxTerm, -1.200)
      * Math.pow(0.9938, age);
    if (gender === "female") {
      eGFR = eGFR * 1.012;
    }
    // Clamp to a sane range; values above ~250 are rare and
    // usually indicate a data-entry error.
    eGFR = Math.max(0, Math.min(250, eGFR));

    // KDIGO classification (G1-G5) — used for color coding + stage label.
    let stage, stageLabel;
    if (eGFR >= 90)      { stage = "g1";  stageLabel = "G1 طبيعي"; }
    else if (eGFR >= 60) { stage = "g2";  stageLabel = "G2 انخفاض طفيف"; }
    else if (eGFR >= 45) { stage = "g3a"; stageLabel = "G3a انخفاض متوسط-بسيط"; }
    else if (eGFR >= 30) { stage = "g3b"; stageLabel = "G3b انخفاض متوسط-شديد"; }
    else if (eGFR >= 15) { stage = "g4";  stageLabel = "G4 شديد"; }
    else                 { stage = "g5";  stageLabel = "G5 فشل كلوي"; }

    return {
      gfr: Math.round(eGFR * 10) / 10,
      stage: stage,
      stageLabel: stageLabel
    };
  }

  // Renders the GFR card based on the current patient (if any).
  // Hides the card when the calculation can't be performed.
  function renderGFRCard() {
    const card = document.getElementById("gfr-card");
    const valueEl = document.getElementById("gfr-value");
    const stageEl = document.getElementById("gfr-stage");
    const formulaEl = document.getElementById("gfr-formula");
    if (!card) return;

    let result = null;
    if (state.currentBed) {
      const p = state.patients[state.currentBed.key];
      result = calculateGFR(p);
    }
    if (!result) {
      card.hidden = true;
      // Clean up any stage classes so the card starts fresh next time
      ["g1","g2","g3a","g3b","g4","g5"].forEach(s => card.classList.remove("stage-" + s));
      if (valueEl) valueEl.textContent = "—";
      if (stageEl) stageEl.textContent = "";
      return;
    }
    card.hidden = false;
    if (valueEl) valueEl.textContent = String(result.gfr);
    if (stageEl) stageEl.textContent = result.stageLabel;
    if (formulaEl) formulaEl.textContent = "CKD-EPI 2021";
    // Apply stage color class (remove all, then add the right one)
    ["g1","g2","g3a","g3b","g4","g5"].forEach(s => card.classList.remove("stage-" + s));
    card.classList.add("stage-" + result.stage);
  }

  // Expose so other event handlers in this IIFE can trigger a recompute.
  // (Also exposed to ui.js renderPatientView so the card refreshes when
  // a patient is loaded/switched.)
  global._renderGFRCard = renderGFRCard;

  // -------- Previous admission banner --------
  // When the patient view is opened, we look up the discharged list for
  // a record whose name matches this patient's name (case-insensitive,
  // trimmed). If found, we render a small yellow banner inside the
  // patient header showing the most recent final diagnosis + date so
  // the doctor can see prior history at a glance.
  //
  // Matching uses name only (not plate number) because plate numbers
  // are optional and patients may forget them between admissions. We
  // sort discharged records by dischargedAt desc so the banner shows
  // the LATEST final diagnosis if the patient has been admitted multiple
  // times before.
  function renderPreviousAdmissionBanner(patient) {
    // Always remove any previously inserted banner first.
    const patientHeader = document.querySelector(".patient-header");
    if (patientHeader) {
      const existing = patientHeader.querySelector(".previous-admission-banner");
      if (existing) existing.remove();
    }
    if (!patient || !patient.name || !patient.name.trim()) return;
    const name = patient.name.trim().toLowerCase();
    const discharged = Storage.loadDischarged();
    if (!Array.isArray(discharged) || discharged.length === 0) return;
    // Find all discharged records with the same name (case-insensitive)
    const matches = discharged.filter(r =>
      r && r.name && r.name.trim().toLowerCase() === name
    );
    if (matches.length === 0) return;
    // discharged is stored newest-first (unshift), so the first match
    // is the latest discharge. But to be safe, sort by dischargedAt.
    matches.sort((a, b) => {
      const aT = a.dischargedAt ? new Date(a.dischargedAt).getTime() : 0;
      const bT = b.dischargedAt ? new Date(b.dischargedAt).getTime() : 0;
      return bT - aT;
    });
    const latest = matches[0];
    const finalDx = (latest.finalDiagnosis && String(latest.finalDiagnosis).trim())
      ? String(latest.finalDiagnosis).trim()
      : "";
    if (!finalDx) return;  // no final diagnosis recorded — skip banner
    const dateStr = latest.dischargedAt
      ? new Date(latest.dischargedAt).toLocaleDateString("ar", { year: "numeric", month: "short", day: "numeric" })
      : "";

    // Clone the template + fill it in
    const template = document.getElementById("previous-admission-template");
    if (!template || !template.content) return;
    const banner = template.content.cloneNode(true);
    const valueEl = banner.querySelector(".previous-admission-value");
    const dateEl = banner.querySelector(".previous-admission-date");
    if (valueEl) valueEl.textContent = finalDx;
    if (dateEl) dateEl.textContent = dateStr ? `· تاريخ الخروج: ${dateStr}` : "";
    if (patientHeader) {
      patientHeader.appendChild(banner);
    }
  }
  global._renderPreviousAdmissionBanner = renderPreviousAdmissionBanner;

  // -------- Drug interaction alerts --------
  const DRUG_INTERACTIONS = [
    { matchA: ["ciprofloxacin", "cipro", "سيبروف"], matchB: ["vancomycin", "فانكو"], severity: "warning", msg: "Ciprofloxacin + Vancomycin: زيادة خطر اعتلال الكلى" },
    { matchA: ["furosemide", "lasix", "فيورو"], matchB: ["vancomycin", "فانكو"], severity: "danger", msg: "Furosemide + Vancomycin: خطر سمية كلوية" },
    { matchA: ["furosemide", "lasix", "فيورو"], matchB: ["amikacin", "أميكاسين"], severity: "danger", msg: "Furosemide + Amikacin: خطر سمية سمعية وكلوية" },
    { matchA: ["enoxaparin", "clexane", "إينوك"], matchB: ["heparin", "هيبا"], severity: "warning", msg: "Enoxaparin + Heparin: مضادات تخثر متعددة — خطر نزيف" },
    { matchA: ["enoxaparin", "clexane", "إينوك"], matchB: ["warfarin", "وارفارين"], severity: "danger", msg: "Enoxaparin + Warfarin: خطر نزيف شديد" },
    { matchA: ["aspirin", "أسبرين"], matchB: ["enoxaparin", "clexane", "إينوك"], severity: "warning", msg: "Aspirin + Enoxaparin: خطر نزيف" },
    { matchA: ["metronidazole", "flagyl", "فلاجيل"], matchB: ["alcohol", "كحول"], severity: "danger", msg: "Metronidazole + Alcohol: تفاعل ديسولفيرام (غثيان شديد)" },
    { matchA: ["ondansetron", "zofran", "أوندان"], matchB: ["metoclopramide", "primperan", "ميتوكلو"], severity: "warning", msg: "Ondansetron + Metoclopramide: زيادة خطر إطالة QT" },
    { matchA: ["amlodipine", "أملودي"], matchB: ["simvastatin", "سيمفا"], severity: "warning", msg: "Amlodipine + Simvastatin: زيادة خطر ألم عضلي" },
    { matchA: ["ciprofloxacin", "cipro", "سيبروف"], matchB: ["theophylline", "ثيوفل"], severity: "warning", msg: "Ciprofloxacin + Theophylline: زيادة مستوى Theophylline" },
  ];

  function checkDrugInteractions(medications) {
    if (!Array.isArray(medications) || medications.length < 2) return [];
    const alerts = [];
    const seenPairs = new Set();
    DRUG_INTERACTIONS.forEach(interaction => {
      const matchAFound = medications.some(pm => {
        const id = (pm.id || "").toLowerCase();
        const name = ((pm.nameTrade || "") + " " + (pm.nameEn || "") + " " + (pm.nameAr || "")).toLowerCase();
        return interaction.matchA.some(kw => id.indexOf(kw) >= 0 || name.indexOf(kw) >= 0);
      });
      const matchBFound = medications.some(pm => {
        const id = (pm.id || "").toLowerCase();
        const name = ((pm.nameTrade || "") + " " + (pm.nameEn || "") + " " + (pm.nameAr || "")).toLowerCase();
        return interaction.matchB.some(kw => id.indexOf(kw) >= 0 || name.indexOf(kw) >= 0);
      });
      if (matchAFound && matchBFound) {
        const key = interaction.matchA.join(",") + "|" + interaction.matchB.join(",");
        if (!seenPairs.has(key)) {
          seenPairs.add(key);
          alerts.push(interaction);
        }
      }
    });
    return alerts;
  }

  function showInteractionAlerts(alerts) {
    if (alerts.length === 0) return;
    const messages = alerts.map(a => {
      const icon = a.severity === "danger" ? "🔴" : "🟡";
      return icon + " " + a.msg;
    }).join("\n");
    alert("⚠ تنبيه تفاعل الأدوية:\n\n" + messages);
  }

  // -------- PWA install button (Android Chrome / Edge / etc.) --------
  // The browser fires `beforeinstallprompt` when it considers the
  // site installable (manifest + SW + served over HTTPS). We capture
  // the event, show the install button, and on click call prompt().
  // On iOS Safari there's no `beforeinstallprompt` — the user must
  // tap Share → Add to Home Screen manually. We detect iOS and show
  // a one-time hint explaining how to do it.
  let deferredInstallPrompt = null;

  function bindPwaInstall() {
    const btn = $("install-app-btn");
    if (!btn) return;

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      navigator.standalone === true;

    // If already installed/running as standalone, hide the button.
    if (isStandalone) {
      btn.hidden = true;
      return;
    }

    // Always show the install button on the login screen (not just
    // when the browser fires beforeinstallprompt — Chrome on desktop
    // sometimes never fires it even when the app is technically
    // installable, and we want the user to always have a way to
    // install via the button).
    btn.hidden = false;

    // Capture the event when it does fire so we can use the native
    // prompt (better UX than instructions).
    window.addEventListener("beforeinstallprompt", (e) => {
      // Prevent the mini-infobar from showing on Android Chrome
      e.preventDefault();
      deferredInstallPrompt = e;
    });

    btn.addEventListener("click", async () => {
      // iOS Safari → show instructions (no native prompt available)
      if (isIOS && !deferredInstallPrompt) {
        showIosInstallHint();
        return;
      }
      // Android/Chrome with native prompt → use it
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === "accepted") {
          flashHint("تم تثبيت التطبيق على جهازك");
        }
        deferredInstallPrompt = null;
        btn.hidden = true;
        return;
      }
      // No native prompt available (desktop Chrome without
      // engagement, Firefox, etc.) → show generic browser-menu
      // instructions.
      showGenericInstallHint();
    });

    // Once installed, hide the button for good.
    window.addEventListener("appinstalled", () => {
      btn.hidden = true;
      flashHint("تم تثبيت التطبيق بنجاح");
    });
  }

  function showGenericInstallHint() {
    // Generic instructions for browsers without a native prompt.
    const isChrome = /Chrome/.test(navigator.userAgent) && !/Edg|OPR/.test(navigator.userAgent);
    const isEdge   = /Edg/.test(navigator.userAgent);
    const isFirefox = /Firefox/.test(navigator.userAgent);

    let browserName = "متصفحك";
    let steps = "";
    if (isChrome) {
      browserName = "Google Chrome";
      steps = "1) افتح قائمة Chrome (⋮ في أعلى اليمين)\n2) اختر \"تثبيت التطبيق\" أو \"Install app\"\n3) اضغط \"تثبيت\"";
    } else if (isEdge) {
      browserName = "Microsoft Edge";
      steps = "1) افتح قائمة Edge (⋯ في أعلى اليمين)\n2) اختر \"التطبيقات\" → \"تثبيت هذا الموقع كتطبيق\"\n3) اضغط \"تثبيت\"";
    } else if (isFirefox) {
      browserName = "Firefox";
      steps = "1) لا يدعم Firefox تثبيت PWA رسميًا\n2) يمكنك إضافة اختصار للصفحة الرئيسية بدلاً من ذلك";
    } else {
      steps = "ابحث في قائمة المتصفح عن خيار \"تثبيت التطبيق\" أو \"Install app\"";
    }
    alert(
      "لتثبيت التطبيق عبر " + browserName + ":\n\n" + steps + "\n\n" +
      "ملاحظة: يجب فتح الموقع عبر HTTPS حتى يتوفر خيار التثبيت."
    );
  }

  function showIosInstallHint() {
    // Lightweight instructions for iOS Safari (no native prompt).
    confirm(
      "لتثبيت التطبيق على iPhone/iPad:\n\n" +
      "1) افتح هذا الرابط في متصفح Safari\n" +
      "2) اضغط زر المشاركة (المربع مع السهم لأعلى)\n" +
      "3) اختر \"إضافة إلى الشاشة الرئيسية\"\n" +
      "4) اضغط \"إضافة\"\n\n" +
      "هل تريد إغلاق هذه الرسالة؟"
    );
  }

  // -------- Event wiring --------
  function bindEvents() {
    // Room/bed tap (event delegation on rooms grid)
    $("rooms-grid").addEventListener("click", (e) => {
      const btn = e.target.closest(".bed-btn");
      if (!btn) return;
      openPatient({
        key:    btn.dataset.key,
        roomId: parseInt(btn.dataset.roomId, 10),
        bed:    parseInt(btn.dataset.bed, 10)
      });
    });

    // Patients list tap
    $("patients-list").addEventListener("click", (e) => {
      const row = e.target.closest(".patient-row");
      if (!row) return;
      openPatient({
        key:    row.dataset.key,
        roomId: parseInt(row.dataset.roomId, 10),
        bed:    parseInt(row.dataset.bed, 10)
      });
    });

    // Patient name input — save on blur, debounced
    // Patient name input — save ONLY on blur (not debounced during typing).
    // The user specifically requested: "do not sync the patient name +
    // info until the user leaves the patient page." This means:
    //   - While typing the name → update local state.patients[key].name
    //     only (no Storage save, no Supabase push)
    //   - On blur → save to Storage + push to Supabase (this is the
    //     existing blur handler below which also fires pushNotification)
    let nameTimer = null;
    $("patient-name-input").addEventListener("input", (e) => {
      if (!state.currentBed) return;
      const p = ensurePatient(state.currentBed.key);
      p.name = e.target.value;
      // NOTE: We intentionally do NOT call persistPatient() here.
      // The name + info sync happens only on blur (when the user
      // leaves the patient page). This prevents the app from
      // pushing half-typed names to Supabase every 400ms, which
      // was causing cross-device sync noise + triggering
      // unnecessary Realtime updates on the pharmacist's device.
      // Live-update the previous-admission banner as the user types a
      // name. This way if they're entering a returning patient, the
      // banner appears immediately (without waiting for blur).
      renderPreviousAdmissionBanner(p);
    });

    // Plate number input (optional) — save ONLY on blur (not debounced
    // during typing). Same reasoning as the name input: don't sync
    // patient info to Supabase until the user leaves the field/page.
    let plateTimer = null;
    $("patient-plate-input").addEventListener("input", (e) => {
      if (!state.currentBed) return;
      const p = ensurePatient(state.currentBed.key);
      p.plateNumber = e.target.value;
      // NOTE: No persistPatient() on input — only on blur.
    });
    $("patient-plate-input").addEventListener("blur", () => {
      if (!state.currentBed) return;
      clearTimeout(plateTimer);
      persistPatient(state.currentBed.key);
    });

    // Age (العمر) — numeric input. Saved ONLY on blur. Validated to
    // digits-only and capped at 3 chars (oldest human age possible).
    let ageTimer = null;
    $("patient-age-input").addEventListener("input", (e) => {
      if (!state.currentBed) return;
      const p = ensurePatient(state.currentBed.key);
      // Strip non-digits — keeps the field clean even if the user
      // pastes a value like "45 years".
      const cleaned = (e.target.value || "").replace(/\D/g, "").slice(0, 3);
      if (e.target.value !== cleaned) e.target.value = cleaned;
      p.age = cleaned;
      // NOTE: No persistPatient() on input — only on blur.
      // Recompute GFR immediately for instant visual feedback (no
      // Supabase push, just local UI update).
      renderGFRCard();
    });
    $("patient-age-input").addEventListener("blur", () => {
      if (!state.currentBed) return;
      clearTimeout(ageTimer);
      persistPatient(state.currentBed.key);
      renderGFRCard();
    });

    // Gender (الجنس) — segmented toggle with two buttons (ذكر / أنثى).
    // Clicking a button sets patient.gender to that value; clicking the
    // already-active button deselects it (sets gender to "" — unknown).
    // The CSS uses .is-active to render the selected state.
    const maleBtn = $("patient-gender-male");
    const femaleBtn = $("patient-gender-female");
    function setGenderState(p, btn) {
      const isMale = btn === maleBtn;
      const value = isMale ? "male" : "female";
      if (!p) return;
      if (p.gender === value) {
        // Toggle off — clicking the active button clears the selection.
        p.gender = "";
      } else {
        p.gender = value;
      }
      // NOTE: We intentionally do NOT call persistPatient() here.
      // The gender is saved to Supabase only when the user leaves
      // the patient page (via the blur handlers on the other
      // patient-info fields, OR when the user navigates away from
      // the patient view). This matches the user's request: "do
      // not sync patient info until the user leaves the page."
      //
      // We DO update the local UI immediately so the toggle visual
      // + GFR card reflect the new gender.
      syncGenderButtons(p.gender);
      // Recompute GFR (gender is one of the three required inputs).
      renderGFRCard();
    }
    function syncGenderButtons(gender) {
      if (maleBtn) {
        maleBtn.classList.toggle("is-active", gender === "male");
        maleBtn.setAttribute("aria-pressed", gender === "male" ? "true" : "false");
      }
      if (femaleBtn) {
        femaleBtn.classList.toggle("is-active", gender === "female");
        femaleBtn.setAttribute("aria-pressed", gender === "female" ? "true" : "false");
      }
    }
    if (maleBtn) maleBtn.addEventListener("click", () => {
      if (!state.currentBed) return;
      const p = ensurePatient(state.currentBed.key);
      setGenderState(p, maleBtn);
    });
    if (femaleBtn) femaleBtn.addEventListener("click", () => {
      if (!state.currentBed) return;
      const p = ensurePatient(state.currentBed.key);
      setGenderState(p, femaleBtn);
    });
    // Expose so renderPatientView in ui.js can sync the buttons when
    // a patient is loaded (the function is called from ui.js).
    global._syncGenderButtons = syncGenderButtons;

    // Doctor (الطبيب المعالج) — free-text field. Each patient has ONE
    // attending physician (the specialist who manages the patient's
    // care — not the doctor using the app, who may be a resident
    // covering the ward). The attending physician is shown on the bed
    // buttons in the rooms grid + on the printed patient sheet.
    // Saved ONLY on blur (not debounced during typing) — same as the
    // other patient info fields.
    let doctorTimer = null;
    $("patient-doctor-input").addEventListener("input", (e) => {
      if (!state.currentBed) return;
      const p = ensurePatient(state.currentBed.key);
      p.doctor = e.target.value;
      // NOTE: No persistPatient() on input — only on blur.
    });
    $("patient-doctor-input").addEventListener("blur", () => {
      if (!state.currentBed) return;
      clearTimeout(doctorTimer);
      persistPatient(state.currentBed.key);
    });

    // Diagnosis (التشخيص) — free-text field, editable by doctors +
    // admins only. Pharmacists can see it (display-only). Stored on
    // the patient record and shown on bed buttons + patient sheets +
    // the ABX monitoring table.
    // Saved ONLY on blur — same as the other patient info fields.
    let diagnosisTimer = null;
    $("patient-diagnosis-input").addEventListener("input", (e) => {
      if (!state.currentBed) return;
      const p = ensurePatient(state.currentBed.key);
      p.diagnosis = e.target.value;
      // NOTE: No persistPatient() on input — only on blur.
    });
    $("patient-diagnosis-input").addEventListener("blur", () => {
      if (!state.currentBed) return;
      clearTimeout(diagnosisTimer);
      persistPatient(state.currentBed.key);
    });

    // Lab values — 9 fields. Each field has an input + a "+" button.
    // The input stores the current (latest) value in p.labs[key].
    // The "+" button archives the current value into p.labHistory
    // (array of {date, key, label, value}) and clears the input for
    // a new entry. Editable by doctors + admins only (like diagnosis).
    const LAB_KEYS = ["creatinine","albumin","wbc","hb","plt","na","k","glucose","crp"];
    const LAB_LABELS = {
      creatinine:"S. Creatinine", albumin:"S. Albumin", wbc:"WBC",
      hb:"Hb", plt:"PLT", na:"Na+", k:"K+", glucose:"Glucose", crp:"CRP"
    };
    let labTimer = null;

    // Delegated click handler for "+" buttons
    document.addEventListener("click", (e) => {
      const addBtn = e.target.closest(".lab-add-btn");
      if (!addBtn || !state.currentBed) return;
      const key = addBtn.dataset.labKey;
      const label = addBtn.dataset.labLabel;
      const p = ensurePatient(state.currentBed.key);
      if (!p) return;
      // Archive the current value (if not empty)
      const currentVal = p.labs && p.labs[key] ? String(p.labs[key]).trim() : "";
      if (currentVal) {
        if (!p.labHistory) p.labHistory = [];
        p.labHistory.push({
          date: new Date().toISOString().slice(0, 10),
          key: key,
          label: label,
          value: currentVal
        });
      }
      // Clear the current value (new entry starts fresh)
      if (!p.labs) p.labs = {};
      p.labs[key] = "";
      // Clear the input visually
      const inputId = "lab-" + (key === "crp" ? "cr" : key);
      const inputEl = $(inputId);
      if (inputEl) inputEl.value = "";
      clearTimeout(labTimer);
      persistPatient(state.currentBed.key);
      // Re-render to show updated history
      const p2 = state.patients[state.currentBed.key] || null;
      UI.renderPatientView(p2, state.currentBed.roomId, state.currentBed.bed);
      flashHint(`تمت أرشفة ${label} — أدخل القيمة الجديدة`);
      // If we archived creatinine, refresh GFR (the current value
      // is now empty, so the card will hide itself automatically).
      if (key === "creatinine") {
        renderGFRCard();
      }
    });

    // Delegated input handler for lab fields
    document.addEventListener("input", (e) => {
      const target = e.target;
      if (!target || !target.classList || !target.classList.contains("lab-input")) return;
      if (!state.currentBed) return;
      // Extract lab key from the input id (lab-creatinine → creatinine)
      const idMatch = (target.id || "").match(/^lab-(.+)$/);
      if (!idMatch) return;
      const idPart = idMatch[1];
      // Reverse map: cr → crp
      const keyMap = { cr: "crp", creatinine:"creatinine", albumin:"albumin",
        wbc:"wbc", hb:"hb", plt:"plt", na:"na", k:"k", glucose:"glucose" };
      const key = keyMap[idPart] || idPart;
      const p = ensurePatient(state.currentBed.key);
      if (!p.labs) p.labs = {};
      p.labs[key] = target.value;
      // NOTE: No persistPatient() on input — only on blur of the lab
      // field OR when the user leaves the patient page (flushPending
      // PatientChanges is called from openPatient + the back button).
      // If the changed lab is S. Creatinine, refresh the GFR card
      // (creatinine is one of the three required inputs).
      if (key === "creatinine") {
        renderGFRCard();
      }
    });
    // Lab inputs also persist on blur (so the user can edit + tab
    // to the next field without losing changes).
    document.addEventListener("blur", (e) => {
      const target = e.target;
      if (!target || !target.classList || !target.classList.contains("lab-input")) return;
      if (!state.currentBed) return;
      clearTimeout(labTimer);
      persistPatient(state.currentBed.key);
      // Refresh GFR after blur (in case the user edited creatinine).
      renderGFRCard();
    }, true);  // useCapture=true so we catch blur on the lab inputs
    $("patient-name-input").addEventListener("blur", () => {
      if (!state.currentBed) return;
      clearTimeout(nameTimer);
      // collapse empty-name patient (no name and no meds)
      const p = state.patients[state.currentBed.key];
      if (p && (!p.name || !p.name.trim()) && (!p.medications || p.medications.length === 0)) {
        const bedKey = state.currentBed.key;
        Storage.deletePatient(bedKey);
        Storage.saveLocalDeletion(bedKey);
        delete state.patients[bedKey];
        if (SBSync && SBSync.pushPatientDelete) {
          SBSync.pushPatientDelete(bedKey).then(r => {
            if (!r.ok) console.warn("[Supabase] auto-collapse delete failed:", r.error);
          });
        }
      } else {
        persistPatient(state.currentBed.key);
        // Notify pharmacist if a doctor just named/added a new patient
        if (p && p.name && p.name.trim()) {
          const roomStr = `غرفة ${state.currentBed.roomId}`;
          pushNotification("patient_added",
            `إضافة مريض: ${p.name.trim()} — ${roomStr}`,
            p.name.trim(), roomStr);
        }
      }
      refreshStatsAndRooms();
    });

    // Back button — flush any pending patient info changes (e.g.
    // gender toggle, GFR, lab values) to Storage + Supabase BEFORE
    // leaving the patient page. This ensures changes made via
    // click-based controls (gender buttons) — which don't fire blur
    // events — are still persisted when the user navigates away.
    $("back-btn").addEventListener("click", () => {
      flushPendingPatientChanges();
      state.currentBed = null;
      UI.showView("home");
    });

    // Open sheet (in patient view) — single binding
    $("open-med-sheet").addEventListener("click", openSheetFromPatientView);

    // Print patient sheet (A4) — opens a new window with a printable
    // patient sheet: doctor name + patient name + room + date at the
    // top, medications list on the left, vital signs grid on the right.
    // Designed for doctors to print and put at the patient's bedside.
    $("print-patient-sheet-btn").addEventListener("click", () => {
      if (!state.currentBed) return;
      const p = state.patients[state.currentBed.key] || null;
      if (!p || !p.name || !p.name.trim()) {
        flashHint("أضف اسم المريض أولاً");
        return;
      }
      printPatientSheet(p, state.currentBed);
    });

    // Meds list — delete & edit (event delegation)
    $("meds-list").addEventListener("click", (e) => {
      const del = e.target.closest('[data-action="delete-med"]');
      if (!del || !state.currentBed) return;
      const idx = parseInt(del.dataset.medIndex, 10);
      const p = state.patients[state.currentBed.key];
      if (!p || !Array.isArray(p.medications)) return;
      const removedMed = p.medications[idx];
      const removedName = removedMed && (removedMed.nameTrade || removedMed.nameAr || removedMed.id) || "(دواء)";
      p.medications.splice(idx, 1);
      // Audit log — record the med-delete action
      if (Auth && Auth.auditLog) {
        const roomBed = state.currentBed.key.replace("room-", "غرفة ").replace("-bed-", " · سرير ");
        Auth.auditLog("med_deleted",
          `حذف دواء "${removedName}" من المريض "${p.name || "(بدون اسم)"}" في ${roomBed}`);
      }
      // Note: the 5cc Syringe is now injected at print-time only
      // (in ui.js buildChartReport), not stored on the patient. So
      // we don't need to recompute anything when a med is deleted.
      persistPatient(state.currentBed.key);
      refreshPatientViewOnly();
      pushNotification("med_changed",
        `حذف دواء "${removedName}" من ${p.name || "(بدون اسم)"} — غرفة ${state.currentBed.roomId}`,
        p.name || "", `غرفة ${state.currentBed.roomId}`);
    });
    $("meds-list").addEventListener("input", (e) => {
      const t = e.target;
      if (!t.dataset.medIndex) return;
      if (!state.currentBed) return;
      const p = state.patients[state.currentBed.key];
      if (!p || !Array.isArray(p.medications)) return;
      const idx = parseInt(t.dataset.medIndex, 10);
      if (t.dataset.field === "dose") {
        p.medications[idx].dose = t.value;
      } else if (t.dataset.field === "frequency") {
        p.medications[idx].frequency = t.value;
      }
      clearTimeout(p._saveTimer);
      p._saveTimer = setTimeout(() => {
        // Note: the 5cc Syringe is now print-time only, so we don't
        // recompute anything when the user edits a med.
        persistPatient(state.currentBed.key);
        refreshPatientViewOnly();
      }, 400);
    });
    $("meds-list").addEventListener("change", (e) => {
      const t = e.target;
      if (!t.dataset.medIndex || t.dataset.field !== "frequency") return;
      if (!state.currentBed) return;
      const p = state.patients[state.currentBed.key];
      if (!p || !Array.isArray(p.medications)) return;
      const idx = parseInt(t.dataset.medIndex, 10);
      p.medications[idx].frequency = t.value;
      persistPatient(state.currentBed.key);
      refreshPatientViewOnly();
    });

    // Delete patient
    $("delete-patient").addEventListener("click", () => {
      if (!state.currentBed) return;
      const p = state.patients[state.currentBed.key];
      const name = p && p.name ? p.name : "";
      const msg = name
        ? `هل تريد تفريغ السرير وحذف المريض "${name}"؟`
        : "هل تريد تفريغ هذا السرير؟";
      if (!confirm(msg)) return;
      const bedKey = state.currentBed.key;
      // Audit log — record the sensitive delete action
      if (Auth && Auth.auditLog) {
        const roomBed = bedKey.replace("room-", "غرفة ").replace("-bed-", " · سرير ");
        Auth.auditLog("patient_deleted",
          `حذف المريض "${name}" من ${roomBed}`);
      }
      Storage.deletePatient(bedKey);
      Storage.saveLocalDeletion(bedKey);
      delete state.patients[bedKey];
      state.currentBed = null;
      refreshStatsAndRooms();
      UI.showView("home");
      // Sync the single deleted bed to Supabase (don't bulk-delete)
      if (SBSync && SBSync.pushPatientDelete) {
        SBSync.pushPatientDelete(bedKey).then(r => {
          if (!r.ok) console.warn("[Supabase] patient delete push failed:", r.error);
        });
      }
    });

    // ----- Discharge patient (خروج) -----
    // Opens a modal that REQUIRES the user to enter a final diagnosis
    // before the patient can be discharged. The final diagnosis is
    // stored on the discharged record (Storage.addDischarged) so it
    // can be retrieved if the patient is readmitted later.
    //
    // Old behavior used a plain confirm() dialog. We now use a custom
    // modal because:
    //   1. The final diagnosis is required (can't skip)
    //   2. We want to show the patient's existing diagnosis (if any)
    //      as a reference so the doctor can compare / copy it
    //   3. A modal gives more space for the textarea input
    let _dischargePending = null;  // holds {bedKey, patient, record}
    function openDischargeModal() {
      if (!state.currentBed) return;
      const p = state.patients[state.currentBed.key];
      if (!p || !p.name || !p.name.trim()) return;

      _dischargePending = {
        bedKey: state.currentBed.key,
        patient: p,
        roomId: state.currentBed.roomId,
        bed: state.currentBed.bed
      };

      // Show the modal
      const overlay = $("discharge-overlay");
      const modal = $("discharge-modal");
      if (overlay) overlay.hidden = false;
      if (modal) modal.hidden = false;

      // Fill in the patient name + diagnosis-at-admission reference
      const nameEl = $("discharge-patient-name");
      if (nameEl) nameEl.textContent = p.name.trim();

      const prevEl = $("discharge-previous-diagnosis");
      const prevValEl = $("discharge-previous-value");
      if (p.diagnosis && String(p.diagnosis).trim()) {
        if (prevValEl) prevValEl.textContent = String(p.diagnosis);
        if (prevEl) prevEl.hidden = false;
      } else {
        if (prevEl) prevEl.hidden = true;
      }

      // Clear the textarea + error
      const inputEl = $("discharge-final-diagnosis");
      if (inputEl) {
        inputEl.value = "";
        // Pre-fill with the admission diagnosis as a starting point
        // so the doctor can just append "resolved" or similar.
        // The user can clear it if they want.
        if (p.diagnosis && String(p.diagnosis).trim()) {
          inputEl.value = String(p.diagnosis);
          inputEl.select();
        }
        setTimeout(() => inputEl && inputEl.focus(), 50);
      }
      const errEl = $("discharge-error");
      if (errEl) errEl.hidden = true;
    }

    function closeDischargeModal() {
      const overlay = $("discharge-overlay");
      const modal = $("discharge-modal");
      if (overlay) overlay.hidden = true;
      if (modal) modal.hidden = true;
      _dischargePending = null;
    }

    function confirmDischarge() {
      if (!_dischargePending) return;
      const inputEl = $("discharge-final-diagnosis");
      const errEl = $("discharge-error");
      const finalDiagnosis = (inputEl && inputEl.value || "").trim();
      if (!finalDiagnosis) {
        if (errEl) errEl.hidden = false;
        if (inputEl) inputEl.focus();
        return;
      }
      const { bedKey, patient: p, roomId, bed } = _dischargePending;
      const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
      const record = {
        name:            p.name.trim(),
        plateNumber:     p.plateNumber || "",
        doctor:          p.doctor || "",
        age:             p.age || "",
        gender:          p.gender || "",
        diagnosis:       p.diagnosis || "",           // diagnosis at admission
        finalDiagnosis:  finalDiagnosis,             // diagnosis at discharge (NEW — required)
        medications:     Array.isArray(p.medications) ? p.medications : [],
        roomNumber:      roomId,
        bedNumber:       bed,
        dischargedAt:    new Date().toISOString(),
        dischargedBy:    user ? user.username : "—"
      };
      Storage.addDischarged(record);
      // Audit log
      if (Auth && Auth.auditLog) {
        Auth.auditLog("patient_discharged",
          `خروج المريض "${p.name}" من غرفة ${roomId} سرير ${bed} — تشخيص نهائي: ${finalDiagnosis}`);
      }
      // Free the bed
      Storage.deletePatient(bedKey);
      Storage.saveLocalDeletion(bedKey);
      delete state.patients[bedKey];
      state.currentBed = null;
      refreshStatsAndRooms();
      UI.showView("home");
      if (SBSync && SBSync.pushPatientDelete) {
        SBSync.pushPatientDelete(bedKey).then(r => {
          if (!r.ok) console.warn("[Supabase] discharge delete push failed:", r.error);
        });
      }
      flashHint("تم تسجيل خروج المريض — بياناته محفوظة في قائمة «خرجوا»");
      pushNotification("patient_discharged",
        `خروج المريض: ${p.name.trim()} — غرفة ${roomId}`,
        p.name.trim(), `غرفة ${roomId}`);
      closeDischargeModal();
    }

    // Discharge button → open modal (instead of confirm)
    $("discharge-patient-btn").addEventListener("click", openDischargeModal);
    // Modal close buttons
    $("discharge-close").addEventListener("click", closeDischargeModal);
    $("discharge-cancel").addEventListener("click", closeDischargeModal);
    $("discharge-overlay").addEventListener("click", closeDischargeModal);
    $("discharge-confirm").addEventListener("click", confirmDischarge);
    // Allow Enter (without Shift) inside the textarea to confirm
    $("discharge-final-diagnosis").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        confirmDischarge();
      }
    });

    // ----- Died patient (وفاة) -----
    // Moves the patient to the "dead" list (preserving their data +
    // death timestamp) then frees the bed.
    $("died-patient-btn").addEventListener("click", () => {
      if (!state.currentBed) return;
      const p = state.patients[state.currentBed.key];
      if (!p || !p.name || !p.name.trim()) return;
      if (!confirm(`هل تريد تسجيل وفاة المريض "${p.name}"؟\nستُحفظ بياناته في قائمة "وفيات".`)) return;
      const bedKey = state.currentBed.key;
      const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
      const record = {
        name:        p.name.trim(),
        plateNumber: p.plateNumber || "",
        doctor:      p.doctor || "",
        medications: Array.isArray(p.medications) ? p.medications : [],
        roomNumber:  state.currentBed.roomId,
        bedNumber:   state.currentBed.bed,
        diedAt:      new Date().toISOString(),
        recordedBy:  user ? user.username : "—"
      };
      Storage.addDead(record);
      if (Auth && Auth.auditLog) {
        Auth.auditLog("patient_died",
          `وفاة المريض "${p.name}" من غرفة ${state.currentBed.roomId} سرير ${state.currentBed.bed}`);
      }
      Storage.deletePatient(bedKey);
      Storage.saveLocalDeletion(bedKey);
      delete state.patients[bedKey];
      state.currentBed = null;
      refreshStatsAndRooms();
      UI.showView("home");
      if (SBSync && SBSync.pushPatientDelete) {
        SBSync.pushPatientDelete(bedKey).then(r => {
          if (!r.ok) console.warn("[Supabase] died delete push failed:", r.error);
        });
      }
      flashHint("تم تسجيل الوفاة — بيانات المريض محفوظة في قائمة «وفيات»");
      pushNotification("patient_died",
        `وفاة المريض: ${p.name.trim()} — غرفة ${state.currentBed.roomId}`,
        p.name.trim(), `غرفة ${state.currentBed.roomId}`);
    });

    // ----- Discharged list (now in settings) -----
    $("settings-discharged-btn").addEventListener("click", () => {
      renderDischargedView();
      UI.showView("discharged");
    });
    // Admin also has a 'view discharged' button in the admin view
    // (admins don't see the settings view because the gear routes
    // them to openAdminView instead).
    const adminDischargedBtn = $("admin-discharged-btn");
    if (adminDischargedBtn) {
      adminDischargedBtn.addEventListener("click", () => {
        renderDischargedView();
        UI.showView("discharged");
      });
    }

    // ----- Discharged view back button -----
    $("discharged-back-btn").addEventListener("click", () => {
      UI.showView("home");
    });

    // ----- Discharged view tabs -----
    document.querySelectorAll(".discharged-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".discharged-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        _dischargedTab = tab.dataset.tab;
        renderDischargedView();
      });
    });

    // Admin-only: clear ALL records in the active tab
    $("discharged-clear-all-btn").addEventListener("click", () => {
      const msg = _dischargedTab === "dead"
        ? "هل تريد حذف جميع سجلات الوفيات؟ لا يمكن التراجع."
        : "هل تريد حذف جميع سجلات المرضى الخارجين؟ لا يمكن التراجع.";
      if (!confirm(msg)) return;
      if (_dischargedTab === "dead") {
        Storage.clearDead();
      } else {
        Storage.clearDischarged();
      }
      renderDischargedView();
      flashHint("تم مسح القائمة بالكامل");
    });

    // ----- ABX back button (abx-monitor-btn now in settings) -----
    $("abx-back-btn").addEventListener("click", () => {
      UI.showView("home");
    });

    // Save monthly ABX snapshot — saves the current ABX + albumin data
    // INSIDE the app (localStorage), not as a PDF. Doctors, pharmacists,
    // and admins can all view the saved snapshots later.
    $("abx-save-monthly-btn").addEventListener("click", () => {
      const now = new Date();
      const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const monthLabel = now.toLocaleDateString("ar", { year: "numeric", month: "long" });
      const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;

      // Capture the current ABX entries (reuse the renderAbxMonitor
      // data by re-scanning patients)
      const Ward = global.PharmacyWard;
      const abxEntries = [];
      const albEntries = [];
      if (Ward) {
        Ward.ROOMS.forEach(room => {
          room.beds.forEach(bed => {
            const key = Ward.bedKey(room.id, bed.number);
            const p = state.patients[key];
            if (!p || !p.name || !p.name.trim()) return;
            (p.medications || []).forEach(pm => {
              if (!pm || !pm.id) return;
              const catalog = (state.medications || []).find(m => m && m.id === pm.id);
              const medName = catalog ? (catalog.nameEn || catalog.nameTrade) : (pm.nameEn || pm.nameTrade || pm.id);
              const dose = pm.dose || (catalog ? catalog.defaultDose : "") || "";
              const freq = pm.frequency || (catalog ? catalog.defaultFrequency : "") || "";
              // Day label
              let day = "";
              if (p.firstMedDate) {
                const diff = now.setHours(0,0,0,0) - new Date(p.firstMedDate).setHours(0,0,0,0);
                day = "D" + Math.max(1, Math.floor(diff / 86400000) + 1);
              }
              const entry = {
                name: p.name.trim(),
                room: room.id,
                bed: bed.number,
                plate: p.plateNumber || "",
                diagnosis: p.diagnosis || "",
                day: day,
                medName, dose, freq
              };
              if (ANTIBIOTIC_IDS.indexOf(pm.id) !== -1) abxEntries.push(entry);
              if (ALBUMIN_IDS.indexOf(pm.id) !== -1) albEntries.push(entry);
            });
          });
        });
      }
      const totalPatients = Object.values(state.patients || {})
        .filter(p => p && p.name && p.name.trim()).length;

      const snapshot = {
        monthStr: monthStr,
        monthLabel: monthLabel,
        date: now.toISOString(),
        savedBy: user ? user.username : "—",
        abxCount: abxEntries.length,
        albCount: albEntries.length,
        totalPatients: totalPatients,
        abxEntries: abxEntries,
        albEntries: albEntries
      };
      Storage.addAbxSnapshot(snapshot);
      flashHint(`تم حفظ نسخة ${monthLabel} — ${abxEntries.length} مضاد حيوي · ${albEntries.length} ألبومين`);
    });

    // View saved ABX snapshots
    $("abx-saved-btn").addEventListener("click", () => {
      renderAbxSnapshots();
    });

    // ----- Notifications -----
    $("notifications-btn").addEventListener("click", () => {
      renderNotifications();
      UI.showView("notifications");
    });
    $("notifications-back-btn").addEventListener("click", () => {
      UI.showView("home");
    });
    $("notif-mark-all-btn").addEventListener("click", () => {
      Storage.markAllNotificationsRead();
      renderNotifications();
      updateNotifBadge();
      flashHint("تم تعليم الكل كمقروء");
    });
    // Admin-only: clear ALL notifications
    $("notif-clear-all-btn").addEventListener("click", () => {
      if (!confirm("هل تريد حذف جميع الإشعارات؟")) return;
      Storage.clearNotifications();
      renderNotifications();
      updateNotifBadge();
      flashHint("تم حذف جميع الإشعارات");
    });

    // ----- Bottom navigation -----
    $("bottom-nav").addEventListener("click", (e) => {
      const item = e.target.closest(".nav-item");
      if (!item) return;
      const nav = item.dataset.nav;
      if (nav === "home") {
        state.currentBed = null;
        UI.showView("home");
      } else if (nav === "patients") {
        UI.showView("patients");
        UI.renderPatientsList(state.patients);
      } else if (nav === "seniors") {
        renderSeniorsView();
        UI.showView("seniors");
      }
    });

    // ----- Bottom sheet -----
    $("sheet-close").addEventListener("click", closeSheet);
    $("sheet-cancel").addEventListener("click", closeSheet);
    $("sheet-overlay").addEventListener("click", closeSheet);

    // Search in sheet
    let searchTimer = null;
    $("med-search").addEventListener("input", (e) => {
      state.sheet.filter = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        UI.renderMedOptions(state.medications, state.sheet.selected, state.sheet.filter, state.sheet.activeTab);
        bindMedOptionCheckboxes();
      }, 100);
    });

    // Tab clicks — switch the active form, keep the search query.
    // Tab keys are now any of: vial, ampule, prefilled-syringe, tablet, supplies.
    $("sheet-tabs").addEventListener("click", (e) => {
      const tab = e.target.closest(".sheet-tab");
      if (!tab) return;
      const newTab = tab.dataset.tab;
      if (state.sheet.activeTab === newTab) return; // no change
      state.sheet.activeTab = newTab;
      UI.setActiveTabUI(newTab);
      UI.renderMedOptions(state.medications, state.sheet.selected, state.sheet.filter, newTab);
      bindMedOptionCheckboxes();
    });

    // Med option checkboxes (delegated)
    $("med-options").addEventListener("change", (e) => {
      const cb = e.target.closest('input[type="checkbox"]');
      if (!cb) return;
      const id = cb.dataset.medId;
      if (cb.checked) addToSelected(id);
      else removeFromSelected(id);
      UI.renderMedOptions(state.medications, state.sheet.selected, state.sheet.filter, state.sheet.activeTab);
      bindMedOptionCheckboxes();
      syncSelectedUI();
    });

    // Selected list interactions (delegated)
    // - ✕ button (delete-selected) → removes the med from the selected list
    // - "+" button (freq-increment) → freq increases by 1 (max 12)
    // - "−" button (freq-decrement) → freq decreases by 1 (min 1)
    // For custom freqs ("حسب القياس"), tapping + or - switches to numeric:
    //   "+" → 1×1, "−" → 1×1 (can't be 1×0).
    // Dose stays unchanged; only the frequency changes.
    $("selected-list").addEventListener("click", (e) => {
      const del = e.target.closest('[data-action="del-selected"]');
      if (del) {
        const idx = parseInt(del.dataset.selIndex, 10);
        const item = state.sheet.selectedList[idx];
        if (!item) return;
        state.sheet.selected.delete(item.id);
        state.sheet.selectedList.splice(idx, 1);
        UI.renderMedOptions(state.medications, state.sheet.selected, state.sheet.filter, state.sheet.activeTab);
        bindMedOptionCheckboxes();
        syncSelectedUI();
        return;
      }

      const incBtn = e.target.closest('[data-action="freq-increment"]');
      const decBtn = e.target.closest('[data-action="freq-decrement"]');
      if (!incBtn && !decBtn) return;

      const selItem = (incBtn || decBtn).closest(".sel-item");
      if (!selItem) return;
      const idx = parseInt(selItem.dataset.selIndex, 10);
      const item = state.sheet.selectedList[idx];
      if (!item) return;

      const MAX = 12;
      const MIN = 1;
      let currentCount = (function () {
        const m = (item.frequency || "").match(/×\s*(\d+)/);
        return m ? parseInt(m[1], 10) : -1; // -1 = custom/non-numeric
      })();
      // Extract the dose multiplier (the N in "N×M")
      let currentMult = (function () {
        const m = (item.frequency || "").match(/(\d+)\s*×/);
        return m ? parseInt(m[1], 10) : 1; // default 1
      })();

      let newCount;
      if (currentCount === -1) {
        // Was custom: switching to numeric starts at 1×1
        newCount = 1;
        currentMult = 1;
      } else if (incBtn) {
        // Shift+click increments the multiplier (1→2→3)
        if (e.shiftKey) {
          currentMult = Math.min(6, currentMult + 1);
        } else {
          newCount = Math.min(MAX, currentCount + 1);
        }
      } else {
        // Shift+click decrements the multiplier (3→2→1)
        if (e.shiftKey) {
          currentMult = Math.max(1, currentMult - 1);
        } else {
          newCount = Math.max(MIN, currentCount - 1);
        }
      }
      if (newCount === undefined) newCount = currentCount;
      item.frequency = `${currentMult}×${newCount}`;
      syncSelectedUI();
    });

    // Add selected to patient
    $("sheet-add").addEventListener("click", () => {
      if (!state.currentBed) return;
      if (state.sheet.selectedList.length === 0) return;
      const p = ensurePatient(state.currentBed.key);
      const wasNew = !p.name || !p.name.trim();

      // 1) Add the user-selected meds to the patient
      state.sheet.selectedList.forEach(s => {
        p.medications.push({
          id:        s.id,
          nameTrade: s.nameTrade,
          nameAr:    s.nameAr,
          nameEn:    s.nameEn,
          form:      s.form || "vial",
          dose:      s.dose,
          frequency: s.frequency
        });
      });
      const userAddedCount = state.sheet.selectedList.length;

      // Audit log — record the med-add action
      if (Auth && Auth.auditLog) {
        const medNames = state.sheet.selectedList.map(s => s.nameTrade || s.nameAr || s.id).join("، ");
        const roomBed = state.currentBed.key.replace("room-", "غرفة ").replace("-bed-", " · سرير ");
        Auth.auditLog("med_added",
          `إضافة ${userAddedCount} دواء (${medNames}) للمريض "${p.name || "(بدون اسم)"}" في ${roomBed}`);
      }

      // 2) Note: the 5cc Syringe is now injected at print-time only
      //    (in ui.js buildChartReport), not stored on the patient.
      //    No recompute needed here.

      persistPatient(state.currentBed.key);
      closeSheet();
      flashHint("تمت إضافة " + userAddedCount + " علاج");
      // Notify pharmacist of new prescription by doctor
      const medNames = state.sheet.selectedList.map(s => s.nameTrade || s.nameAr || s.id).join("، ");
      pushNotification("med_changed",
        `إضافة ${userAddedCount} دواء (${medNames}) لـ ${p.name || "(بدون اسم)"} — غرفة ${state.currentBed.roomId}`,
        p.name || "", `غرفة ${state.currentBed.roomId}`);
      // Check for drug interactions after adding the new meds
      const alerts = checkDrugInteractions(p.medications);
      if (alerts.length > 0) showInteractionAlerts(alerts);
      // Return to rooms view immediately so the pharmacist can move to
      // the next patient without an extra tap on the back button.
      state.currentBed = null;
      UI.showView("home");
    });

    // ----- Settings/Admin: open via header gear -----
    // The gear ⚙ button opens a different view depending on the user's
    // role:
    //   - admin  → full admin view (med catalog + users + audit log)
    //   - pharmacist → simple settings view (dark mode + TV + logout)
    $("open-admin").addEventListener("click", () => {
      const isAdmin = Auth && Auth.isAdmin();
      if (isAdmin) {
        openAdminView();
      } else {
        openSettingsView();
      }
    });

    // ----- Print Chart (التشارت) -----
    // Instead of printing directly, we first open the Supply Order
    // modal where the user enters the total quantity for each supply.
    // On "submit", the supplies are distributed across patients and
    // the chart is built + printed.
    // NOTE: The actual handler is defined later in this file (after
    // the supply-order-submit handler) because it shares the modal
    // with the new "distribute-send-btn" workflow. The handler there
    // sets the modal title + submit button label + opens the modal.

    // ----- Print All Patient Sheets (طباعة كل أوراق المرضى) -----
    // Generates a multi-page PDF containing one patient sheet per
    // occupied bed (same layout as printPatientSheet, but for ALL
    // patients in one download). Available to admin + doctor only —
    // the pharmacist prints individual sheets from the patient view.
    $("print-all-sheets-btn").addEventListener("click", async () => {
      const occPatients = [];
      const Ward = global.PharmacyWard;
      Ward.ROOMS.forEach(room => {
        room.beds.forEach(bed => {
          const key = Ward.bedKey(room.id, bed.number);
          const p = state.patients[key];
          if (p && p.name && p.name.trim()) {
            occPatients.push({ patient: p, currentBed: { key, roomId: room.id, bed: bed.number } });
          }
        });
      });
      if (occPatients.length === 0) {
        flashHint("لا يوجد مرضى مشغولون");
        return;
      }
      flashHint(`يتم توليد ${occPatients.length} ورقة... انتظر قليلاً`);
      setTimeout(async () => {
        try {
          await printAllPatientSheets(occPatients);
          flashHint(`تم تنزيل ${occPatients.length} ورقة في ملف PDF موحّد`);
        } catch (err) {
          console.error("[print-all-sheets] error:", err);
          flashHint("تعذّر توليد الأوراق: " + (err.message || err));
        }
      }, 50);
    });

    // ----- Pills Form Download (تنزيل استمارة الحبوب) -----
    // Generates a downloadable PDF of pill dispensing forms for every
    // patient who has at least one medication from the "tablet" form
    // category. All patient forms are merged into a single PDF (one
    // page per patient).
    $("print-pills-form-btn").addEventListener("click", async () => {
      if (!global.PharmacyPillsForm) {
        flashHint("تعذّر تحميل وحدة استمارة الحبوب");
        return;
      }
      flashHint("يتم توليد استمارات الحبوب... انتظر قليلاً");
      // Defer so flashHint renders before the heavy canvas work
      setTimeout(async () => {
        try {
          const result = await global.PharmacyPillsForm.generateAllPatientPillsForms(state);
          if (result && result.error) {
            flashHint(result.error);
            return;
          }
          if (result && result.count) {
            if (result.mode === "pdf") {
              flashHint(`تم تنزيل ملف PDF موحّد لـ ${result.count} مريض — تحقق من التنزيلات`);
            } else {
              flashHint(`تم تنزيل ${result.count} استمارة حبوب — تحقق من التنزيلات`);
            }
          } else {
            flashHint("لم يتم توليد أي استمارة");
          }
        } catch (err) {
          console.error("[pills-form] error:", err);
          flashHint("تعذّر توليد الاستمارة: " + (err.message || err));
        }
      }, 50);
    });

    // ----- Med Summary Modal (إحصاء الأدوية — shown after chart) -----
    // After the chart is generated, show a modal list of all meds +
    // supplies with their total daily count across all patients.
    // This gives the pharmacist an at-a-glance view of what was
    // distributed, including the supplies just assigned in the
    // supply-order modal.

    function closeMedSummary() {
      const overlay = $("med-summary-overlay");
      const modal = $("med-summary-modal");
      if (overlay) overlay.hidden = true;
      if (modal) modal.hidden = true;
    }

    // Build and show the med summary modal. Includes BOTH:
    //   - Patient-prescribed meds (from patient.medications[])
    //   - Auto-injected supplies (from supplyDistribution)
    function showMedSummaryList(supplyDistribution) {
      const body = $("med-summary-body");
      const footer = $("med-summary-footer");
      const overlay = $("med-summary-overlay");
      const modal = $("med-summary-modal");
      if (!body || !overlay || !modal) return;

      const Meds = global.PharmacyMedications || {};
      const FORM_LABELS = Meds.FORM_LABELS || {};
      const FORM_ORDER = Meds.FORM_ORDER ||
        ["vial", "ampule", "prefilled-syringe", "tablet", "syrup-and-oral-drop", "suppository", "solution", "supplies"];

      // Helper: parse "1×3" → 3
      function parseFreq(freq) {
        if (!freq) return 0;
        const m = freq.match(/×\s*(\d+)/);
        if (m) return parseInt(m[1], 10);
        const n = parseInt(freq, 10);
        return !isNaN(n) && n > 0 ? n : 0;
      }

      // Helper: get display label (Arabic preferred)
      function getLabel(m) {
        if (!m) return "";
        return m.nameAr || m.nameTrade || m.nameEn || m.name || m.id || "";
      }

      // Build med-by-id lookup
      const medById = {};
      (state.medications || []).forEach(m => {
        if (m && m.id) medById[m.id] = m;
      });

      // Tally counts across all occupied patients
      const tally = {};
      const occupiedPatients = Object.values(state.patients || {})
        .filter(p => p && p.name && p.name.trim());

      occupiedPatients.forEach(p => {
        const seen = new Set();
        (p.medications || []).forEach(pm => {
          if (!pm || !pm.id) return;
          const catalog = medById[pm.id];
          if (!catalog) return;
          if (!tally[pm.id]) {
            tally[pm.id] = {
              catalog: catalog,
              total: 0,
              custom: false
            };
          }
          const freq = pm.frequency || catalog.defaultFrequency || "";
          const n = parseFreq(freq);
          if (n === 0 && freq) tally[pm.id].custom = true;
          tally[pm.id].total += n;
          if (!seen.has(pm.id)) {
            seen.add(pm.id);
          }
        });
      });

      // Inject auto-distributed supplies as additional "patients" of
      // the supplies category. supplyDistribution maps supplyId →
      // { bedKey: freq }. Sum the frequencies across all bedKeys.
      if (supplyDistribution && typeof supplyDistribution === "object") {
        Object.keys(supplyDistribution).forEach(supplyId => {
          const dist = supplyDistribution[supplyId];
          if (!dist || typeof dist !== "object") return;
          let total = 0;
          Object.values(dist).forEach(freq => { total += (freq || 0); });
          if (total === 0) return;  // supply wasn't distributed to anyone

          const catalog = medById[supplyId] || { id: supplyId, form: "supplies", nameTrade: supplyId };
          tally[supplyId] = {
            catalog: catalog,
            total: total,
            custom: false
          };
        });
      }

      // Group by form category
      const groups = {};
      FORM_ORDER.forEach(form => { groups[form] = []; });
      Object.values(tally).forEach(t => {
        const formKey = (t.catalog.form && FORM_ORDER.indexOf(t.catalog.form) !== -1)
          ? t.catalog.form : "supplies";
        if (!groups[formKey]) groups[formKey] = [];
        groups[formKey].push(t);
      });

      // Sort each group: numeric counts descending, then custom
      Object.values(groups).forEach(arr => {
        arr.sort((a, b) => {
          if (a.custom && !b.custom) return 1;
          if (!a.custom && b.custom) return -1;
          if (!a.custom && !b.custom) return b.total - a.total;
          return getLabel(a.catalog).localeCompare(getLabel(b.catalog));
        });
      });

      // Render HTML
      let html = "";
      let firstGroup = true;
      FORM_ORDER.forEach(form => {
        const arr = groups[form] || [];
        if (arr.length === 0) return;
        if (!firstGroup) html += "";
        firstGroup = false;
        const formLabel = FORM_LABELS[form] || form;
        html += `<div class="med-summary-group">`;
        html += `<div class="med-summary-group-title">`;
        html += `<span>${formLabel}</span>`;
        html += `<span class="med-summary-group-count">${arr.length} دواء</span>`;
        html += `</div>`;
        arr.forEach(t => {
          const name = getLabel(t.catalog);
          const countText = t.custom ? "—" : String(t.total);
          const countClass = t.custom ? "med-summary-row-count custom" : "med-summary-row-count";
          html += `<div class="med-summary-row">`;
          html += `<span class="med-summary-row-name">${name}</span>`;
          html += `<span class="${countClass}">${countText}</span>`;
          html += `</div>`;
        });
        html += `</div>`;
      });

      if (firstGroup) {
        // No groups at all — no patient has any medication
        html = `<div style="text-align:center;padding:40px;color:var(--text-muted);">لا يوجد أدوية موصوفة</div>`;
      }

      body.innerHTML = html;

      // Footer with totals
      const totalCount = Object.values(tally).reduce((s, t) => s + (t.custom ? 0 : t.total), 0);
      const totalMeds = Object.keys(tally).length;
      const totalPatients = occupiedPatients.length;
      footer.innerHTML = `
        <div>إجمالي التكرارات اليومية: ${totalCount}</div>
        <div>عدد الأدوية والمستلزمات: ${totalMeds}  ·  عدد المرضى: ${totalPatients}</div>
      `;

      // Show modal
      overlay.hidden = false;
      modal.hidden = false;
    }

    // Close handlers for med summary modal
    $("med-summary-close").addEventListener("click", closeMedSummary);
    $("med-summary-overlay").addEventListener("click", closeMedSummary);

    // Note: The med-summary-btn (red bar-chart icon) was removed from
    // the header. The med-summary MODAL still exists in the HTML +
    // is opened programmatically by the distribute-send-btn workflow
    // (showMedSummaryList is called inside the supply-order submit
    // handler in distribute+send mode). The close handlers above
    // remain so the user can close the modal that the distribute-send
    // workflow opened.

    // ----- Display Mode (TV / large screen) -----
    $("display-mode-btn").addEventListener("click", enterDisplayMode);

    // ----- Supply Order Modal -----
    // SUPPLY_RULES: one entry per supply that can be distributed.
    // Each has: id (catalog id), label (display), short (abbrev),
    // minFreq, maxFreq (the frequency range per patient).
    const SUPPLY_RULES = [
      { id: "dextrose-saline",  label: "G/S — Glucose Saline (ديكستروز سالين)", short: "G/S", minFreq: 2, maxFreq: 5 },
      { id: "ringers-lactate",   label: "R/L — Ringer Lactate (رينجر لاكتات)", short: "R/L", minFreq: 2, maxFreq: 5 },
      { id: "glucose-5",         label: "G/W — Glucose 5% (مغذي سكري 5%)", short: "G/W", minFreq: 2, maxFreq: 5 },
      { id: "sodium-chloride-09", label: "N/S — Normal Saline 500ml (مغذي ملح 500مل)", short: "N/S", minFreq: 2, maxFreq: 5 },
      { id: "nacl-100ml",         label: "N/S 100ml — مغذي ملح 100مل", short: "N/S 100", minFreq: 3, maxFreq: 7 },
      { id: "iv-set",             label: "I.V. Set — خط الإعطاء", short: "IV Set", minFreq: 1, maxFreq: 2 },
      { id: "blood-iv-set",       label: "Blood I.V. Set — خط إعطاء دم", short: "Blood IV", minFreq: 1, maxFreq: 2 },
      { id: "cannula",            label: "Cannula — كانيولا", short: "Cannula", minFreq: 1, maxFreq: 2 },
      { id: "syringe-5cc",        label: "5cc Syringe — سرنجة 5 سي سي", short: "5cc", minFreq: 3, maxFreq: 8 },
      { id: "syringe-1cc",        label: "1cc Syringe — سرنجة 1 سي سي", short: "1cc", minFreq: 3, maxFreq: 8 },
      { id: "syringe-10cc",       label: "10cc Syringe — سرنجة 10 سي سي", short: "10cc", minFreq: 1, maxFreq: 3 },
      { id: "syringe-20cc",       label: "20cc Syringe — سرنجة 20 سي سي", short: "20cc", minFreq: 1, maxFreq: 3 },
      { id: "syringe-50cc",       label: "50cc Syringe — سرنجة 50 سي سي", short: "50cc", minFreq: 1, maxFreq: 3 },
      { id: "urine-bag",          label: "Urine Bag — كيس إدرار", short: "Urine", minFreq: 1, maxFreq: 2 },
      { id: "ng-tube-14",         label: "NG Tube 14 — أنبوب تغذية 14", short: "NG14", minFreq: 1, maxFreq: 1 },
      { id: "floy-14",            label: "Foley 14 — قسطرة فولي 14", short: "Foley14", minFreq: 1, maxFreq: 1 }
    ];

    function openSupplyOrderModal(patientCount) {
      const overlay = $("supply-order-overlay");
      const modal = $("supply-order-modal");
      const list = $("supply-order-list");
      if (!overlay || !modal || !list) return;

      // Build the supply rows
      list.innerHTML = "";
      SUPPLY_RULES.forEach(rule => {
        const row = document.createElement("div");
        row.className = "supply-order-row";
        row.innerHTML = `
          <div class="supply-order-row-label">
            <div class="supply-order-row-name">${rule.label}</div>
            <div class="supply-order-row-range">تكرار ${rule.minFreq}–${rule.maxFreq} لكل مريض</div>
          </div>
          <input type="number" min="0" inputmode="numeric" placeholder="0" data-supply-id="${rule.id}" />
        `;
        list.appendChild(row);
      });

      overlay.hidden = false;
      modal.hidden = false;
    }

    function closeSupplyOrderModal() {
      $("supply-order-overlay").hidden = true;
      $("supply-order-modal").hidden = true;
    }

    $("supply-order-close").addEventListener("click", closeSupplyOrderModal);
    $("supply-order-overlay").addEventListener("click", closeSupplyOrderModal);

    // Submit: read quantities, distribute across patients, build chart, print
    // The supply-order modal is reused by BOTH:
    //   - The original "print-chart-btn" button (generates the chart
    //     image as a PNG)
    //   - The new "distribute-send-btn" button (sends patient + supply
    //     data to جارت الجارت)
    // We use the supply-order-submit button's text to decide which
    // action to take after the modal closes:
    //   - default text  → generate chart image
    //   - 'توزيع وإرسال' → send to جارت الجارت
    let _supplyOrderMode = "chart";  // "chart" or "send"

    // Reusable: collects quantities from the supply-order modal,
    // validates them, builds the supply distribution map, and closes
    // the modal. Returns the distribution map (or null on error).
    function collectAndDistributeSupplies() {
      // Collect the quantities from the modal inputs
      const quantities = {};
      document.querySelectorAll("#supply-order-list input[data-supply-id]").forEach(inp => {
        const id = inp.dataset.supplyId;
        const val = parseInt(inp.value, 10);
        quantities[id] = (isNaN(val) || val < 0) ? 0 : val;
      });

      // Count occupied patients
      const occupiedKeys = [];
      const Ward = global.PharmacyWard;
      Ward.ROOMS.forEach(room => {
        room.beds.forEach(bed => {
          const key = Ward.bedKey(room.id, bed.number);
          const p = state.patients[key];
          if (p && p.name && p.name.trim()) occupiedKeys.push(key);
        });
      });
      const patientCount = occupiedKeys.length;
      if (patientCount === 0) {
        flashHint("لا يوجد مرضى مشغولون");
        return null;
      }

      // Build the supply distribution map: supplyId → { bedKey: freq }
      // This will be passed to buildChartReport.
      const supplyDistribution = {};
      SUPPLY_RULES.forEach(rule => {
        const totalQty = quantities[rule.id] || 0;
        if (totalQty === 0) return; // skip this supply

        // Distribute `totalQty` across `patientCount` patients,
        // each getting a frequency between rule.minFreq and rule.maxFreq.
        // Algorithm:
        //   1. Each patient gets at least minFreq. If totalQty <
        //      patientCount × minFreq, some patients get 0 (randomly
        //      chosen). If totalQty >= patientCount × minFreq, all
        //      get at least minFreq and the remainder is distributed
        //      randomly (each patient gets up to maxFreq).
        //   2. The remainder is distributed so the sum = totalQty
        //      exactly. We give +1 to random patients (up to maxFreq)
        //      until the remainder is exhausted.
        const shuffled = occupiedKeys.slice();
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        const dist = {};
        // Phase 1: decide how many patients get at least minFreq
        const minTotal = patientCount * rule.minFreq;
        let perPatient; // array of freqs, aligned with shuffled[]
        if (totalQty >= minTotal) {
          // All patients get minFreq, remainder distributed
          perPatient = new Array(patientCount).fill(rule.minFreq);
          let remainder = totalQty - minTotal;
          // Distribute remainder: go through patients in random order,
          // give +1 each until remainder is 0 or everyone is at maxFreq
          let idx = 0;
          while (remainder > 0) {
            if (perPatient[idx] < rule.maxFreq) {
              perPatient[idx]++;
              remainder--;
            }
            idx = (idx + 1) % patientCount;
            // Safety: if we've gone around without distributing
            // anything (all at maxFreq), break.
            if (idx === 0 && remainder > 0) {
              let canDistribute = false;
              for (let k = 0; k < patientCount; k++) {
                if (perPatient[k] < rule.maxFreq) { canDistribute = true; break; }
              }
              if (!canDistribute) break;
            }
          }
        } else {
          // totalQty < minTotal: some patients get minFreq, rest get 0
          // How many patients can get minFreq?
          const numFull = Math.floor(totalQty / rule.minFreq);
          const leftover = totalQty - (numFull * rule.minFreq);
          perPatient = new Array(patientCount).fill(0);
          for (let i = 0; i < numFull; i++) perPatient[i] = rule.minFreq;
          // Distribute leftover (less than minFreq) to one more patient
          if (leftover > 0 && numFull < patientCount) {
            perPatient[numFull] = leftover;
          }
        }

        // Assign to bedKeys
        for (let i = 0; i < patientCount; i++) {
          if (perPatient[i] > 0) {
            dist[shuffled[i]] = perPatient[i];
          }
        }
        supplyDistribution[rule.id] = dist;
      });

      closeSupplyOrderModal();
      // Save this distribution as the "last" — used by the med-summary
      // button (red button) to display the same supplies without
      // requiring the user to re-distribute via the supply-order modal.
      _lastSupplyDistribution = supplyDistribution;
      return supplyDistribution;
    }

    $("supply-order-submit").addEventListener("click", () => {
      const supplyDistribution = collectAndDistributeSupplies();
      if (!supplyDistribution) return;

      // Branch based on which button opened the modal:
      if (_supplyOrderMode === "send") {
        // ----- Distribute + Send mode (new "distribute-send-btn") -----
        // Show the med-summary modal first so the user can review the
        // final tally (meds + distributed supplies) before sending.
        // The user then clicks "إرسال إلى جارت الجارت" inside that
        // modal to actually send the data.
        showMedSummaryList(supplyDistribution);
        // Replace the med-summary footer with a "send to جارت الجارت"
        // button so the user can review the summary, then click to send.
        const footer = $("med-summary-footer");
        if (footer) {
          footer.innerHTML = "";
          const sendBtn = document.createElement("button");
          sendBtn.type = "button";
          sendBtn.className = "med-summary-send-btn";
          sendBtn.textContent = "📤 إرسال إلى جارت الجارت";
          sendBtn.addEventListener("click", async () => {
            if (!global.PharmacyChartBridge) {
              flashHint("تعذّر تحميل وحدة جسر الجارت");
              return;
            }
            flashHint("يتم إرسال البيانات إلى جارت الجارت...");
            try {
              await global.PharmacyChartBridge.sendChart(state, supplyDistribution);
              flashHint("تم فتح جارت الجارت بالبيانات");
              closeMedSummary();
            } catch (err) {
              flashHint("تعذّر الإرسال: " + (err.message || err));
            }
          });
          footer.appendChild(sendBtn);
          // Also add a "skip / close" button so the user can review
          // without sending.
          const closeBtn = document.createElement("button");
          closeBtn.type = "button";
          closeBtn.className = "med-summary-cancel-btn";
          closeBtn.textContent = "إغلاق بدون إرسال";
          closeBtn.addEventListener("click", closeMedSummary);
          footer.appendChild(closeBtn);
        }
      } else {
        // ----- Chart mode (original "print-chart-btn") -----
        // Generate chart as a downloadable image overlay on the
        // reference chart template (img/chart-reference.png).
        flashHint("يتم توليد صورة الجارت... انتظر قليلاً");
        const wrapState = {
          patients: state.patients,
          meds: state.medications,
          supplyDistribution: supplyDistribution
        };
        setTimeout(async () => {
          try {
            const pages = await global.PharmacyChartImage.generateChartImage(wrapState);
            if (pages && pages.length > 0) {
              flashHint(`تم توليد ${pages.length} صفحة جارت — تحقق من التنزيلات`);
            }
          } catch (err) {
            console.error("[chart-image] error:", err);
            flashHint("تعذّر توليد صورة الجارت: " + (err.message || err));
          }
        }, 50);
      }
    });

    // ----- Distribute + Send button (توزيع المستلزمات + إرسال) -----
    // Combines the supply-order modal + med-summary review + chart
    // bridge into ONE workflow:
    //   1. Open the supply-order modal (same modal the chart button
    //      uses, but with a different submit-button label)
    //   2. On submit: distribute the supplies across patients + save
    //      the distribution
    //   3. Show the med-summary modal so the user can review the
    //      tally (meds + supplies) before sending
    //   4. The footer of the med-summary modal has "إرسال إلى جارت
    //      الجارت" + "إغلاق بدون إرسال" buttons.
    //   5. When the user clicks "إرسال", call
    //      PharmacyChartBridge.sendChart(state, supplyDistribution)
    //      which now accepts the supply distribution as a 2nd arg
    //      and injects the supplies into each patient's med list.
    $("distribute-send-btn").addEventListener("click", () => {
      if (!state.medications || state.medications.length === 0) {
        flashHint("لا توجد أدوية في الكتالوج");
        return;
      }
      // Count occupied patients
      const occCount = Object.values(state.patients || {})
        .filter(p => p && p.name && p.name.trim()).length;
      if (occCount === 0) {
        flashHint("لا يوجد مرضى مشغولون");
        return;
      }
      // Set the mode so the supply-order submit handler knows to
      // take the "send" branch instead of the "chart" branch.
      _supplyOrderMode = "send";
      // Update the submit button label so the user knows what
      // happens after they enter the supply quantities.
      const submitBtn = $("supply-order-submit");
      if (submitBtn) {
        submitBtn.textContent = "متابعة → مراجعة البيانات";
      }
      // Update the modal title so the user knows this is a
      // distribute+send workflow, not a chart-generation workflow.
      // (The title lives inside the modal's <h3> header.)
      const modalTitle = document.querySelector("#supply-order-modal .supply-order-head h3");
      if (modalTitle) {
        modalTitle.textContent = "توزيع المستلزمات ثم إرسال إلى جارت الجارت";
      }
      openSupplyOrderModal(occCount);
    });

    // The print-chart-btn still works as before (chart mode):
    $("print-chart-btn").addEventListener("click", () => {
      if (!state.medications || state.medications.length === 0) {
        flashHint("لا توجد أدوية في الكتالوج");
        return;
      }
      // Count occupied patients
      const occCount = Object.values(state.patients || {})
        .filter(p => p && p.name && p.name.trim()).length;
      if (occCount === 0) {
        flashHint("لا يوجد مرضى مشغولون لطباعة التشارت");
        return;
      }
      // Reset the submit button label + modal title in case the user
      // previously opened it via the distribute-send button.
      _supplyOrderMode = "chart";
      const submitBtn = $("supply-order-submit");
      if (submitBtn) {
        submitBtn.textContent = "توزيع واطبع التشارت";
      }
      const modalTitle = document.querySelector("#supply-order-modal .supply-order-head h3");
      if (modalTitle) {
        modalTitle.textContent = "قائمة طلب المستلزمات";
      }
      openSupplyOrderModal(occCount);
    });

    // (Sync button removed — Realtime handles live updates, and
    // pullCatalogOnBoot handles initial sync on app open.)

    // Admin back button
    $("admin-back-btn").addEventListener("click", () => {
      state.admin.editingId = null;
      state.admin.isNew = false;
      state.admin.selectedId = null;
      UI.hideAdminForm();
      state.currentBed = null;
      UI.showView("home");
    });

    // ----- Settings view (for non-admin pharmacists) -----
    $("settings-back-btn").addEventListener("click", () => {
      state.currentBed = null;
      UI.showView("home");
    });

    // Settings: ABX monitoring
    $("settings-abx-btn").addEventListener("click", () => {
      renderAbxMonitor();
      UI.showView("abx");
    });

    // Settings: chart bridge
    $("settings-bridge-btn").addEventListener("click", async () => {
      if (!global.PharmacyChartBridge) {
        flashHint("تعذّر تحميل وحدة جسر الجارت");
        return;
      }
      UI.showView("home");
      flashHint("يتم إرسال البيانات إلى جارت الجارت...");
      setTimeout(async () => {
        try {
          await global.PharmacyChartBridge.sendChart(state);
          flashHint("تم فتح جارت الجارت بالبيانات");
        } catch (err) {
          flashHint("تعذّر الإرسال: " + (err.message || err));
        }
      }, 50);
    });

    // Settings: dark mode toggle button
    $("settings-darkmode-btn").addEventListener("click", () => {
      const html = document.documentElement;
      const isDark = html.getAttribute("data-theme") === "dark";
      if (isDark) {
        html.removeAttribute("data-theme");
        try { localStorage.setItem("pharma.darkmode", "false"); } catch (e) {}
      } else {
        html.setAttribute("data-theme", "dark");
        try { localStorage.setItem("pharma.darkmode", "true"); } catch (e) {}
      }
      // Update the value display immediately
      const valueEl = $("settings-darkmode-value");
      if (valueEl) {
        const nowDark = html.getAttribute("data-theme") === "dark";
        valueEl.textContent = nowDark ? "مُفعّل" : "مُعطّل";
      }
    });

    // Settings: notification sound toggle
    // Toggles the Web Audio API chime that plays when a new
    // notification arrives. When enabling, also plays a preview
    // sound so the user knows what the chime sounds like (and so
    // the browser's autoplay policy unlocks the AudioContext for
    // future sounds — most browsers require a user gesture before
    // audio can play).
    $("settings-notif-sound-btn").addEventListener("click", () => {
      const wasEnabled = _isNotifSoundEnabled();
      const nowEnabled = !wasEnabled;
      try { localStorage.setItem("pharma.notif-sound", nowEnabled ? "true" : "false"); } catch (e) {}
      const valueEl = $("settings-notif-sound-value");
      if (valueEl) {
        valueEl.textContent = nowEnabled ? "مُفعّل" : "مُعطّل";
      }
      // Play a preview sound when enabling so the user hears it +
      // unlocks the AudioContext (browser autoplay policy requires
      // a user gesture).
      if (nowEnabled) {
        playNotificationSound("default");
      }
    });

    // Settings: TV display mode entry
    $("settings-tv-btn").addEventListener("click", () => {
      // Close the settings view first, then enter display mode
      UI.showView("home");
      enterDisplayMode();
    });

    // ----- Med Request Modal (doctor → admin) -----
    // Opens a modal where the doctor enters the details of a new
    // medication not in the catalog. On submit, the request is saved
    // to localStorage + a notification is pushed for the admin.
    // The admin reviews it in the admin view and can approve (adds
    // the med to the catalog) or reject it.
    function openMedRequestModal() {
      // Clear all fields
      ["med-req-name-trade", "med-req-name-en", "med-req-name-ar",
       "med-req-dose", "med-req-notes"].forEach(id => {
        const el = $(id);
        if (el) el.value = "";
      });
      const formEl = $("med-req-form");
      if (formEl) formEl.value = "";
      const freqEl = $("med-req-frequency");
      if (freqEl) freqEl.value = "";
      const errEl = $("med-req-error");
      if (errEl) errEl.hidden = true;
      // Show modal
      $("med-request-overlay").hidden = false;
      $("med-request-modal").hidden = false;
      setTimeout(() => $("med-req-name-trade")?.focus(), 50);
    }
    function closeMedRequestModal() {
      $("med-request-overlay").hidden = true;
      $("med-request-modal").hidden = true;
    }
    function submitMedRequest() {
      const nameTrade = ($("med-req-name-trade")?.value || "").trim();
      if (!nameTrade) {
        $("med-req-error").hidden = false;
        $("med-req-name-trade")?.focus();
        return;
      }
      const nameEn = ($("med-req-name-en")?.value || "").trim();
      const nameAr = ($("med-req-name-ar")?.value || "").trim();
      const dose = ($("med-req-dose")?.value || "").trim();
      const form = ($("med-req-form")?.value || "").trim() || "tablet";
      const frequency = ($("med-req-frequency")?.value || "").trim() || "1×1";
      const notes = ($("med-req-notes")?.value || "").trim();
      const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;

      const record = {
        id: "med-req-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        nameTrade: nameTrade,
        nameEn: nameEn,
        nameAr: nameAr,
        dose: dose,
        form: form,
        frequency: frequency,
        notes: notes,
        requestedBy: user ? user.username : "—",
        requestedAt: new Date().toISOString(),
        status: "pending"
      };
      Storage.addMedRequest(record);
      // Push to Supabase so the admin on ANOTHER device sees the request
      if (SB && SB.isConfigured && SB.isConfigured()) {
        const client = SB.getClient();
        if (client) {
          client.from("med_requests").upsert({
            id: record.id,
            name_trade: record.nameTrade,
            name_en: record.nameEn,
            name_ar: record.nameAr,
            dose: record.dose,
            form: record.form,
            frequency: record.frequency,
            notes: record.notes,
            requested_by: record.requestedBy,
            requested_at: record.requestedAt,
            status: "pending"
          }).then(({ error }) => {
            if (error) console.warn("[Supabase] med request push failed:", error.message);
          });
        }
      }
      // Push a notification so the admin sees a new request waiting
      pushNotification("med_request",
        `طلب دواء جديد: ${nameTrade} — من ${user ? user.username : "—"}`,
        nameTrade, "");
      closeMedRequestModal();
      flashHint("تم إرسال طلب إضافة الدواء — سيتم مراجعته من قبل المسؤول");
    }
    $("settings-med-request-btn").addEventListener("click", openMedRequestModal);
    $("med-request-close").addEventListener("click", closeMedRequestModal);
    $("med-request-cancel").addEventListener("click", closeMedRequestModal);
    $("med-request-overlay").addEventListener("click", closeMedRequestModal);
    $("med-request-submit").addEventListener("click", submitMedRequest);

    // ----- Admin: render med requests list -----
    // Renders the pending + reviewed med requests in the admin view.
    // The admin can approve (adds to catalog) or reject each request.
    // NOTE: These functions are ALSO defined at the top-level scope
    // (outside bindEvents) so openAdminView() can call renderMedRequests().
    // The top-level definitions are the REAL ones — these are kept
    // here only for the event-listener binding that references
    // approveMedRequest/rejectMedRequest via closure.
    // The actual implementations are at the top-level after bindEvents.

    // Settings: logout button
    $("settings-logout-btn").addEventListener("click", () => {
      if (!confirm("هل تريد تسجيل الخروج؟")) return;
      // Unsubscribe from Realtime before logging out
      if (realtimeChannel) {
        try { realtimeChannel.unsubscribe(); } catch (e) { /* ignore */ }
        realtimeChannel = null;
      }
      // Stop the polling fallback too — prevents the poller from
      // continuing to pull after logout (which would still work
      // since the anon key is used, but wastes bandwidth + battery
      // on the login screen).
      stopPolling();
      if (typeof Auth !== "undefined" && Auth && typeof Auth.logout === "function") {
        Auth.logout();
        applyRoleVisibility();
        showLogin();
        flashHint("تم تسجيل الخروج");
      } else {
        // Fallback: just go to login screen
        if (typeof UI !== "undefined" && UI) UI.showView("home");
      }
    });

    // Admin "دواء جديد"
    $("admin-new-btn").addEventListener("click", () => {
      state.admin.editingId = null;
      state.admin.isNew = true;
      state.admin.selectedId = null;
      UI.showAdminForm({}, true);
      UI.renderAdminMedList(state.medications, null);
      $("adm-name-ar").focus();
    });

    // Admin list clicks (delegated) — edit / delete
    // (move-up/down/top/bottom replaced with drag-and-drop, see below)
    $("admin-med-list").addEventListener("click", (e) => {
      const editBtn = e.target.closest('[data-action="edit-med"]');
      const delBtn  = e.target.closest('[data-action="del-med"]');
      if (editBtn) {
        const id = editBtn.dataset.medId;
        const m = state.medications.find(x => x.id === id);
        if (!m) return;
        state.admin.editingId = id;
        state.admin.isNew = false;
        state.admin.selectedId = id;
        UI.showAdminForm(m, false);
        UI.renderAdminMedList(state.medications, id);
      } else if (delBtn) {
        const id = delBtn.dataset.medId;
        const m = state.medications.find(x => x.id === id);
        if (!m) return;
        const label = UI.primaryName(m) || "هذا الدواء";
        if (!confirm(`حذف "${label}" من الكتالوج؟\n(لن يؤثر على العلاجات المسجلة بالفعل على المرضى)`)) return;
        // Cloud is the source of truth: snapshot before edit, revert on push failure
        const snapshot = state.medications.slice();
        state.medications = state.medications.filter(x => x.id !== id);
        Storage.saveMedications(state.medications);
        pushCatalogAfterEdit(() => {
          // Revert: restore snapshot, re-save, re-render
          state.medications = snapshot;
          Storage.saveMedications(snapshot);
          UI.renderAdminMedList(snapshot, null);
        });
        if (state.admin.editingId === id) {
          state.admin.editingId = null;
          state.admin.isNew = false;
          UI.hideAdminForm();
        }
        state.admin.selectedId = null;
        UI.renderAdminMedList(state.medications, null);
        flashHint("تم حذف الدواء من الكتالوج");
      }
    });

    // ---- Drag-and-drop reordering for the admin med list ----
    // Each .admin-med-row is draggable=true (set in ui.js). We use
    // HTML5 Drag and Drop API to allow the user to grab a row and
    // drop it in a new position — the entire state.medications array
    // is reordered accordingly (across all form groups). On drop,
    // we save + push to cloud + re-render.
    (function setupAdminDragDrop() {
      const listEl = $("admin-med-list");
      if (!listEl) return;

      let draggedId = null;
      let draggedRow = null;

      // dragstart: capture the dragged row's med id
      listEl.addEventListener("dragstart", (e) => {
        const row = e.target.closest(".admin-med-row");
        if (!row) return;
        draggedId = row.dataset.medId;
        draggedRow = row;
        row.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        // Some browsers require setData for drag to start
        try { e.dataTransfer.setData("text/plain", draggedId); } catch (_) {}
      });

      // dragend: cleanup
      listEl.addEventListener("dragend", (e) => {
        const row = e.target.closest(".admin-med-row");
        if (row) row.classList.remove("dragging");
        // Clear any remaining drag-over markers
        listEl.querySelectorAll(".admin-med-row.drag-over").forEach(r => {
          r.classList.remove("drag-over");
        });
        draggedId = null;
        draggedRow = null;
      });

      // dragover: prevent default to allow drop, mark the row under the
      // cursor with .drag-over so we can show a visual indicator
      listEl.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const row = e.target.closest(".admin-med-row");
        if (!row || row === draggedRow) return;
        // Clear previous drag-over markers, set on the new one
        listEl.querySelectorAll(".admin-med-row.drag-over").forEach(r => {
          r.classList.remove("drag-over");
        });
        row.classList.add("drag-over");
      });

      // dragleave: clear drag-over when leaving a row
      listEl.addEventListener("dragleave", (e) => {
        const row = e.target.closest(".admin-med-row");
        if (row) row.classList.remove("drag-over");
      });

      // drop: reorder the med in state.medications
      listEl.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const targetRow = e.target.closest(".admin-med-row");
        if (!targetRow || !draggedId) return;
        const targetId = targetRow.dataset.medId;
        if (targetId === draggedId) return;  // dropped on itself

        const fromIdx = state.medications.findIndex(x => x.id === draggedId);
        const toIdx   = state.medications.findIndex(x => x.id === targetId);
        if (fromIdx < 0 || toIdx < 0) return;

        const snapshot = state.medications.slice();
        const item = state.medications[fromIdx];
        state.medications.splice(fromIdx, 1);
        state.medications.splice(toIdx, 0, item);
        Storage.saveMedications(state.medications);
        pushCatalogAfterEdit(() => {
          state.medications = snapshot;
          Storage.saveMedications(snapshot);
          UI.renderAdminMedList(snapshot, draggedId);
        });
        UI.renderAdminMedList(state.medications, draggedId);
        // Scroll the moved row into view
        const rowEl = document.querySelector(`.admin-med-row[data-med-id="${draggedId}"]`);
        if (rowEl) rowEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
    })();

    // Admin: frequency dropdown — toggle custom field
    $("adm-freq").addEventListener("change", UI.toggleAdminFreqCustom);

    // Admin: cancel edit
    $("admin-cancel").addEventListener("click", () => {
      state.admin.editingId = null;
      state.admin.isNew = false;
      UI.hideAdminForm();
    });

    // Admin: save (add or update)
    $("admin-save").addEventListener("click", () => {
      const data = UI.readAdminForm();
      // validation — at least one name is required (trade, ar, or en)
      if (!data.nameTrade && !data.nameAr && !data.nameEn) {
        flashHint("أدخل اسم الدواء (تجاري أو علمي)");
        $("adm-name-trade").focus();
        return;
      }
      // dose is OPTIONAL — some forms (syrups, solutions) don't have
      // a fixed dose, so we allow it to be empty.
      if (!data.defaultFrequency) {
        flashHint("أدخل التكرار الافتراضي");
        $("adm-freq").focus();
        return;
      }
      if (state.admin.isNew) {
        // generate stable id from scientific name (preferred) or trade name or arabic
        const baseSource = data.nameEn || data.nameTrade || data.nameAr;
        const base = baseSource
          .toLowerCase()
          .replace(/[^a-z0-9\u0600-\u06FF]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 32) || ("med-" + Date.now());
        let id = base;
        let counter = 2;
        while (state.medications.some(m => m.id === id)) {
          id = `${base}-${counter++}`;
        }
        const snapshot = state.medications.slice();
        state.medications.push({
          id,
          nameTrade: data.nameTrade,
          nameAr:    data.nameAr,
          nameEn:    data.nameEn,
          form:      data.form,
          defaultDose: data.defaultDose,
          defaultFrequency: data.defaultFrequency
        });
        Storage.saveMedications(state.medications);
        pushCatalogAfterEdit(() => {
          // Revert: remove the added med, re-save, re-render
          state.medications = snapshot;
          Storage.saveMedications(snapshot);
          UI.renderAdminMedList(snapshot, null);
        });
        state.admin.editingId = id;
        state.admin.isNew = false;
        state.admin.selectedId = id;
        UI.renderAdminMedList(state.medications, id);
        // keep form open so admin can keep editing if desired, but switch title to edit
        UI.showAdminForm(state.medications.find(m => m.id === id), false);
        flashHint("تمت إضافة الدواء");
      } else {
        const m = state.medications.find(x => x.id === state.admin.editingId);
        if (!m) return;
        const snapshot = state.medications.slice();
        m.nameTrade = data.nameTrade;
        m.nameAr = data.nameAr;
        m.nameEn = data.nameEn;
        m.form = data.form;
        m.defaultDose = data.defaultDose;
        m.defaultFrequency = data.defaultFrequency;
        Storage.saveMedications(state.medications);
        pushCatalogAfterEdit(() => {
          // Revert: restore the pre-edit snapshot
          state.medications = snapshot;
          Storage.saveMedications(snapshot);
          UI.renderAdminMedList(snapshot, m.id);
        });
        UI.renderAdminMedList(state.medications, m.id);
        flashHint("تم حفظ التعديلات");
      }
    });

    // Admin: merge missing default meds into the current catalog and
    // push the result to the cloud. Unlike 'restore' (which replaces
    // the catalog with the defaults), this MERGES: keeps all the
    // user's existing meds (including custom ones they added) AND
    // adds any default med that's missing by id.
    //
    // Use case: user has 64 meds in their cloud (32 old defaults +
    // 32 custom additions). DEFAULT_MEDICATIONS now has 56 meds
    // (32 old + 24 new). Merging gives 64 + 24 = 88 meds.
    $("admin-restore-default-catalog").addEventListener("click", async () => {
      const def = (Meds && Meds.DEFAULT_MEDICATIONS) || [];
      if (!Array.isArray(def) || def.length === 0) {
        flashHint("لا يوجد كتالوج افتراضي متاح");
        return;
      }
      // Find which default meds are missing from the current catalog
      const existingIds = new Set(state.medications.map(m => m && m.id).filter(Boolean));
      const missing = def.filter(m => m && m.id && !existingIds.has(m.id));
      if (missing.length === 0) {
        flashHint("كل الأدوية الافتراضية موجودة بالفعل في الكتالوج");
        return;
      }
      if (!confirm(`سيتم إضافة ${missing.length} دواء جديد من الكتالوج الافتراضي إلى الكتالوج الحالي (${state.medications.length} دواء).\nالكتالوج سيصبح ${state.medications.length + missing.length} دواء ويرتفع للسحابة.\nكل الأجهزة ستراه بعد المزامنة.\nهل تريد المتابعة؟`)) return;
      // Snapshot for revert
      const snapshot = state.medications.slice();
      // Merge: append missing default meds to the current catalog
      // (preserves user's custom meds AND the existing order)
      const merged = state.medications.concat(missing);
      state.medications = merged;
      Storage.saveMedications(merged);
      UI.renderAdminMedList(merged, null);
      flashHint(`تمت إضافة ${missing.length} دواء محليًا — جارٍ الرفع للسحابة…`);
      // Push merged catalog to the cloud so other devices also get them
      if (SBSync && SBSync.pushCatalog && SB && SB.isConfigured()) {
        const res = await SBSync.pushCatalog();
        if (res.ok) {
          updateSupabaseStatusUI(`مربوط · ${res.count} دواء`, "connected");
          flashHint(`تم رفع ${res.count} دواء للسحابة — كل الأجهزة ستراها`);
        } else {
          // Revert on failure so the user knows the cloud didn't get it
          state.medications = snapshot;
          Storage.saveMedications(snapshot);
          UI.renderAdminMedList(snapshot, null);
          updateSupabaseStatusUI("فشل الرفع: " + res.error, "error");
          flashHint("فشل الرفع — تم إلغاء الإضافة. تحقق من الشبكة وحاول مرة أخرى");
        }
      } else {
        flashHint(`تمت إضافة ${missing.length} دواء محليًا (Supabase غير مُهيّأ — الأجهزة الأخرى لن تراها)`);
      }
    });

    // Admin: wipe patients only (keep medications)
    $("admin-wipe").addEventListener("click", () => {
      if (!confirm("⚠ تحذير: هذا سيمسح جميع بيانات المرضى نهائيًا.\nالأدوية لن تُمسح.\nهل أنت متأكد؟")) return;
      // Audit log — record the sensitive wipe action
      if (Auth && Auth.auditLog) {
        Auth.auditLog("data_wiped", "مسح جميع بيانات المرضى");
      }
      try {
        localStorage.removeItem("pharma.patients.v1");
      } catch (e) { /* ignore */ }
      state.patients = {};
      state.currentBed = null;
      refreshStatsAndRooms();
      flashHint("تم مسح جميع بيانات المرضى");
      // Sync wipe to Supabase — explicit bulk delete (the only place
      // that does this; everywhere else we upsert-merge to avoid
      // wiping data that other devices may still need to push up).
      if (SBSync && SBSync.pushPatientsWipe) {
        SBSync.pushPatientsWipe().then(r => {
          if (!r.ok) console.warn("[Supabase] wipe push failed:", r.error);
        });
      }
    });

    // ----- User Management (admin only) -----
    // NOTE: the renderUsersList() and refreshUsersList() functions
    // are defined at the module top-level (outside bindEvents) so
    // that openAdminView() can call them. The event listeners below
    // reference the same top-level functions via closure.
    // Create new user button
    $("user-create-btn").addEventListener("click", async () => {
      const displayName = $("user-display-name").value.trim();
      const username = $("user-username").value.trim().toLowerCase();
      const password = $("user-password").value;
      const role = $("user-role").value;
      const gender = $("user-gender").value;
      if (!displayName || !username || !password) {
        flashHint("أدخل جميع الحقول الثلاثة");
        return;
      }
      if (!Auth || !Auth.createUser) { flashHint("نظام المصادقة غير مُهيّأ"); return; }
      const creator = Auth.getCurrentUser();
      const res = await Auth.createUser(creator ? creator.username : "admin", username, password, displayName, role, gender);
      if (res.ok) {
        flashHint(`تم إنشاء المستخدم "${displayName}"`);
        $("user-display-name").value = "";
        $("user-username").value = "";
        $("user-password").value = "";
        $("user-role").value = "pharmacist";
        $("user-gender").value = "male";
        refreshUsersList();
      } else {
        flashHint("فشل إنشاء المستخدم: " + (res.error || ""));
      }
    });
    // Refresh users list button
    $("user-refresh-btn").addEventListener("click", refreshUsersList);
    // User row actions (event delegation)
    $("admin-users-list").addEventListener("click", async (e) => {
      const resetBtn = e.target.closest(".btn-user-reset");
      const toggleBtn = e.target.closest(".btn-user-toggle");
      const deleteBtn = e.target.closest(".btn-user-delete");
      if (resetBtn) {
        const uid = resetBtn.dataset.uid;
        const name = resetBtn.dataset.name;
        const newPass = prompt(`إعادة تعيين كلمة المرور للمستخدم "${name}"\nأدخل كلمة المرور الجديدة (4 أحرف على الأقل):`);
        if (!newPass) return;
        if (!Auth || !Auth.resetPassword) return;
        const res = await Auth.resetPassword(uid, newPass);
        if (res.ok) flashHint(`تم تغيير كلمة مرور "${name}"`);
        else flashHint("فشل تغيير كلمة المرور: " + (res.error || ""));
      } else if (toggleBtn) {
        const uid = toggleBtn.dataset.uid;
        const cur = toggleBtn.dataset.active === "true";
        if (!confirm(cur ? "تعطيل هذا الحساب؟" : "تفعيل هذا الحساب؟")) return;
        if (!Auth || !Auth.toggleUserActive) return;
        const res = await Auth.toggleUserActive(uid, cur);
        if (res.ok) { flashHint(cur ? "تم التعطيل" : "تم التفعيل"); refreshUsersList(); }
        else flashHint("فشل: " + (res.error || ""));
      } else if (deleteBtn) {
        const uid = deleteBtn.dataset.uid;
        const username = deleteBtn.dataset.username;
        const name = deleteBtn.dataset.name;
        if (!confirm(`⚠ حذف نهائي للمستخدم "${name}" (@${username})؟\nلا يمكن التراجع.`)) return;
        if (!Auth || !Auth.deleteUser) return;
        if (Auth.auditLog) Auth.auditLog("user_deleted", `حذف مستخدم "${name}" (@${username})`);
        const res = await Auth.deleteUser(uid);
        if (res.ok) { flashHint("تم حذف المستخدم"); refreshUsersList(); }
        else flashHint("فشل الحذف: " + (res.error || ""));
      }
    });

    // ----- Audit log (admin only) -----
    // NOTE: renderAuditLog() and refreshAuditLog() are defined at
    // module top-level so openAdminView() can call them.
    $("audit-refresh-btn").addEventListener("click", refreshAuditLog);

    // ----- Supabase: test / save / clear -----
    $("sb-test").addEventListener("click", async () => {
      if (!SB) { flashHint("مكتبة Supabase غير محمّلة"); return; }
      // Use whatever is currently in the inputs (even if not saved yet)
      const url = $("sb-url").value.trim();
      const anonKey = $("sb-key").value.trim();
      if (!url || !anonKey) {
        updateSupabaseStatusUI("أدخل URL و Anon Key أولاً", "error");
        return;
      }
      // Save temporarily so testConnection can use it
      SB.saveConfig(url, anonKey);
      updateSupabaseStatusUI("جارٍ الاختبار…", "loading");
      const res = await SB.testConnection();
      if (res.ok) {
        updateSupabaseStatusUI("الاتصال ناجح ✓", "connected");
        flashHint("تم الاتصال بـ Supabase بنجاح");
      } else {
        updateSupabaseStatusUI("فشل الاتصال: " + res.error, "error");
        flashHint("فشل الاتصال بـ Supabase");
      }
    });

    $("sb-save").addEventListener("click", async () => {
      if (!SB) { flashHint("مكتبة Supabase غير محمّلة"); return; }
      const url = $("sb-url").value.trim();
      const anonKey = $("sb-key").value.trim();
      if (!url || !anonKey) {
        updateSupabaseStatusUI("أدخل URL و Anon Key أولاً", "error");
        flashHint("أدخل URL و Anon Key");
        return;
      }
      SB.saveConfig(url, anonKey);
      updateSupabaseStatusUI("تم الحفظ · جارٍ المزامنة…", "loading");
      flashHint("تم حفظ إعدادات Supabase");
      // Try to pull the catalog right away
      const res = await SBSync.pullCatalog();
      if (res.ok) {
        state.medications = Storage.loadMedications();
        UI.renderAdminMedList(state.medications, null);
        updateSupabaseStatusUI(`مربوط · ${res.count} دواء`, "connected");
        flashHint("تمت المزامنة من Supabase");
      } else {
        // Pull failed → push the local catalog to populate the empty table
        const pushRes = await SBSync.pushCatalog();
        if (pushRes.ok) {
          updateSupabaseStatusUI(`مربوط · ${pushRes.count} دواء (مرفوع محليًا)`, "connected");
          flashHint("تم رفع الكتالوج المحلي إلى Supabase");
        } else {
          updateSupabaseStatusUI("مربوط لكن فشلت المزامنة: " + pushRes.error, "error");
          flashHint("فشلت المزامنة مع Supabase");
        }
      }
      // Also merge-pull patients so the user's local patients stay
      // in sync with any other device that pushed data to the cloud.
      const pres = await SBSync.pullPatients();
      if (pres.ok) {
        state.patients = Storage.loadPatients();
        refreshStatsAndRooms();
      }
    });

    $("sb-clear").addEventListener("click", () => {
      if (!SB) return;
      if (!confirm("إلغاء ربط Supabase؟ سيبقى الكتالوج المحلي كما هو.")) return;
      SB.clearConfig();
      refreshSupabaseInputs();
      updateSupabaseStatusUI("غير مربوط");
      flashHint("تم إلغاء ربط Supabase");
    });

    // Manual push/pull buttons (advanced)
    $("sb-push-now").addEventListener("click", pushCatalogManual);
    $("sb-pull-now").addEventListener("click", pullCatalogManual);
  }

  // -------- Admin: User Management + Audit Log helpers --------
  // These are top-level (not inside bindEvents) so openAdminView()
  // can call them. bindEvents() wires the event listeners that
  // reference the same functions via closure.
  function renderUsersList(users) {
    const container = $("admin-users-list");
    if (!container) return;
    if (!Array.isArray(users) || users.length === 0) {
      container.innerHTML = '<div class="admin-users-empty">لا يوجد مستخدمون بعد. أنشئ أول مستخدم بالأعلى.</div>';
      return;
    }
    const currentUser = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
    container.innerHTML = "";
    users.forEach(u => {
      const row = document.createElement("div");
      row.className = "admin-user-row" + (u.active === false ? " is-inactive" : "");
      const roleLabel =
        u.role === "admin" ? "مسؤول" :
        u.role === "doctor" ? "طبيب" :
        "صيدلي";
      const created = u.created_at
        ? new Date(u.created_at).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" })
        : "—";
      // Strip the |male or |female suffix from display_name for UI
      const cleanName = (u.display_name || "").split("|")[0] || u.username;
      // Extract gender for a small badge
      const genderSuffix = (u.display_name || "").split("|")[1];
      const genderLabel = genderSuffix === "female" ? "أنثى" : "ذكر";
      row.innerHTML = `
        <div class="admin-user-info">
          <div class="admin-user-name">${cleanName}</div>
          <div class="admin-user-meta">
            <span class="admin-user-username">@${u.username}</span>
            <span class="admin-user-role admin-user-role-${u.role}">${roleLabel}</span>
            <span class="admin-user-gender">${genderLabel}</span>
            <span class="admin-user-state ${u.active === false ? "is-off" : "is-on"}">${u.active === false ? "معطّل" : "نشط"}</span>
          </div>
          <div class="admin-user-meta">أنشأه: ${u.created_by || "—"} · ${created}</div>
        </div>
        <div class="admin-user-actions">
          <button class="btn-user-reset" data-uid="${u.id}" data-name="${cleanName}" type="button">🔑 كلمة مرور</button>
          <button class="btn-user-toggle" data-uid="${u.id}" data-active="${u.active}" type="button">${u.active === false ? "تفعيل" : "تعطيل"}</button>
          <button class="btn-user-delete" data-uid="${u.id}" data-username="${u.username}" data-name="${cleanName}" type="button">🗑 حذف</button>
        </div>
      `;
      // Don't let admin delete or disable their own account
      if (currentUser && currentUser.username === u.username) {
        row.querySelectorAll(".btn-user-toggle, .btn-user-delete").forEach(b => b.remove());
      }
      container.appendChild(row);
    });
  }
  async function refreshUsersList() {
    if (!Auth || !Auth.listUsers) return;
    const list = $("admin-users-list");
    if (list) list.innerHTML = '<div class="admin-users-loading">جارٍ التحميل…</div>';
    const res = await Auth.listUsers();
    if (res.ok) renderUsersList(res.users);
    else if (list) list.innerHTML = '<div class="admin-users-error">فشل تحميل المستخدمين: ' + (res.error || "") + '</div>';
  }
  function renderAuditLog(entries) {
    const container = $("admin-audit-list");
    if (!container) return;
    if (!Array.isArray(entries) || entries.length === 0) {
      container.innerHTML = '<div class="admin-audit-empty">لا يوجد نشاط مسجّل بعد.</div>';
      return;
    }
    const actionLabels = {
      patient_added: "➕ إضافة مريض",
      patient_deleted: "❌ حذف مريض",
      med_added: "💊 إضافة دواء",
      med_deleted: "🗑 حذف دواء",
      data_wiped: "⚠️ مسح بيانات",
      user_deleted: "👤 حذف مستخدم"
    };
    container.innerHTML = "";
    entries.forEach(entry => {
      const row = document.createElement("div");
      row.className = "audit-row";
      const dt = entry.created_at
        ? new Date(entry.created_at).toLocaleString("ar", { dateStyle: "short", timeStyle: "medium" })
        : "—";
      row.innerHTML = `
        <div class="audit-row-meta">
          <span class="audit-user">@${entry.username}</span>
          <span class="audit-action">${actionLabels[entry.action] || entry.action}</span>
          <span class="audit-time">${dt}</span>
        </div>
        <div class="audit-row-details">${entry.details || ""}</div>
      `;
      container.appendChild(row);
    });
  }
  async function refreshAuditLog() {
    if (!Auth || !Auth.getAuditLog) return;
    const list = $("admin-audit-list");
    if (list) list.innerHTML = '<div class="admin-audit-loading">جارٍ التحميل…</div>';
    const res = await Auth.getAuditLog(200);
    if (res.ok) renderAuditLog(res.entries);
    else if (list) list.innerHTML = '<div class="admin-audit-error">فشل تحميل السجل: ' + (res.error || "") + '</div>';
  }

  // -------- Settings view (for non-admin pharmacists) --------
  // -------- Admin: Med Requests (top-level, outside bindEvents) --------
  // These functions are defined here (top-level scope, NOT inside
  // bindEvents) so openAdminView() can call renderMedRequests().
  // (bindEvents is a separate closure — functions defined inside it
  // are not accessible from openAdminView which lives at the top level.)
  function renderMedRequests() {
    const list = $("admin-med-requests-list");
    if (!list) return;
    list.innerHTML = "";
    const requests = Storage.loadMedRequests();
    if (requests.length === 0) {
      list.innerHTML = `<p class="admin-discharged-hint">لا توجد طلبات حالياً</p>`;
      return;
    }
    const formLabels = (global.PharmacyMedications && global.PharmacyMedications.FORM_LABELS) || {};
    requests.forEach(r => {
      const dateStr = r.requestedAt
        ? new Date(r.requestedAt).toLocaleDateString("ar", { year: "numeric", month: "short", day: "numeric" })
        : "—";
      const statusBadge = r.status === "pending"
        ? `<span style="background:#FEF3C7;color:#A16207;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;">بانتظار</span>`
        : r.status === "approved"
        ? `<span style="background:#DCFCE7;color:#15803D;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;">موافق</span>`
        : `<span style="background:#FEE2E2;color:#B91C1C;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;">مرفوض</span>`;
      const card = document.createElement("div");
      card.className = "discharged-row";
      let actionsHtml = "";
      if (r.status === "pending") {
        actionsHtml = `
          <div style="display:flex;gap:6px;margin-top:6px;">
            <button type="button" data-action="approve" data-id="${r.id}"
              style="flex:1;padding:8px;background:#16a34a;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">
              ✅ موافقة وإضافة
            </button>
            <button type="button" data-action="reject" data-id="${r.id}"
              style="flex:1;padding:8px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">
              ❌ رفض
            </button>
          </div>
        `;
      }
      card.innerHTML = `
        <div class="discharged-row-head">
          <div class="discharged-row-name">${escapeHtml(r.nameTrade || "—")}</div>
          <div class="discharged-row-date">${dateStr} ${statusBadge}</div>
        </div>
        <div class="discharged-row-meta">
          <span>${escapeHtml(r.nameEn || "")}</span>
          ${r.nameAr ? `<span>· ${escapeHtml(r.nameAr)}</span>` : ""}
          ${r.dose ? `<span>· ${escapeHtml(r.dose)}</span>` : ""}
          <span>· ${escapeHtml(formLabels[r.form] || r.form || "—")}</span>
          <span>· ${escapeHtml(r.frequency || "—")}</span>
          ${r.notes ? `<span>· 📝 ${escapeHtml(r.notes)}</span>` : ""}
          <span>· طلب: ${escapeHtml(r.requestedBy || "—")}</span>
        </div>
        ${actionsHtml}
      `;
      list.appendChild(card);
    });
    list.querySelectorAll("button[data-action]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === "approve") approveMedRequest(id);
        else if (action === "reject") rejectMedRequest(id);
      });
    });
  }
  function approveMedRequest(id) {
    const requests = Storage.loadMedRequests();
    const req = requests.find(r => r.id === id);
    if (!req) return;
    const slug = (req.nameTrade || req.nameEn || "med")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "med-" + Date.now();
    const medId = slug + "-" + Date.now().toString(36);
    const meds = Storage.loadMedications();
    meds.push({
      id: medId,
      nameTrade: req.nameTrade || "",
      nameAr: req.nameAr || "",
      nameEn: req.nameEn || "",
      form: req.form || "tablet",
      defaultDose: req.dose || "",
      defaultFrequency: req.frequency || "1×1"
    });
    Storage.saveMedications(meds);
    state.medications = meds;
    if (SBSync && SBSync.pushCatalog) {
      SBSync.pushCatalog().then(r => {
        if (!r.ok) console.warn("[Supabase] catalog push failed:", r.error);
      });
    }
    const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
    const reviewedAt = new Date().toISOString();
    Storage.updateMedRequest(id, {
      status: "approved",
      reviewedBy: user ? user.username : "—",
      reviewedAt: reviewedAt,
      approvedMedId: medId
    });
    // Also update Supabase so the status syncs to other devices
    if (SB && SB.isConfigured && SB.isConfigured()) {
      const client = SB.getClient();
      if (client) {
        client.from("med_requests").update({
          status: "approved",
          reviewed_by: user ? user.username : "—",
          reviewed_at: reviewedAt,
          approved_med_id: medId
        }).eq("id", id).then(({ error }) => {
          if (error) console.warn("[Supabase] med request update failed:", error.message);
        });
      }
    }
    UI.renderAdminMedList(meds, null);
    renderMedRequests();
    flashHint(`تمت إضافة "${req.nameTrade}" إلى كتالوج الأدوية`);
  }
  function rejectMedRequest(id) {
    const requests = Storage.loadMedRequests();
    const req = requests.find(r => r.id === id);
    if (!req) return;
    const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
    const reviewedAt = new Date().toISOString();
    Storage.updateMedRequest(id, {
      status: "rejected",
      reviewedBy: user ? user.username : "—",
      reviewedAt: reviewedAt
    });
    // Also update Supabase so the status syncs to other devices
    if (SB && SB.isConfigured && SB.isConfigured()) {
      const client = SB.getClient();
      if (client) {
        client.from("med_requests").update({
          status: "rejected",
          reviewed_by: user ? user.username : "—",
          reviewed_at: reviewedAt
        }).eq("id", id).then(({ error }) => {
          if (error) console.warn("[Supabase] med request update failed:", error.message);
        });
      }
    }
    renderMedRequests();
    flashHint(`تم رفض طلب "${req.nameTrade}"`);
  }

  // Shows a simplified settings page with:
  //   - Dark/light mode toggle
  //   - TV display mode entry
  //   - Logout button
  // Opens when a non-admin pharmacist taps the gear ⚙ button. Admins
  // see the full admin view (openAdminView) instead.
  function openSettingsView() {
    // Update the dark-mode value display
    const valueEl = $("settings-darkmode-value");
    if (valueEl) {
      const isDark = document.documentElement.getAttribute("data-theme") === "dark";
      valueEl.textContent = isDark ? "مُفعّل" : "مُعطّل";
    }
    const isDoctor = Auth && Auth.isDoctor && Auth.isDoctor();
    // Hide TV display mode row for doctors (not needed)
    const tvRow = $("settings-tv-btn");
    if (tvRow) tvRow.hidden = isDoctor;
    // Hide the chart bridge row for ALL roles — its functionality is
    // now integrated into the new "distribute-send-btn" in the header
    // (which combines supply distribution + med-summary review +
    // chart-bridge send into one workflow). Admins + pharmacists
    // use that header button; doctors don't see it (it's a
    // pharmacist task).
    const bridgeRow = $("settings-bridge-btn");
    if (bridgeRow) bridgeRow.hidden = true;
    // Hide ABX + Albumin monitoring row for doctors. That monitoring
    // is a pharmacist task — doctors don't need to see antibiotic
    // usage reports. Admins + pharmacists still see it.
    const abxRow = $("settings-abx-btn");
    if (abxRow) abxRow.hidden = isDoctor;
    // Show the "request new medication" row only for doctors (the
    // primary users who request new meds) + admins (who may also
    // want to add meds directly). Hide it for pharmacists.
    const medReqRow = $("settings-med-request-btn");
    if (medReqRow) {
      const isAdmin = Auth && Auth.isAdmin();
      medReqRow.hidden = !(isDoctor || isAdmin);
    }
    // Show pending med requests count for admins in the row value
    if (Auth && Auth.isAdmin && Auth.isAdmin()) {
      const pendingCount = Storage.getPendingMedRequestsCount();
      const valEl = $("settings-med-request-value");
      if (valEl) valEl.textContent = pendingCount > 0 ? `${pendingCount} طلب` : "";
    }
    // The discharged/dead patients list row stays visible to ALL
    // roles (admin + doctor + pharmacist) — every role may need
    // to look up a returning patient's history.
    // Initialize the notification sound toggle's value display.
    const notifSoundVal = $("settings-notif-sound-value");
    if (notifSoundVal) {
      notifSoundVal.textContent = _isNotifSoundEnabled() ? "مُفعّل" : "مُعطّل";
    }
    UI.showView("settings");
  }

  // -------- Admin view --------
  function openAdminView() {
    state.admin.isNew = false;
    state.admin.selectedId = null;
    UI.hideAdminForm();
    UI.renderAdminMedList(state.medications, null);
    refreshSupabaseInputs();
    // The default Supabase config is embedded, so the app is always
    // "configured" out of the box. Show that in the status badge.
    if (SB && SB.isConfigured()) {
      const usingEmbedded = SB.isUsingEmbedded();
      const label = usingEmbedded ? "مربوط تلقائيًا · جاهز للمزامنة" : "مربوط بإعداد مخصص";
      updateSupabaseStatusUI(label, "connected");
    } else {
      updateSupabaseStatusUI("غير مربوط");
    }
    // Show/hide the admin-only User Management + Audit Log sections
    // based on the current user's role.
    const isAdmin = Auth && Auth.isAdmin();
    const usersSection = document.getElementById("admin-users-section");
    const auditSection = document.getElementById("admin-audit-section");
    if (usersSection) usersSection.hidden = !isAdmin;
    if (auditSection)  auditSection.hidden  = !isAdmin;
    if (isAdmin) {
      // Auto-load users list + audit log on view open
      refreshUsersList();
      refreshAuditLog();
      // Pull latest med requests from Supabase (so the admin sees
      // new requests from doctors immediately when opening admin view)
      pullMedRequestsFromCloud();
    }
    UI.showView("admin");
  }

  // -------- Sheet helpers --------
  // -------- Build the labs + vitals column content (RIGHT side of sheet) --------
  // Shows filled-in lab values (from patient.labs) + empty fields for
  // BP (ضغط) and O2 (أوكسجين) for the doctor to fill manually.
  function buildLabsVitalsHtml(patient) {
    const labs = (patient && patient.labs) ? patient.labs : {};
    const labHistory = (patient && patient.labHistory) ? patient.labHistory : [];
    const labDefs = [
      ["S. Creatinine", "creatinine"],
      ["S. Albumin",    "albumin"],
      ["WBC",           "wbc"],
      ["Hb",            "hb"],
      ["PLT",           "plt"],
      ["Na+",           "na"],
      ["K+",            "k"],
      ["Glucose",       "glucose"],
      ["CRP",           "crp"]
    ];
    // Show ALL current lab fields, one below the other.
    let labRows = "";
    labDefs.forEach(([label, key]) => {
      const val = labs[key];
      const displayVal = (val != null && String(val).trim() !== "")
        ? escapeHtml(String(val))
        : "—";
      labRows += `<div class="ps-lab-row"><span class="ps-lab-val">${displayVal}</span><span class="ps-lab-label">${label}</span></div>`;
    });

    // Show lab history (previous entries grouped by date)
    let historyRows = "";
    if (labHistory.length > 0) {
      // Group by date
      const byDate = {};
      labHistory.forEach(h => {
        const d = h.date || "—";
        if (!byDate[d]) byDate[d] = [];
        byDate[d].push(h);
      });
      const sortedDates = Object.keys(byDate).sort().reverse();
      sortedDates.forEach(date => {
        const entries = byDate[date];
        const dateStr = formatDateShortForPrint(date);
        const parts = entries.map(e => `${e.label}: ${e.value}`).join("  ·  ");
        historyRows += `<div class="ps-lab-row ps-lab-history"><span class="ps-lab-val">${escapeHtml(parts)}</span><span class="ps-lab-label">${escapeHtml(dateStr)}</span></div>`;
      });
    }

    // Vitals — BP + O2, empty (shown FIRST at the top per user request)
    const vitalsRows = `
      <div class="ps-lab-row"><span class="ps-lab-val">—</span><span class="ps-lab-label">BP</span></div>
      <div class="ps-lab-row"><span class="ps-lab-val">—</span><span class="ps-lab-label">O₂ Sat</span></div>
    `;
    return `
      <div class="ps-labs-section">
        <div class="ps-labs-title">Vitals</div>
        ${vitalsRows}
        <div class="ps-labs-title" style="margin-top:10px;">Lab Results</div>
        ${labRows}
        ${historyRows ? `<div class="ps-labs-title" style="margin-top:10px;">Previous Results</div>${historyRows}` : ""}
      </div>
    `;
  }

  function formatDateShortForPrint(dateStr) {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
    } catch (e) { return dateStr; }
  }

  // -------- Print patient sheet (A4) --------
  // Generates a printable A4 sheet for the patient:
  //   - Top: doctor name + patient name + room + bed + plate + today's date
  //   - Left column (RTL = right): medications list (name + dose + frequency)
  //   - Right column (RTL = left): empty grid for daily vital signs
  //     (temperature, pulse, BP, respiration, O2 sat, urine) × 7 days
  //
  // Opens a new browser window with self-contained HTML + inline CSS
  // + the chart content + an auto-print script. This works on all
  // browsers including iOS Safari (which blocks window.print() in
  // PWA standalone mode).
  function printPatientSheet(patient, currentBed) {
    if (!patient || !currentBed) return;
    const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
    // The patient's attending physician (الطبيب المعالج) — stored as
    // a free-text field on the patient record (e.g. "أ.د. محمد الجبوري").
    const attendingDoctor = patient.doctor || "—";
    const diagnosis = patient.diagnosis || "";
    const patientName = patient.name || "—";
    const room = `غرفة ${currentBed.roomId}`;
    const bed = `سرير ${currentBed.bed}`;
    const plate = patient.plateNumber ? ` · طبلة ${patient.plateNumber}` : "";
    const now = new Date();
    const dateStr = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;

    // ---- Build medications list HTML ----
    // User requirements:
    //   - Medications on the LEFT side of the page (not right)
    //   - Names in ENGLISH (use nameEn || nameTrade)
    //   - Dose BESIDE the name (not below) — same line, same font size,
    //     same weight, same color
    //   - Direction: LTR (left-to-right) — the user said "I want the
    //     medications to be written left-to-right"
    //   - Frequency as "x N" after the dose (e.g. "Meronem 500 mg x 2"
    //     for a 1×2 prescription). We strip the "1×" prefix and use
    //     "x N" form instead.
    const meds = (Array.isArray(patient.medications) ? patient.medications : [])
      .filter(pm => pm && pm.id !== "syringe-5cc");
    // Sort medications by form: Vials first, then Ampules, then
    // Prefilled Syringes, then Tablets (pills last). This matches
    // the user's request: "Vials at the top of the list, Tablets
    // at the bottom."
    const FORM_ORDER_PRINT = [
      "vial", "ampule", "prefilled-syringe", "solution",
      "syrup-and-oral-drop", "suppository", "supplies", "tablet"
    ];
    const Meds = global.PharmacyMedications || {};
    const medCatalog = state.medications || [];
    const sortedMeds = meds.slice().sort((a, b) => {
      const formA = (medCatalog.find(m => m.id === a.id)?.form) || a.form || "tablet";
      const formB = (medCatalog.find(m => m.id === b.id)?.form) || b.form || "tablet";
      const idxA = FORM_ORDER_PRINT.indexOf(formA);
      const idxB = FORM_ORDER_PRINT.indexOf(formB);
      return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
    });
    let medsRows = "";
    if (meds.length === 0) {
      medsRows = `<div class="ps-empty">No medications</div>`;
    } else {
      // Get the non-daily frequency helpers
      const Meds = global.PharmacyMedications || {};
      const isMedDueToday = Meds.isMedDueToday || function() { return true; };
      const getFrequencyInterval = Meds.getFrequencyInterval || function() { return 0; };
      const pFirstMedDate = patient.firstMedDate || "";

      // Compute the patient's day label (D1, D2, ...) based on
      // firstMedDate. Same logic as the ABX monitoring view.
      let dayLabel = "";
      if (pFirstMedDate) {
        const nowDay = new Date();
        nowDay.setHours(0, 0, 0, 0);
        const startDay = new Date(pFirstMedDate);
        startDay.setHours(0, 0, 0, 0);
        const diffDays = Math.floor((nowDay - startDay) / 86400000);
        dayLabel = "D" + Math.max(1, diffDays + 1);
      }

      // Check if the patient has any critical med (antibiotic/albumin).
      // If so, show the day label. If not, don't show it (day tracking
      // is only for critical meds).
      const ANTIBIOTIC_IDS = [
        "ceftriaxone", "meropenem", "vancomycin", "amoxycillin-500",
        "ceftazidime-1g", "ciprofloxacin-200", "cefotaxime-1g",
        "colistin", "tigecycline", "amoxclav", "azithromycin-500",
        "metronidazole-500"
      ];
      const hasCriticalMed = meds.some(m => ANTIBIOTIC_IDS.indexOf(m.id) !== -1);

      medsRows = sortedMeds.map((m, i) => {
        // English-first name (user requested English).
        const name = m.nameEn || m.nameTrade || m.nameAr || m.name || m.id || "—";
        const dose = m.dose || "";
        const freq = m.frequency || "";

        // For non-daily frequencies, show the interval text + whether
        // the med is due today. For daily frequencies, show "x N".
        let freqStr = "";
        let dueNote = "";
        const interval = getFrequencyInterval(freq);
        if (interval > 0) {
          freqStr = freq;
          if (isMedDueToday(freq, pFirstMedDate)) {
            dueNote = " ✓ مستحق اليوم";
          } else {
            dueNote = " (غير مستحق اليوم)";
          }
        } else {
          const m1 = freq.match(/×\s*(\d+)/);
          const m2 = freq.match(/^(\d+)$/);
          if (m1) freqStr = "x " + m1[1];
          else if (m2) freqStr = "x " + m2[1];
          else if (/^\s*\d+\s*$/.test(freq)) freqStr = "x " + freq.trim();
        }

        // Day label for this med — show D1/D2/... only for critical
        // meds (antibiotics). Non-critical meds get an empty cell.
        const medDay = (ANTIBIOTIC_IDS.indexOf(m.id) !== -1 && hasCriticalMed) ? dayLabel : "";

        // Form abbreviation — a short label (V, A, PS, T, etc.)
        // shown in a box left of the med number. Fluids (N/S, G/S,
        // R/L, G/W) get "F" instead of "Sup" even though they stay
        // in the supplies category.
        const FORM_ABBR = (global.PharmacyMedications && global.PharmacyMedications.FORM_ABBR) || {};
        const FLUID_IDS_PRINT = (global.PharmacyMedications && global.PharmacyMedications.FLUID_IDS) || [];
        const medForm = (medCatalog.find(m2 => m2.id === m.id)?.form) || m.form || "tablet";
        // Check if this med is a fluid — if so, use "F" abbreviation
        const isFluid = FLUID_IDS_PRINT.indexOf(m.id) !== -1;
        const formAbbr = isFluid ? "F" : (FORM_ABBR[medForm] || "—");

        const parts = [
          escapeHtml(name),
          dose ? escapeHtml(dose) : "",
          freqStr ? escapeHtml(freqStr) : "",
          dueNote ? escapeHtml(dueNote) : ""
        ].filter(p => p).join("&nbsp;&nbsp;");
        return `<div class="ps-med-line"><span class="ps-med-day">${medDay}</span><span class="ps-med-form">${formAbbr}</span><span class="ps-med-num">${i + 1}.</span> <span class="ps-med-name">${parts}</span></div>`;
      }).join("");
    }

    // Open a new window with self-contained HTML
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      flashHint("تعذّر فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة");
      return;
    }
    const doc = printWindow.document;
    doc.open();
    doc.write([
      '<!DOCTYPE html>',
      '<html lang="ar" dir="rtl">',
      '<head>',
      '<meta charset="UTF-8">',
      // Empty title — avoids the "Patient Sheet — name" footer that
      // the browser would print on every page. An empty title shows
      // as an empty string (no footer text).
      '<title></title>',
      '<link rel="preconnect" href="https://fonts.googleapis.com">',
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
      '<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">',
      '<style>',
      // Zero @page margin — prevents the browser from reserving space
      // for the default header (URL) and footer (date, page count).
      // We add the page padding inside the body instead.
      '@page { size: A4 portrait; margin: 0; }',
      '* { margin: 0; padding: 0; box-sizing: border-box; }',
      'body { font-family: "Tajawal", Arial, sans-serif; color: #000; line-height: 1.4; padding: 12mm; }',
      // ---- Header (top of page): 4 cells ----
      '.ps-header { border: 2px solid #000; padding: 10px 14px; margin-bottom: 12px; }',
      '.ps-header-row { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px; }',
      '.ps-header-cell { font-size: 13px; font-weight: 700; line-height: 1.6; }',
      '.ps-header-cell strong { display: block; font-size: 14px; font-weight: 800; margin-bottom: 2px; }',
      // ---- Body: two columns ----
      // The user wants medications on the LEFT, vital signs on the RIGHT.
      // Since the doc is RTL, the FIRST grid column visually appears on
      // the RIGHT. So to put meds on the LEFT, we put them in the 2nd
      // grid column (visually = left side).
      '.ps-body { display: grid; grid-template-columns: 50% 50%; gap: 12px; min-height: 230mm; }',
      // Vital signs column (visually on the RIGHT in RTL = first grid col)
      '.ps-vs-col { border: 1.5px solid #000; padding: 10px; }',
      // No title, no table — just an empty box.
      // The user said: "without titles, no table — just a big empty
      // box. I'll tell you later what to write there."
      // So we leave it as a big empty bordered box.
      '.ps-vs-box { width: 100%; min-height: 220mm; }',
      '.ps-labs-section { font-size: 13px; line-height: 1.5; }',
      '.ps-labs-title { font-size: 13px; font-weight: 800; margin-bottom: 6px; text-decoration: underline; }',
      '.ps-lab-row { display: flex; justify-content: space-between; padding: 3px 0; }',
      '.ps-lab-label { font-weight: 700; }',
      '.ps-lab-val { font-weight: 800; }',
      // Meds column (visually on the LEFT in RTL = second grid col)
      // The user said: "I want the medications to be written
      // left-to-right" — so we set dir="ltr" on the med lines. This
      // makes "1. Meronem 500 mg x 2" read left-to-right (number on
      // the left, name in the middle, dose/freq on the right).
      '.ps-meds-col { border: 1.5px solid #000; padding: 10px 12px; direction: ltr; text-align: left; }',
      '.ps-med-line { font-size: 16px; font-weight: 700; padding: 6px 0; border-bottom: 1px dashed #ccc; }',
      '.ps-med-line:last-child { border-bottom: none; }',
      '.ps-med-day:empty { display: inline-block; width: 38px; margin-right: 8px; }',
      '.ps-med-day:not(:empty) { display: inline-block; width: 38px; text-align: center; font-size: 14px; font-weight: 800; background: #000; border: 1.5px solid #000; border-radius: 6px; padding: 2px 4px; margin-right: 8px; color: #fff; vertical-align: middle; }',
      '.ps-med-form { display: inline-block; width: 32px; text-align: center; font-size: 12px; font-weight: 800; border-radius: 6px; padding: 2px 4px; margin-right: 8px; vertical-align: middle; background: #fff; border: 1.5px solid #000; color: #000; }',
      // IMPORTANT: name + dose + freq share the SAME font-size,
      // font-weight, and color (per user request).
      '.ps-med-num { font-weight: 700; }',
      '.ps-med-name { font-weight: 700; }',
      '.ps-empty { text-align: center; padding: 20px; color: #999; font-size: 12px; }',
      '@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }',
      '</style>',
      '</head>',
      '<body>',
      '<div class="ps-header">',
      '  <div class="ps-header-row">',
      '    <div class="ps-header-cell"><strong>المريض</strong>' + escapeHtml(patientName) + '</div>',
      '    <div class="ps-header-cell"><strong>الطبيب المعالج</strong>' + escapeHtml(attendingDoctor) + '</div>',
      '    <div class="ps-header-cell"><strong>الغرفة</strong>' + escapeHtml(room) + '</div>',
      '    <div class="ps-header-cell"><strong>التاريخ</strong>' + dateStr + '</div>',
      '  </div>',
      '</div>',
      '<div class="ps-body">',
      // First grid column (visually RIGHT in RTL) — vital signs box
      '  <div class="ps-vs-col">' + buildLabsVitalsHtml(patient) + '</div>',
      // Second grid column (visually LEFT in RTL) — medications list
      '  <div class="ps-meds-col">' + medsRows + '</div>',
      '</div>',
      '<script>',
      // Wait for fonts to load before printing (800ms safety margin)
      'window.addEventListener("load", function() {',
      '  setTimeout(function() {',
      '    try { window.print(); } catch (e) {}',
      '    setTimeout(function() { try { window.close(); } catch (e) {} }, 1000);',
      '  }, 800);',
      '});',
      '<\/script>',
      '</body>',
      '</html>'
    ].join('\n'));
    doc.close();
  }

  // Helper: escape HTML special chars to prevent XSS in the print window
  function escapeHtml(text) {
    if (text == null) return "";
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // -------- Print ALL patient sheets as one multi-page PDF --------
  // Iterates all occupied patients, builds a single HTML document
  // with one page per patient (using CSS page-break-after), then
  // opens a print window. This is the same layout as printPatientSheet
  // but for all patients in one download.
  //
  // The PDF is generated by the browser's print-to-PDF feature (the
  // user picks "Save as PDF" in the print dialog). This works on all
  // platforms including iOS Safari.
  function printAllPatientSheets(occPatients) {
    if (!occPatients || occPatients.length === 0) return;

    const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;

    // Build each patient's section as a page div
    const pagesHtml = occPatients.map(({ patient, currentBed }) => {
      const attendingDoctor = patient.doctor || "—";
      const diagnosis = patient.diagnosis || "";
      const patientName = patient.name || "—";
      const room = `غرفة ${currentBed.roomId}`;
      const bed = `سرير ${currentBed.bed}`;
      const plate = patient.plateNumber ? ` · طبلة ${patient.plateNumber}` : "";
      const now = new Date();
      const dateStr = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;

      // Build medications list (same as printPatientSheet)
      const meds = (Array.isArray(patient.medications) ? patient.medications : [])
        .filter(pm => pm && pm.id !== "syringe-5cc");
      // Sort by form: Vials first, Tablets last
      const FORM_ORDER_PRINT2 = [
        "vial", "ampule", "prefilled-syringe", "solution",
        "syrup-and-oral-drop", "suppository", "supplies", "tablet"
      ];
      const medCatalog2 = state.medications || [];
      const sortedMeds = meds.slice().sort((a, b) => {
        const formA = (medCatalog2.find(m => m.id === a.id)?.form) || a.form || "tablet";
        const formB = (medCatalog2.find(m => m.id === b.id)?.form) || b.form || "tablet";
        const idxA = FORM_ORDER_PRINT2.indexOf(formA);
        const idxB = FORM_ORDER_PRINT2.indexOf(formB);
        return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
      });
      let medsRows = "";
      if (meds.length === 0) {
        medsRows = `<div class="ps-empty">No medications</div>`;
      } else {
        const Meds2 = global.PharmacyMedications || {};
        const isMedDueToday2 = Meds2.isMedDueToday || function() { return true; };
        const getFrequencyInterval2 = Meds2.getFrequencyInterval || function() { return 0; };
        const pFirstMedDate2 = patient.firstMedDate || "";

        // Compute day label (D1, D2, ...) for this patient
        let dayLabel2 = "";
        if (pFirstMedDate2) {
          const nowDay2 = new Date();
          nowDay2.setHours(0, 0, 0, 0);
          const startDay2 = new Date(pFirstMedDate2);
          startDay2.setHours(0, 0, 0, 0);
          const diffDays2 = Math.floor((nowDay2 - startDay2) / 86400000);
          dayLabel2 = "D" + Math.max(1, diffDays2 + 1);
        }
        const ANTIBIOTIC_IDS2 = [
          "ceftriaxone", "meropenem", "vancomycin", "amoxycillin-500",
          "ceftazidime-1g", "ciprofloxacin-200", "cefotaxime-1g",
          "colistin", "tigecycline", "amoxclav", "azithromycin-500",
          "metronidazole-500"
        ];
        const hasCriticalMed2 = meds.some(m => ANTIBIOTIC_IDS2.indexOf(m.id) !== -1);

        medsRows = sortedMeds.map((m, i) => {
          const name = m.nameEn || m.nameTrade || m.nameAr || m.name || m.id || "—";
          const dose = m.dose || "";
          let freqStr = "";
          let dueNote = "";
          const freq = m.frequency || "";
          const interval = getFrequencyInterval2(freq);
          if (interval > 0) {
            freqStr = freq;
            if (isMedDueToday2(freq, pFirstMedDate2)) {
              dueNote = " ✓ مستحق اليوم";
            } else {
              dueNote = " (غير مستحق اليوم)";
            }
          } else {
            const m1 = freq.match(/×\s*(\d+)/);
            const m2 = freq.match(/^(\d+)$/);
            if (m1) freqStr = "x " + m1[1];
            else if (m2) freqStr = "x " + m2[1];
          }
          // Day label for critical meds only
          const medDay2 = (ANTIBIOTIC_IDS2.indexOf(m.id) !== -1 && hasCriticalMed2) ? dayLabel2 : "";
          // Form abbreviation — fluids get "F"
          const FORM_ABBR2 = (global.PharmacyMedications && global.PharmacyMedications.FORM_ABBR) || {};
          const FLUID_IDS_P2 = (global.PharmacyMedications && global.PharmacyMedications.FLUID_IDS) || [];
          const medForm2 = (medCatalog2.find(m2 => m2.id === m.id)?.form) || m.form || "tablet";
          const isFluid2 = FLUID_IDS_P2.indexOf(m.id) !== -1;
          const formAbbr2 = isFluid2 ? "F" : (FORM_ABBR2[medForm2] || "—");
          const parts = [
            escapeHtml(name),
            dose ? escapeHtml(dose) : "",
            freqStr ? escapeHtml(freqStr) : "",
            dueNote ? escapeHtml(dueNote) : ""
          ].filter(p => p).join("&nbsp;&nbsp;");
          return `<div class="ps-med-line"><span class="ps-med-day">${medDay2}</span><span class="ps-med-form">${formAbbr2}</span><span class="ps-med-num">${i + 1}.</span> <span class="ps-med-name">${parts}</span></div>`;
        }).join("");
      }

      return `
        <div class="ps-page">
          <div class="ps-header">
            <div class="ps-header-row">
              <div class="ps-header-cell"><strong>المريض</strong>${escapeHtml(patientName)}</div>
              <div class="ps-header-cell"><strong>الطبيب المعالج</strong>${escapeHtml(attendingDoctor)}</div>
              <div class="ps-header-cell"><strong>الغرفة</strong>${escapeHtml(room)}</div>
              <div class="ps-header-cell"><strong>التاريخ</strong>${dateStr}</div>
            </div>
          </div>
          <div class="ps-body">
            <div class="ps-vs-col">${buildLabsVitalsHtml(patient)}</div>
            <div class="ps-meds-col">${medsRows}</div>
          </div>
        </div>`;
    }).join("");

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      flashHint("تعذّر فتح نافذة الطباعة — اسمح بالنوافذ المنبثقة");
      return;
    }
    const doc = printWindow.document;
    doc.open();
    doc.write([
      '<!DOCTYPE html>',
      '<html lang="ar" dir="rtl">',
      '<head>',
      '<meta charset="UTF-8">',
      '<title></title>',
      '<link rel="preconnect" href="https://fonts.googleapis.com">',
      '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
      '<link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800&display=swap" rel="stylesheet">',
      '<style>',
      '@page { size: A4 portrait; margin: 0; }',
      '* { margin: 0; padding: 0; box-sizing: border-box; }',
      'body { font-family: "Tajawal", Arial, sans-serif; color: #000; line-height: 1.4; }',
      // Each patient sheet is a .ps-page — page-break after each
      '.ps-page { padding: 12mm; page-break-after: always; }',
      '.ps-page:last-child { page-break-after: auto; }',
      '.ps-header { border: 2px solid #000; padding: 10px 14px; margin-bottom: 12px; }',
      '.ps-header-row { display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 8px; }',
      '.ps-header-cell { font-size: 13px; font-weight: 700; line-height: 1.6; }',
      '.ps-header-cell strong { display: block; font-size: 14px; font-weight: 800; margin-bottom: 2px; }',
      '.ps-body { display: grid; grid-template-columns: 50% 50%; gap: 12px; min-height: 230mm; }',
      '.ps-vs-col { border: 1.5px solid #000; padding: 10px; }',
      '.ps-labs-section { font-size: 13px; line-height: 1.5; }',
      '.ps-labs-title { font-size: 13px; font-weight: 800; margin-bottom: 6px; text-decoration: underline; }',
      '.ps-lab-row { display: flex; justify-content: space-between; padding: 3px 0; }',
      '.ps-lab-label { font-weight: 700; }',
      '.ps-lab-val { font-weight: 800; }',
      '.ps-meds-col { border: 1.5px solid #000; padding: 10px 12px; direction: ltr; text-align: left; }',
      '.ps-med-line { font-size: 16px; font-weight: 700; padding: 6px 0; border-bottom: 1px dashed #ccc; }',
      '.ps-med-line:last-child { border-bottom: none; }',
      '.ps-med-day:empty { display: inline-block; width: 38px; margin-right: 8px; }',
      '.ps-med-day:not(:empty) { display: inline-block; width: 38px; text-align: center; font-size: 14px; font-weight: 800; background: #000; border: 1.5px solid #000; border-radius: 6px; padding: 2px 4px; margin-right: 8px; color: #fff; vertical-align: middle; }',
      '.ps-med-form { display: inline-block; width: 32px; text-align: center; font-size: 12px; font-weight: 800; border-radius: 6px; padding: 2px 4px; margin-right: 8px; vertical-align: middle; background: #fff; border: 1.5px solid #000; color: #000; }',
      '.ps-med-num { font-weight: 700; }',
      '.ps-med-name { font-weight: 700; }',
      '.ps-empty { text-align: center; padding: 20px; color: #999; font-size: 12px; }',
      '@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }',
      '</style>',
      '</head>',
      '<body>',
      pagesHtml,
      '<script>',
      'window.addEventListener("load", function() {',
      '  setTimeout(function() {',
      '    try { window.print(); } catch (e) {}',
      '    setTimeout(function() { try { window.close(); } catch (e) {} }, 1000);',
      '  }, 800);',
      '});',
      '<\/script>',
      '</body>',
      '</html>'
    ].join('\n'));
    doc.close();
  }

  function openSheetFromPatientView() {
    if (!state.currentBed) {
      UI.showView("home");
      flashHint("اختر سريرًا أولًا لإضافة علاج");
      return;
    }
    resetSheet();
    // Render the tabs (auto-picks the first non-empty form as active)
    state.sheet.activeTab = UI.renderSheetTabs(state.medications, state.sheet.activeTab) || "vial";
    UI.renderMedOptions(state.medications, state.sheet.selected, state.sheet.filter, state.sheet.activeTab);
    bindMedOptionCheckboxes();
    syncSelectedUI();
    UI.openSheet();
    state.sheet.open = true;
  }
  function closeSheet() {
    UI.closeSheet();
    state.sheet.open = false;
  }
  function resetSheet() {
    state.sheet.selected.clear();
    state.sheet.selectedList = [];
    state.sheet.filter = "";
    // Default to "vial" — renderSheetTabs will pick a real default
    // (first non-empty form) when the sheet opens.
    state.sheet.activeTab = "vial";
    $("med-search").value = "";
    $("selected-list").innerHTML = "";
    $("sheet-add").disabled = true;
    $("sheet-selected").hidden = true;
    $("selected-count").textContent = "0";
  }

  // Re-bind checkboxes after re-render (preserves checked state from selected set)
  function bindMedOptionCheckboxes() {
    document.querySelectorAll('#med-options input[type="checkbox"]').forEach(cb => {
      cb.checked = state.sheet.selected.has(cb.dataset.medId);
    });
  }

  function addToSelected(id) {
    if (state.sheet.selected.has(id)) return;
    const m = state.medications.find(x => x.id === id);
    if (!m) return;
    state.sheet.selected.add(id);
    state.sheet.selectedList.push({
      id: m.id,
      nameTrade: m.nameTrade,
      nameAr:    m.nameAr,
      nameEn:    m.nameEn,
      form:      m.form || "vial",
      dose: m.defaultDose,
      frequency: m.defaultFrequency
    });
  }
  function removeFromSelected(id) {
    state.sheet.selected.delete(id);
    state.sheet.selectedList = state.sheet.selectedList.filter(s => s.id !== id);
  }
  function syncSelectedUI() {
    const count = state.sheet.selectedList.length;
    $("selected-count").textContent = String(count);
    $("sheet-selected").hidden = count === 0;
    $("sheet-add").disabled = count === 0;
    UI.renderSelectedList(state.sheet.selectedList);
  }

  // -------- Notification sound --------
  // Plays a short notification chime using the Web Audio API.
  // No external audio file is needed — the tone is synthesized in
  // the browser, so it works offline and adds zero bytes to the
  // app's download size.
  //
  // Different notification types get different tones so the user
  // can identify them by ear:
  //   patient_added     → rising 2-tone (C5 → E5) — pleasant "new"
  //   med_changed       → 3-tone arpeggio (E5 → G5 → C6) — busy "change"
  //   patient_discharged → falling 2-tone (G5 → C5) — soft "goodbye"
  //   patient_died      → low single tone (A3) — solemn
  //   default           → single C5 tone
  //
  // The user can disable the sound via the Settings view
  // (pharma.notif-sound localStorage key).
  let _audioCtx = null;
  function _getAudioCtx() {
    if (!_audioCtx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        _audioCtx = new AC();
      } catch (e) { return null; }
    }
    return _audioCtx;
  }

  function _isNotifSoundEnabled() {
    try {
      const v = localStorage.getItem("pharma.notif-sound");
      // Default to enabled if the key is not set (new users get sound).
      // Users who explicitly set "false" disable the sound.
      return v !== "false";
    } catch (e) { return true; }
  }

  // Plays a single tone with a given frequency, duration, and start
  // offset (relative to "now" in the audio context's timeline).
  function _playTone(ctx, freq, startOffset, duration, gain) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    // Smooth envelope: ramp up over 10ms, hold, ramp down over 80ms
    const t0 = ctx.currentTime + startOffset;
    const t1 = t0 + duration;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.setValueAtTime(gain, t1 - 0.08);
    g.gain.linearRampToValueAtTime(0, t1);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t1 + 0.02);
  }

  function playNotificationSound(type) {
    if (!_isNotifSoundEnabled()) return;
    const ctx = _getAudioCtx();
    if (!ctx) return;
    // Some browsers suspend the AudioContext until a user gesture.
    // Try to resume it (this is a no-op if it's already running).
    if (ctx.state === "suspended") {
      try { ctx.resume(); } catch (e) { /* ignore */ }
    }
    // Note frequencies (in Hz):
    //   C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.50, A3 = 220.00
    const TONES = {
      patient_added:      [[523.25, 0.00, 0.12, 0.18], [659.25, 0.12, 0.18, 0.20]],
      med_changed:        [[659.25, 0.00, 0.10, 0.16], [783.99, 0.10, 0.10, 0.16], [1046.50, 0.20, 0.18, 0.18]],
      patient_discharged: [[783.99, 0.00, 0.14, 0.18], [523.25, 0.14, 0.20, 0.18]],
      patient_died:       [[220.00, 0.00, 0.40, 0.20]],
      default:            [[523.25, 0.00, 0.18, 0.20]]
    };
    const seq = TONES[type] || TONES.default;
    seq.forEach(([freq, offset, dur, gain]) => _playTone(ctx, freq, offset, dur, gain));
  }

  // Expose so other parts of the app can play the sound on demand
  // (e.g. when a Supabase Realtime change arrives from another user).
  global._playNotificationSound = playNotificationSound;

  // -------- Notification system --------
  // Creates a notification record and stores it. Called by:
  //   - name input blur (new patient)
  //   - med add/delete (prescription change)
  //   - discharge button
  //   - died button
  // Only triggers if the current user is a doctor (pharmacists don't
  // generate notifications for themselves).
  function pushNotification(type, message, patientName, room) {
    const user = Auth && Auth.getCurrentUser ? Auth.getCurrentUser() : null;
    const isDoctor = Auth && Auth.isDoctor && Auth.isDoctor();
    const isAdmin = Auth && Auth.isAdmin && Auth.isAdmin();
    // Doctors generate patient notifications (med changes, discharge, etc.)
    // Admins receive med_request notifications (from doctors requesting new meds)
    // Pharmacists don't generate notifications for themselves
    if (!isDoctor && type !== "med_request") return;
    if (!isDoctor && !isAdmin && type === "med_request") return;
    const record = {
      type: type,
      message: message,
      patientName: patientName || "",
      room: room || "",
      date: new Date().toISOString(),
      read: false,
      byUser: user ? user.username : "—"
    };
    Storage.addNotification(record);
    updateNotifBadge();
    // Play the notification sound ONLY when a new patient is added
    // or when a new med request arrives (admin needs to hear it).
    if (type === "patient_added" || type === "med_request") {
      playNotificationSound(type);
    }
  }

  function updateNotifBadge() {
    const badge = $("notif-badge");
    if (!badge) return;
    const count = Storage.getUnreadCount();
    if (count > 0) {
      badge.textContent = count > 99 ? "99+" : String(count);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  function renderNotifications() {
    const list = $("notif-list");
    if (!list) return;
    list.innerHTML = "";
    const notifications = Storage.loadNotifications();
    if (notifications.length === 0) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">🔔</div><p>لا توجد إشعارات</p></div>`;
    }
    const typeIcons = {
      patient_added: "➕",
      med_changed: "💊",
      patient_discharged: "🚪",
      patient_died: "⚠️",
      med_request: "💊"
    };
    notifications.forEach((n, i) => {
      const icon = typeIcons[n.type] || "🔔";
      const dateStr = new Date(n.date).toLocaleString("ar", {
        dateStyle: "short", timeStyle: "short"
      });
      const row = document.createElement("div");
      row.className = "notif-row" + (n.read ? "" : " notif-unread");
      row.innerHTML = `
        <div class="notif-icon">${icon}</div>
        <div class="notif-content">
          <div class="notif-message">${escapeHtml(n.message)}</div>
          <div class="notif-meta">${dateStr} · بواسطة ${escapeHtml(n.byUser)}</div>
        </div>
        ${!n.read ? '<div class="notif-dot"></div>' : ''}
      `;
      row.addEventListener("click", () => {
        Storage.markNotificationRead(i);
        renderNotifications();
        updateNotifBadge();
      });
      list.appendChild(row);
    });
    // Show/hide the "clear all" button — admin only
    const clearBtn = $("notif-clear-all-btn");
    if (clearBtn) {
      const isAdmin = Auth && Auth.isAdmin();
      clearBtn.hidden = !(isAdmin && notifications.length > 0);
    }
  }

  // -------- Open a patient --------
  // -------- Discharged / Dead patients view --------
  let _dischargedTab = "discharged";

  function renderDischargedView() {
    const discharged = Storage.loadDischarged();
    const dead = Storage.loadDead();
    const dc = $("discharged-count");
    const dd = $("dead-count");
    if (dc) dc.textContent = discharged.length;
    if (dd) dd.textContent = dead.length;
    // Default to the first tab (discharged)
    document.querySelectorAll(".discharged-tab").forEach(t => {
      t.classList.toggle("active", t.dataset.tab === _dischargedTab);
    });
    // Show/hide the "clear all" button — admin only
    const clearBtn = $("discharged-clear-all-btn");
    if (clearBtn) {
      const isAdmin = Auth && Auth.isAdmin();
      const count = _dischargedTab === "dead" ? dead.length : discharged.length;
      clearBtn.hidden = !(isAdmin && count > 0);
    }
    renderDischargedList(_dischargedTab);
  }

  function renderDischargedList(tab) {
    _dischargedTab = tab || "discharged";
    const list = $("discharged-list");
    if (!list) return;
    list.innerHTML = "";

    const records = tab === "dead"
      ? Storage.loadDead()
      : Storage.loadDischarged();

    if (records.length === 0) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">⌕</div><p>لا يوجد مرضى في هذه القائمة</p></div>`;
      return;
    }

    const isAdmin = Auth && Auth.isAdmin();

    records.forEach((r, i) => {
      const date = r.dischargedAt || r.diedAt || "";
      const dateStr = date
        ? new Date(date).toLocaleDateString("ar", { year: "numeric", month: "short", day: "numeric" })
        : "—";
      const medCount = (r.medications || []).length;
      // Show the final diagnosis if present (discharged patients only —
      // dead patients have no final diagnosis field).
      const finalDx = (r.finalDiagnosis && String(r.finalDiagnosis).trim())
        ? String(r.finalDiagnosis).trim()
        : "";
      const admissionDx = (r.diagnosis && String(r.diagnosis).trim())
        ? String(r.diagnosis).trim()
        : "";
      const row = document.createElement("div");
      row.className = "discharged-row" + (finalDx ? " has-final-dx" : "");
      row.innerHTML = `
        <div class="discharged-row-head">
          <div class="discharged-row-name">${escapeHtml(r.name || "—")}</div>
          <div class="discharged-row-date">${dateStr}</div>
        </div>
        <div class="discharged-row-meta">
          <span>غرفة ${r.roomNumber || "—"} · سرير ${r.bedNumber || "—"}</span>
          ${r.plateNumber ? `<span>· طبلة ${escapeHtml(r.plateNumber)}</span>` : ""}
          ${r.doctor ? `<span>· ${escapeHtml(r.doctor)}</span>` : ""}
          ${medCount ? `<span>· ${medCount} دواء</span>` : ""}
        </div>
        ${finalDx ? `<div class="discharged-row-final-dx"><span class="dx-label">التشخيص النهائي:</span> <span class="dx-value">${escapeHtml(finalDx)}</span></div>` : ""}
        ${(!finalDx && admissionDx) ? `<div class="discharged-row-dx"><span class="dx-label">التشخيص:</span> <span class="dx-value">${escapeHtml(admissionDx)}</span></div>` : ""}
        ${isAdmin ? `<div style="margin-top:6px;text-left:left;">
          <button type="button" data-del-idx="${i}" style="padding:4px 10px;background:#FEF2F2;color:#DC2626;border:1px solid #FECACA;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;">🗑 حذف هذا السجل</button>
        </div>` : ""}
      `;
      list.appendChild(row);
    });
    // Bind per-record delete buttons (admin only)
    if (isAdmin) {
      list.querySelectorAll("button[data-del-idx]").forEach(btn => {
        btn.addEventListener("click", () => {
          const idx = parseInt(btn.dataset.delIdx, 10);
          if (isNaN(idx)) return;
          if (!confirm("هل تريد حذف هذا السجل؟")) return;
          if (_dischargedTab === "dead") {
            Storage.deleteDead(idx);
          } else {
            Storage.deleteDischarged(idx);
          }
          renderDischargedView();
          flashHint("تم حذف السجل");
        });
      });
    }
  }

  // -------- Antibiotic + Albumin monitoring --------
  // Scans all occupied patients for antibiotic + albumin medications
  // and displays them in two tables. No separate database — reads
  // directly from state.patients each time the view is opened.

  // Known antibiotic IDs (from the medication catalog)
  const ANTIBIOTIC_IDS = [
    "ceftriaxone", "vancomycin", "meropenem", "amoxclav",
    "amoxycillin-500", "ceftazidime-1g", "ciprofloxacin-200",
    "flagyl-500", "fucidin"
  ];
  // Known albumin IDs
  const ALBUMIN_IDS = ["human-albumin-20"];

  // -------- View saved ABX snapshots --------
  // Shows a list of saved monthly snapshots. Clicking one expands
  // it to show the antibiotic + albumin tables for that month.
  let _expandedSnapshot = -1;

  function renderAbxSnapshots() {
    const abxTable = $("abx-antibiotics-table");
    const albTable = $("abx-albumin-table");
    const statsEl = $("abx-stats");
    if (!abxTable || !albTable) return;

    const snapshots = Storage.loadAbxSnapshots();

    // Show the list of snapshots in the stats area + clear the tables
    if (statsEl) {
      if (snapshots.length === 0) {
        statsEl.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:14px;">لا توجد نسخ محفوظة بعد — اضغط «حفظ نسخة شهرية» لحفظ الوضع الحالي</div>`;
      } else {
        statsEl.innerHTML = snapshots.map((s, i) => `
          <div class="abx-snapshot-card" data-idx="${i}">
            <div class="abx-snapshot-head">
              <div class="abx-snapshot-month">${escapeHtml(s.monthLabel)}</div>
              <div class="abx-snapshot-meta">${s.abxCount} مضاد · ${s.albCount} ألبومين · ${s.totalPatients} مريض</div>
            </div>
            <div class="abx-snapshot-meta2">حفظ: ${new Date(s.date).toLocaleDateString("ar", { dateStyle: "short" })} · بواسطة ${escapeHtml(s.savedBy)}</div>
            <button class="abx-snapshot-view-btn" data-idx="${i}" type="button">عرض</button>
            <button class="abx-snapshot-del-btn" data-idx="${i}" type="button">حذف</button>
          </div>
        `).join("");
        // Bind view + delete buttons
        statsEl.querySelectorAll(".abx-snapshot-view-btn").forEach(btn => {
          btn.addEventListener("click", () => {
            const idx = parseInt(btn.dataset.idx, 10);
            expandAbxSnapshot(idx);
          });
        });
        statsEl.querySelectorAll(".abx-snapshot-del-btn").forEach(btn => {
          btn.addEventListener("click", () => {
            const idx = parseInt(btn.dataset.idx, 10);
            if (!confirm("حذف هذه النسخة؟")) return;
            Storage.deleteAbxSnapshot(idx);
            renderAbxSnapshots();
            flashHint("تم حذف النسخة");
          });
        });
      }
    }

    // Clear the tables (they'll be filled when a snapshot is expanded)
    abxTable.innerHTML = "";
    albTable.innerHTML = "";
    // Hide section titles when showing snapshots list
    const abxSection = abxTable.closest(".abx-section");
    const albSection = albTable.closest(".abx-section");
    if (snapshots.length === 0) {
      if (abxSection) abxSection.style.display = "none";
      if (albSection) albSection.style.display = "none";
    } else {
      if (abxSection) abxSection.style.display = "";
      if (albSection) albSection.style.display = "";
    }
  }

  function expandAbxSnapshot(idx) {
    const snapshots = Storage.loadAbxSnapshots();
    const s = snapshots[idx];
    if (!s) return;
    const abxTable = $("abx-antibiotics-table");
    const albTable = $("abx-albumin-table");
    if (!abxTable || !albTable) return;

    // Render antibiotic entries
    const abx = s.abxEntries || [];
    if (abx.length === 0) {
      abxTable.innerHTML = `<div class="abx-empty">لا يوجد مضادات حيوية في هذه النسخة</div>`;
    } else {
      abx.sort((a, b) => (a.medName || "").localeCompare(b.medName || ""));
      abxTable.innerHTML = `
        <div class="abx-row abx-row-header">
          <span>المريض</span><span>الغرفة</span><span>الدواء</span>
          <span>الجرعة</span><span>التكرار</span><span>اليوم</span>
        </div>
      ` + abx.map(e => `
        <div class="abx-row">
          <span class="abx-cell-name">${escapeHtml(e.name)}</span>
          <span class="abx-cell-room">غ ${e.room} · س ${e.bed}</span>
          <span class="abx-cell-med">${escapeHtml(e.medName)}</span>
          <span class="abx-cell-dose">${escapeHtml(e.dose || "—")}</span>
          <span class="abx-cell-freq">${escapeHtml(e.freq || "—")}</span>
          <span class="abx-cell-day">${escapeHtml(e.day || "—")}</span>
        </div>`).join("");
    }

    // Render albumin entries
    const alb = s.albEntries || [];
    if (alb.length === 0) {
      albTable.innerHTML = `<div class="abx-empty">لا يوجد ألبومين في هذه النسخة</div>`;
    } else {
      albTable.innerHTML = `
        <div class="abx-row abx-row-header">
          <span>المريض</span><span>الغرفة</span>
          <span>الجرعة</span><span>التكرار</span><span>اليوم</span><span>التشخيص</span>
        </div>
      ` + alb.map(e => `
        <div class="abx-row">
          <span class="abx-cell-name">${escapeHtml(e.name)}</span>
          <span class="abx-cell-room">غ ${e.room} · س ${e.bed}</span>
          <span class="abx-cell-dose">${escapeHtml(e.dose || "—")}</span>
          <span class="abx-cell-freq">${escapeHtml(e.freq || "—")}</span>
          <span class="abx-cell-day">${escapeHtml(e.day || "—")}</span>
          <span class="abx-cell-diag">${escapeHtml(e.diagnosis || "—")}</span>
        </div>`).join("");
    }
    flashHint(`عرض نسخة ${s.monthLabel}`);
  }

  function renderAbxMonitor() {
    const Ward = global.PharmacyWard;
    if (!Ward) return;

    // ---- Day tracking ----
    // For each patient on a critical med (antibiotic or albumin),
    // we track the day number (D1 = first day, D2 = second day, etc.)
    // based on p.firstMedDate — the date the first critical med was
    // prescribed. If the patient doesn't have firstMedDate yet, we
    // set it now (today) → D1.
    //
    // Day number = floor(days between firstMedDate and today) + 1.
    // Example: firstMedDate = 2026-10-01, today = 2026-10-03 → D3
    function computeDayLabel(patient, bedKey) {
      const hasCriticalMed = (patient.medications || []).some(pm =>
        pm && (ANTIBIOTIC_IDS.indexOf(pm.id) !== -1 || ALBUMIN_IDS.indexOf(pm.id) !== -1)
      );
      if (!hasCriticalMed) return "";
      if (!patient.firstMedDate) {
        // First time we see this patient on a critical med → set D1
        patient.firstMedDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        Storage.upsertPatient(bedKey, patient);
        // We don't push to Supabase here (render is read-only);
        // the next persistPatient call will sync it.
      }
      const start = new Date(patient.firstMedDate);
      const now = new Date();
      const diffMs = now.setHours(0, 0, 0, 0) - new Date(start).setHours(0, 0, 0, 0);
      const dayNum = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
      return "D" + Math.max(1, dayNum);
    }

    // Collect all occupied patients with their antibiotic/albumin meds
    const abxEntries = [];
    const albEntries = [];

    Ward.ROOMS.forEach(room => {
      room.beds.forEach(bed => {
        const key = Ward.bedKey(room.id, bed.number);
        const p = state.patients[key];
        if (!p || !p.name || !p.name.trim()) return;

        // Compute day label once per patient
        const dayLabel = computeDayLabel(p, key);

        (p.medications || []).forEach(pm => {
          if (!pm || !pm.id) return;
          const catalog = (state.medications || []).find(m => m && m.id === pm.id);
          const medName = catalog ? (catalog.nameEn || catalog.nameTrade) : (pm.nameEn || pm.nameTrade || pm.id);
          const dose = pm.dose || (catalog ? catalog.defaultDose : "") || "";
          const freq = pm.frequency || (catalog ? catalog.defaultFrequency : "") || "";

          if (ANTIBIOTIC_IDS.indexOf(pm.id) !== -1) {
            abxEntries.push({
              name: p.name.trim(),
              room: room.id,
              bed: bed.number,
              plate: p.plateNumber || "",
              doctor: p.doctor || "",
              diagnosis: p.diagnosis || "",
              day: dayLabel,
              medName, dose, freq, medId: pm.id
            });
          }
          if (ALBUMIN_IDS.indexOf(pm.id) !== -1) {
            albEntries.push({
              name: p.name.trim(),
              room: room.id,
              bed: bed.number,
              plate: p.plateNumber || "",
              doctor: p.doctor || "",
              diagnosis: p.diagnosis || "",
              day: dayLabel,
              medName, dose, freq, medId: pm.id
            });
          }
        });
      });
    });

    // ---- Summary stats ----
    const statsEl = $("abx-stats");
    if (statsEl) {
      const abxPatients = new Set(abxEntries.map(e => e.name + e.room));
      const albPatients = new Set(albEntries.map(e => e.name + e.room));
      const totalPatients = Object.values(state.patients || {})
        .filter(p => p && p.name && p.name.trim()).length;
      statsEl.innerHTML = `
        <div class="abx-stat-card">
          <div class="abx-stat-num">${abxEntries.length}</div>
          <div class="abx-stat-label">مضاد حيوي (جرعة)</div>
        </div>
        <div class="abx-stat-card">
          <div class="abx-stat-num">${abxPatients.size}</div>
          <div class="abx-stat-label">مريض على مضاد حيوي</div>
        </div>
        <div class="abx-stat-card">
          <div class="abx-stat-num">${albEntries.length}</div>
          <div class="abx-stat-label">ألبومين (جرعة)</div>
        </div>
        <div class="abx-stat-card">
          <div class="abx-stat-num">${albPatients.size}</div>
          <div class="abx-stat-label">مريض على ألبومين</div>
        </div>
        <div class="abx-stat-card">
          <div class="abx-stat-num">${totalPatients}</div>
          <div class="abx-stat-label">إجمالي المرضى</div>
        </div>
      `;
    }

    // ---- Antibiotics table ----
    const abxTable = $("abx-antibiotics-table");
    if (abxTable) {
      if (abxEntries.length === 0) {
        abxTable.innerHTML = `<div class="abx-empty">لا يوجد مرضى على مضادات حيوية حالياً</div>`;
      } else {
        // Sort by antibiotic name (group same antibiotics together)
        abxEntries.sort((a, b) => a.medName.localeCompare(b.medName));
        abxTable.innerHTML = `
          <div class="abx-row abx-row-header">
            <span>المريض</span>
            <span>الغرفة</span>
            <span>الدواء</span>
            <span>الجرعة</span>
            <span>التكرار</span>
            <span>اليوم</span>
          </div>
        ` + abxEntries.map(e => `
          <div class="abx-row">
            <span class="abx-cell-name">${escapeHtml(e.name)}</span>
            <span class="abx-cell-room">غ ${e.room} · س ${e.bed}</span>
            <span class="abx-cell-med">${escapeHtml(e.medName)}</span>
            <span class="abx-cell-dose">${escapeHtml(e.dose || "—")}</span>
            <span class="abx-cell-freq">${escapeHtml(e.freq || "—")}</span>
            <span class="abx-cell-day">${escapeHtml(e.day || "—")}</span>
          </div>
        `).join("");
      }
    }

    // ---- Albumin table ----
    const albTable = $("abx-albumin-table");
    if (albTable) {
      if (albEntries.length === 0) {
        albTable.innerHTML = `<div class="abx-empty">لا يوجد مرضى على ألبومين حالياً</div>`;
      } else {
        albTable.innerHTML = `
          <div class="abx-row abx-row-header">
            <span>المريض</span>
            <span>الغرفة</span>
            <span>الجرعة</span>
            <span>التكرار</span>
            <span>اليوم</span>
            <span>التشخيص</span>
          </div>
        ` + albEntries.map(e => `
          <div class="abx-row">
            <span class="abx-cell-name">${escapeHtml(e.name)}</span>
            <span class="abx-cell-room">غ ${e.room} · س ${e.bed}</span>
            <span class="abx-cell-dose">${escapeHtml(e.dose || "—")}</span>
            <span class="abx-cell-freq">${escapeHtml(e.freq || "—")}</span>
            <span class="abx-cell-day">${escapeHtml(e.day || "—")}</span>
            <span class="abx-cell-diag">${escapeHtml(e.diagnosis || "—")}</span>
          </div>
        `).join("");
      }
    }
  }

  function openPatient({ key, roomId, bed }) {
    // Flush any pending changes from the previously-open patient
    // (if any) BEFORE switching to the new one. This ensures the
    // gender toggle / lab values on the previous patient are saved
    // before we overwrite state.currentBed with the new bed key.
    flushPendingPatientChanges();
    state.currentBed = { key, roomId, bed };
    const p = state.patients[key] || null;
    UI.renderPatientView(p, roomId, bed);
    UI.showView("patient");
    // Hide the per-patient print button for pharmacists — only
    // admin + doctor can print individual patient sheets.
    const printBtn = $("print-patient-sheet-btn");
    if (printBtn) {
      const isDoctor = Auth && Auth.isDoctor && Auth.isDoctor();
      const isAdmin = Auth && Auth.isAdmin && Auth.isAdmin();
      printBtn.hidden = !(isAdmin || isDoctor);
    }
    // Diagnosis field: editable by doctors + admins only.
    // Pharmacists see it (read-only) so they can read the diagnosis
    // but not modify it.
    const diagnosisInput = $("patient-diagnosis-input");
    if (diagnosisInput) {
      const isDoctor = Auth && Auth.isDoctor && Auth.isDoctor();
      const isAdmin = Auth && Auth.isAdmin && Auth.isAdmin();
      diagnosisInput.disabled = !(isAdmin || isDoctor);
    }
    // Lab fields: same access control as diagnosis (doctors + admins)
    document.querySelectorAll(".lab-input").forEach(el => {
      const isDoctor = Auth && Auth.isDoctor && Auth.isDoctor();
      const isAdmin = Auth && Auth.isAdmin && Auth.isAdmin();
      el.disabled = !(isAdmin || isDoctor);
    });
    document.querySelectorAll(".lab-add-btn").forEach(btn => {
      const isDoctor = Auth && Auth.isDoctor && Auth.isDoctor();
      const isAdmin = Auth && Auth.isAdmin && Auth.isAdmin();
      btn.hidden = !(isAdmin || isDoctor);
    });
  }

  // -------- Lightweight toast (no extra DOM) --------
  let hintTimer = null;
  function flashHint(msg) {
    let t = $("app-hint");
    if (!t) {
      t = document.createElement("div");
      t.id = "app-hint";
      t.style.cssText = `
        position:fixed;
        left:50%; top: calc(env(safe-area-inset-top, 0px) + 16px);
        transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.92);
        color:#fff;
        padding: 10px 18px;
        border-radius: 999px;
        font-size: 13px;
        font-weight: 700;
        z-index: 200;
        box-shadow: 0 4px 14px rgba(15,23,42,0.30);
        pointer-events: none;
        opacity: 0;
        transition: opacity 180ms ease, transform 180ms ease;
      `;
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => {
      t.style.opacity = "1";
      t.style.transform = "translateX(-50%) translateY(0)";
    });
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { t.style.opacity = "0"; }, 2200);
  }

  // -------- Seniors (الأخصائيون) view --------
  // Groups occupied patients by their attending physician (patient.doctor
  // field) and displays each physician with their patient list.
  // Called from the bottom-nav click handler when user taps the
  // 'seniors' tab. Tab visibility is controlled separately by
  // applySeniorsNavVisibility() (admin + doctor roles only).
  function renderSeniorsView() {
    const list = $("seniors-list");
    if (!list) return;
    list.innerHTML = "";

    const Ward = global.PharmacyWard;
    if (!Ward) return;

    // Group occupied patients by their attending physician
    const groups = {};  // doctorName -> [patient, patient, ...]
    Ward.ROOMS.forEach(room => {
      room.beds.forEach(bed => {
        const key = Ward.bedKey(room.id, bed.number);
        const p = state.patients[key];
        if (!p || !p.name || !p.name.trim()) return;
        const doctor = (p.doctor && p.doctor.trim())
          ? p.doctor.trim()
          : "بدون طبيب معالج";
        if (!groups[doctor]) groups[doctor] = [];
        groups[doctor].push({
          name: p.name.trim(),
          room: room.id,
          bed: bed.number,
          plate: p.plateNumber || "",
          age: p.age || "",
          gender: p.gender || "",
          diagnosis: p.diagnosis || "",
          medCount: (p.medications || []).length
        });
      });
    });

    const doctorNames = Object.keys(groups).sort();

    // Show empty state only when there are no patients at all OR
    // the only "doctor" is the placeholder for unassigned patients.
    if (doctorNames.length === 0
        || (doctorNames.length === 1 && doctorNames[0] === "بدون طبيب معالج")) {
      list.innerHTML = `<div class="empty-state"><div class="empty-icon">👤</div><p>لا يوجد أطباء أخصائيون بعد</p><span>عند تحديد الطبيب المعالج للمرضى سيظهر هنا</span></div>`;
      return;
    }

    doctorNames.forEach(doctor => {
      const patients = groups[doctor];
      const card = document.createElement("div");
      card.className = "senior-card";
      let html = `
        <div class="senior-card-head">
          <div class="senior-name">${escapeHtml(doctor)}</div>
          <div class="senior-count">${patients.length} مريض</div>
        </div>
        <div class="senior-patients">
      `;
      patients.forEach(p => {
        const meta = [
          "غرفة " + p.room,
          "سرير " + p.bed,
          p.plate ? "طبلة " + p.plate : "",
          p.age ? "العمر " + p.age : "",
          p.gender === "male" ? "ذكر" : (p.gender === "female" ? "أنثى" : ""),
          p.diagnosis ? escapeHtml(p.diagnosis) : "",
          p.medCount + " دواء"
        ].filter(Boolean).join(" · ");
        html += `
          <div class="senior-patient-row">
            <span class="senior-patient-name">${escapeHtml(p.name)}</span>
            <span class="senior-patient-meta">${meta}</span>
          </div>
        `;
      });
      html += `</div>`;
      card.innerHTML = html;
      list.appendChild(card);
    });
  }

  // -------- Boot --------
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

})(window);
