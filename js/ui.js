/* ============================================================
   ui.js
   Pure rendering helpers. No state of its own — everything
   pulls from PharmacyStorage or is passed in by app.js.
   ============================================================ */

(function (global) {
  "use strict";

  const h = (tag, props = {}, children = []) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") el.className = v;
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k === "attrs") for (const [a, av] of Object.entries(v)) el.setAttribute(a, av);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "html") el.innerHTML = v;
      else if (v !== undefined && v !== null) el.setAttribute(k, v);
    }
    if (Array.isArray(children)) {
      children.forEach(c => {
        if (c == null) return;
        if (typeof c === "string" || typeof c === "number") el.appendChild(document.createTextNode(String(c)));
        else el.appendChild(c);
      });
    } else if (typeof children === "string") {
      el.textContent = children;
    }
    return el;
  };

  // ---------- Display name helpers ----------
  // PRIMARY name = nameTrade (falls back to nameAr then nameEn then "—")
  function primaryName(m) {
    if (!m) return "—";
    return m.nameTrade || m.nameAr || m.nameEn || "—";
  }
  // SECONDARY name = scientific (nameEn). Always shown when set,
  // even if it happens to equal the trade name. This is intentional:
  // the user wants the scientific name visible at all times so they
  // can confirm the active substance on the printed patient list.
  function scientificName(m) {
    if (!m) return "";
    const en = m.nameEn || "";
    return en;
  }

  // ---------- Dashboard stats ----------
  function renderStats(patientsMap) {
    let patientCount = 0;
    let medCount = 0;
    for (const p of Object.values(patientsMap)) {
      if (p && p.name && p.name.trim()) patientCount++;
      if (p && Array.isArray(p.medications)) medCount += p.medications.length;
    }
    document.getElementById("stat-patients").textContent = patientCount;
    document.getElementById("stat-meds").textContent = medCount;
    document.getElementById("stat-beds").textContent = global.PharmacyWard.TOTAL_BEDS;
  }

  // ---------- Bed status helper ----------
  function bedStatus(patient) {
    if (!patient || !patient.name || !patient.name.trim()) return "empty";
    const hasMeds = Array.isArray(patient.medications) && patient.medications.length > 0;
    return hasMeds ? "meds" : "occupied";
  }

  // ---------- Corridor map ----------
  // Renders the ward as a long vertical corridor with rooms on one side.
  // - A "entrance" marker at the top indicates where you walk in
  // - A vertical line (the corridor) runs down the side
  // - Room cards are positioned along the corridor
  //   - Rooms 1-5 (split-3-3): when you enter the room, 3 beds on the
  //     right + 3 beds on the left
  //   - Rooms 6-10 (linear-4): 4 beds in a row
  function renderRooms(patientsMap) {
    const container = document.getElementById("rooms-grid");
    container.innerHTML = "";

    // Entrance marker
    container.appendChild(h("div", { class: "corridor-entrance" }, [
      h("span", { class: "entrance-icon" }, "↓"),
      h("span", { class: "entrance-label" }, "مدخل الردهة")
    ]));

    // The corridor itself: vertical line on the left + room cards
    const corridor = h("div", { class: "corridor" });

    global.PharmacyWard.ROOMS.forEach(room => {
      const occupied = room.beds.filter(b => {
        const p = patientsMap[global.PharmacyWard.bedKey(room.id, b.number)];
        return p && p.name && p.name.trim();
      }).length;

      // Build the beds grid per room layout
      let bedsArea;
      if (room.layout === "split-3-3") {
        // 3 beds on right + 3 beds on left (inside the room)
        const right = room.beds.filter(b => b.side === "right");
        const left  = room.beds.filter(b => b.side === "left");
        bedsArea = h("div", { class: "room-beds split-3-3" }, [
          h("div", { class: "beds-col beds-right" },
            right.map(b => bedButton(room, b, patientsMap))),
          // Door / entrance indicator between the two columns
          h("div", { class: "beds-door", title: "باب الغرفة" }, "🚪"),
          h("div", { class: "beds-col beds-left" },
            left.map(b => bedButton(room, b, patientsMap)))
        ]);
      } else {
        // linear-4: 4 beds in a row
        bedsArea = h("div", { class: "room-beds linear-4" },
          room.beds.map(b => bedButton(room, b, patientsMap)));
      }

      const roomCard = h("div", {
        class: "room-card layout-" + room.layout,
        dataset: { roomId: room.id }
      }, [
        h("div", { class: "room-head" }, [
          h("div", { class: "room-title" }, [
            h("span", { class: "room-num" }, "غرفة " + room.id),
            h("span", { class: "room-beds-count" }, room.bedCount + " أسرّة")
          ]),
          h("span", { class: "room-occ" }, occupied + " / " + room.bedCount + " مشغول")
        ]),
        bedsArea
      ]);
      corridor.appendChild(roomCard);
    });

    container.appendChild(corridor);
  }

  // Helper: build a single bed button
  function bedButton(room, bed, patientsMap) {
    const key = global.PharmacyWard.bedKey(room.id, bed.number);
    const patient = patientsMap[key] || null;
    const status = bedStatus(patient);
    return h("button", {
      class: `bed-btn state-${status}`,
      dataset: { roomId: room.id, bed: bed.number, key: key },
      type: "button"
    }, [
      h("span", { class: "bed-icon" }),
      h("span", { class: "bed-num" }, "سرير " + bed.number),
      h("span", { class: "bed-state" })
    ]);
  }

  // ---------- Patient view ----------
  function renderPatientView(patient, roomId, bedNumber) {
    document.getElementById("loc-room").textContent = "غرفة " + roomId;
    document.getElementById("loc-bed").textContent  = "سرير " + bedNumber;

    const nameInput = document.getElementById("patient-name-input");
    nameInput.value = (patient && patient.name) ? patient.name : "";

    const medsList = document.getElementById("meds-list");
    const emptyMeds = document.getElementById("empty-meds");
    medsList.innerHTML = "";

    const meds = (patient && Array.isArray(patient.medications)) ? patient.medications : [];

    if (meds.length === 0) {
      medsList.hidden = true;
      emptyMeds.hidden = false;
    } else {
      medsList.hidden = false;
      emptyMeds.hidden = true;
      meds.forEach((m, idx) => medsList.appendChild(renderMedCard(m, idx)));
    }
  }

  // med card (in patient view) — editable dose + frequency
  function renderMedCard(med, index) {
    const freqOptions = global.PharmacyMedications.FREQUENCIES;
    const isCustomFreq = !freqOptions.includes(med.frequency);

    const doseInput = h("input", {
      type: "text",
      value: med.dose || "",
      placeholder: "الجرعة",
      dataset: { medIndex: index, field: "dose" },
      autocomplete: "off"
    });

    let freqSelect;
    if (isCustomFreq) {
      // include the custom value as a first option
      freqSelect = h("select", { dataset: { medIndex: index, field: "frequency" } }, [
        h("option", { value: med.frequency, selected: "selected" }, med.frequency),
        ...freqOptions.map(f => h("option", { value: f }, f))
      ]);
    } else {
      freqSelect = h("select", { dataset: { medIndex: index, field: "frequency" } },
        freqOptions.map(f => h("option", { value: f, selected: f === med.frequency ? "selected" : undefined }, f))
      );
    }

    const sci = scientificName(med);
    const nameBlock = h("div", {}, [
      h("div", { class: "med-name" }, primaryName(med)),
      sci ? h("div", { class: "med-name-en" }, sci) : null
    ]);

    return h("div", { class: "med-card", dataset: { medIndex: index } }, [
      h("div", { class: "med-card-head" }, [
        nameBlock,
        h("button", {
          class: "med-del",
          type: "button",
          dataset: { medIndex: index, action: "delete-med" },
          title: "حذف"
        }, "✕")
      ]),
      h("div", { class: "med-fields" }, [
        h("div", { class: "med-field" }, [
          h("label", {}, "الجرعة"),
          doseInput
        ]),
        h("div", { class: "med-field" }, [
          h("label", {}, "التكرار"),
          freqSelect
        ])
      ])
    ]);
  }

  // ---------- Patients list view ----------
  function renderPatientsList(patientsMap) {
    const container = document.getElementById("patients-list");
    const empty = document.getElementById("empty-patients");
    container.innerHTML = "";

    const all = Object.entries(patientsMap)
      .map(([key, p]) => ({ key, ...p }))
      .filter(p => p && p.name && p.name.trim());

    if (all.length === 0) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    all.forEach(p => {
      const match = p.key.match(/room-(\d+)-bed-(\d+)/) || [];
      const roomId = match[1] ? parseInt(match[1], 10) : null;
      const bedNum = match[2] ? parseInt(match[2], 10) : null;
      const hasMeds = Array.isArray(p.medications) && p.medications.length > 0;
      const initial = (p.name || "").trim().charAt(0) || "؟";

      const row = h("div", {
        class: "patient-row" + (hasMeds ? " has-meds" : ""),
        dataset: { roomId: roomId, bed: bedNum, key: p.key }
      }, [
        h("div", { class: "pr-avatar" }, initial),
        h("div", { class: "pr-info" }, [
          h("div", { class: "pr-name" }, p.name),
          h("div", { class: "pr-loc" }, `غرفة ${roomId} · سرير ${bedNum}`)
        ]),
        hasMeds
          ? h("div", { class: "pr-meds" }, p.medications.length + " علاج")
          : h("div", { class: "pr-meds", style: "background:var(--warning-soft);color:var(--warning);" }, "بدون علاج")
      ]);
      container.appendChild(row);
    });
  }

  // ---------- Medication bottom-sheet ----------
  // Renders ONLY medications matching the active tab's form (no section header).
  // The caller passes `activeTab` ("vial" | "tablet") to choose which form to show.
  // Tab counts for both forms are also updated so the user sees totals at all times.
  function renderMedOptions(meds, selectedIds, filterText, activeTab) {
    const container = document.getElementById("med-options");
    container.innerHTML = "";

    // Update tab counts on every render (across all tabs)
    updateTabCounts(meds);

    // Resolve the active tab — must be one of the known forms, else "vial"
    const VALID_FORMS = ["vial", "ampule", "prefilled-syringe", "tablet", "supplies"];
    const tab = VALID_FORMS.indexOf(activeTab) !== -1 ? activeTab : "vial";

    const q = (filterText || "").trim().toLowerCase();
    // Filter: must match active tab's form AND search query (if any)
    let filtered = meds.filter(m => (m.form || "vial") === tab);
    if (q) {
      filtered = filtered.filter(m =>
        (m.nameTrade || "").toLowerCase().includes(q) ||
        (m.nameAr || "").toLowerCase().includes(q) ||
        (m.nameEn || "").toLowerCase().includes(q));
    }

    if (filtered.length === 0) {
      // Find another form that has meds to suggest as an alternative
      const FORM_ORDER = (global.PharmacyMedications && global.PharmacyMedications.FORM_ORDER) || ["vial", "tablet"];
      const FORM_LABELS = (global.PharmacyMedications && global.PharmacyMedications.FORM_LABELS) || {};
      const otherFormsWithMeds = FORM_ORDER
        .filter(f => f !== tab)
        .filter(f => meds.some(m => (m.form || "vial") === f));
      const curTabLabel = FORM_LABELS[tab] || tab;

      const hintChildren = [
        h("div", { style: "font-size:28px;margin-bottom:8px;color:var(--text-faint);font-weight:800;" }, "⌕"),
        h("div", {}, q
          ? `لا توجد نتائج مطابقة في ${curTabLabel}.`
          : `لا توجد أدوية في ${curTabLabel}.`)
      ];

      // Show one clickable link per alternative form
      otherFormsWithMeds.forEach(otherKey => {
        const otherLabel = FORM_LABELS[otherKey] || otherKey;
        hintChildren.push(h("div", {
          style: "margin-top:8px;color:var(--primary);font-weight:800;cursor:pointer;text-decoration:underline;",
          onclick: () => {
            const otherBtn = document.querySelector(`.sheet-tab[data-tab="${otherKey}"]`);
            if (otherBtn) otherBtn.click();
          }
        }, `جرّب ${otherLabel} ←`));
      });

      const hintEl = h("div", {
        style: "text-align:center;padding:24px 16px;color:var(--text-muted);font-weight:600;font-size:13px;line-height:1.6;"
      }, hintChildren);
      container.appendChild(hintEl);
      return;
    }

    // Render meds (no section header — the tab itself is the header)
    filtered.forEach(m => {
      const id = "med-opt-" + m.id;
      const checked = selectedIds.has(m.id);
      const sci = scientificName(m);
      const metaParts = [];
      if (sci) metaParts.push(sci);
      if (m.defaultDose) metaParts.push(m.defaultDose);
      if (m.defaultFrequency) metaParts.push(m.defaultFrequency);
      container.appendChild(
        h("label", { class: "med-option", for: id }, [
          h("input", {
            type: "checkbox",
            id: id,
            dataset: { medId: m.id },
            checked: checked ? "checked" : undefined
          }),
          h("div", { class: "med-option-body" }, [
            h("div", { class: "med-option-name" }, primaryName(m)),
            h("div", { class: "med-option-meta" },
              metaParts.length ? metaParts.join(" · ") : "—")
          ])
        ])
      );
    });
  }

  // Render the form tab buttons dynamically based on FORM_ORDER.
  // Only show tabs for forms that actually have medications (skip empty).
  // The first non-empty form (in FORM_ORDER) becomes the default active tab.
  function renderSheetTabs(meds, activeTab) {
    const container = document.getElementById("sheet-tabs");
    if (!container) return;
    container.innerHTML = "";

    const FORM_ORDER = (global.PharmacyMedications && global.PharmacyMedications.FORM_ORDER) || ["vial", "tablet"];
    const FORM_LABELS = (global.PharmacyMedications && global.PharmacyMedications.FORM_LABELS) || {};
    const FORM_ICONS = (global.PharmacyMedications && global.PharmacyMedications.FORM_ICONS) || {};

    // Count meds per form
    const counts = {};
    meds.forEach(m => {
      const f = m.form || "vial";
      counts[f] = (counts[f] || 0) + 1;
    });

    // Filter FORM_ORDER to forms that have at least 1 med (always show
    // all 5 if user wants, but with empty count = 0 we still show them
    // so the user can switch to see "no meds" hint)
    const formsToShow = FORM_ORDER.filter(f => counts[f] > 0);
    if (formsToShow.length === 0) formsToShow.push(FORM_ORDER[0] || "vial");

    // Decide active tab: keep current if it's in the list, otherwise
    // use the first non-empty form.
    let active = (activeTab && formsToShow.indexOf(activeTab) !== -1)
      ? activeTab
      : formsToShow[0];

    formsToShow.forEach(form => {
      const isActive = (form === active);
      container.appendChild(h("button", {
        class: "sheet-tab" + (isActive ? " active" : ""),
        type: "button",
        role: "tab",
        "aria-selected": isActive ? "true" : "false",
        dataset: { tab: form }
      }, [
        h("span", { class: "sheet-tab-icon", "aria-hidden": "true" }, FORM_ICONS[form] || "•"),
        h("span", { class: "sheet-tab-label" }, FORM_LABELS[form] || form),
        h("span", { class: "sheet-tab-count", dataset: { formCount: form } }, String(counts[form] || 0))
      ]));
    });

    return active;  // Return the resolved active tab so caller knows
  }

  // Update the small counter on each tab button (# per form)
  function updateTabCounts(meds) {
    const FORM_ORDER = (global.PharmacyMedications && global.PharmacyMedications.FORM_ORDER) || ["vial", "tablet"];
    const counts = {};
    FORM_ORDER.forEach(f => counts[f] = 0);
    meds.forEach(m => {
      const f = m.form || "vial";
      counts[f] = (counts[f] || 0) + 1;
    });
    document.querySelectorAll(".sheet-tab-count").forEach(el => {
      const f = el.dataset.formCount;
      if (f && f in counts) el.textContent = String(counts[f]);
    });
  }

  // Update active tab styling on the tab buttons
  function setActiveTabUI(activeTab) {
    document.querySelectorAll(".sheet-tab").forEach(btn => {
      const isActive = btn.dataset.tab === activeTab;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
  }

  // selected meds visual-only list inside the sheet.
  // Each row shows:
  //   - medication name (display only — NOT editable)
  //   - 6 squares visualizing the dose frequency
  //     (filled = dose time, empty = no dose, special = custom freq like 'حسب القياس')
  //   - dose text + frequency text
  //   - delete button (to remove from selection)
  // The user can still edit dose + frequency AFTER adding the med
  // to the patient (in the patient view).
  function parseFrequencyCount(freq) {
    if (!freq) return 0;
    // Match patterns like "1×3", "1x4", "1 × 2", "2×3", etc.
    const m = freq.match(/×\s*(\d+)/);
    if (m) {
      const n = parseInt(m[1], 10);
      return isNaN(n) ? 0 : n;
    }
    // Custom / non-numeric frequencies ("حسب القياس", "حسب البروتوكول", ...)
    return -1;
  }

  // Renders a -/+ stepper to control the dose frequency (1×N).
  // Behavior:
  //   - tap "+"  → frequency increases by 1 (max 12)
  //   - tap "-"  → frequency decreases by 1 (min 1, can't go to 1×0)
  //   - if frequency is custom (e.g. "حسب القياس"), the number cell shows
  //     "مخصص" instead of N, and tapping + or - switches to numeric (1×1 / 1×2)
  // The +/- buttons and the number are all in one row.
  function renderFreqStepper(freq) {
    const count = parseFrequencyCount(freq);
    const isCustom = (count === -1);
    // Display: numeric count (e.g. 3 → shown as "1×3" → just "3" here) or "مخصص"
    const displayNumber = isCustom ? "مخصص" : String(count || 0);

    return h("div", {
      class: "freq-stepper",
      role: "group",
      "aria-label": `التكرار: ${freq || "—"}`,
      title: `التكرار: ${freq || "—"} — اضغط + أو - للتعديل`
    }, [
      h("button", {
        type: "button",
        class: "freq-step-btn minus",
        dataset: { action: "freq-decrement" },
        title: "تقليل التكرار بمقدار 1",
        "aria-label": "تقليل التكرار"
      }, "−"),
      h("span", {
        class: "freq-step-number" + (isCustom ? " is-custom" : ""),
        "aria-live": "polite"
      }, displayNumber),
      h("button", {
        type: "button",
        class: "freq-step-btn plus",
        dataset: { action: "freq-increment" },
        title: "زيادة التكرار بمقدار 1",
        "aria-label": "زيادة التكرار"
      }, "+")
    ]);
  }

  function renderSelectedList(selected) {
    const container = document.getElementById("selected-list");
    container.innerHTML = "";
    if (selected.length === 0) return;

    selected.forEach((m, idx) => {
      container.appendChild(
        h("div", { class: "sel-item", dataset: { selIndex: idx } }, [
          h("div", { class: "sel-item-head" }, [
            h("div", { class: "sel-item-name" }, primaryName(m)),
            h("button", {
              class: "sel-item-del",
              type: "button",
              dataset: { selIndex: idx, action: "del-selected" }
            }, "✕")
          ]),
          // Stepper row: - / + buttons with frequency count in the middle,
          // plus the dose on the same row for compactness.
          h("div", { class: "sel-item-controls" }, [
            h("span", { class: "sel-item-dose" }, m.dose || "—"),
            renderFreqStepper(m.frequency),
            h("span", { class: "sel-item-freq" }, m.frequency || "—")
          ])
        ])
      );
    });
  }

  // ---------- Sheet visibility ----------
  function openSheet() {
    const sheet = document.getElementById("med-sheet");
    const overlay = document.getElementById("sheet-overlay");
    overlay.hidden = false;
    sheet.hidden = false;
    // force reflow to ensure transition fires
    void sheet.offsetWidth;
    sheet.classList.add("open");
    sheet.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  function closeSheet() {
    const sheet = document.getElementById("med-sheet");
    const overlay = document.getElementById("sheet-overlay");
    sheet.classList.remove("open");
    sheet.setAttribute("aria-hidden", "true");
    setTimeout(() => {
      sheet.hidden = true;
      overlay.hidden = true;
    }, 260);
    document.body.style.overflow = "";
  }

  // ---------- View switching ----------
  function showView(name) {
    const views = document.querySelectorAll(".view");
    views.forEach(v => {
      v.hidden = v.dataset.view !== name;
    });
    document.querySelectorAll(".nav-item").forEach(n => {
      n.classList.toggle("active", n.dataset.nav === name);
    });
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  // ---------- Admin: medication catalog list ----------
  function renderAdminMedList(meds, selectedId) {
    const container = document.getElementById("admin-med-list");
    container.innerHTML = "";
    document.getElementById("admin-count").textContent = String(meds.length);

    if (meds.length === 0) {
      container.appendChild(h("div", {
        style: "text-align:center;padding:20px;color:var(--text-muted);font-weight:600;font-size:13px;"
      }, "لا توجد أدوية. اضغط «دواء جديد» للبدء."));
      return;
    }

    meds.forEach((m, idx) => {
      const isFirst = idx === 0;
      const isLast  = idx === meds.length - 1;
      const sci = scientificName(m);
      const metaParts = [];
      if (sci) metaParts.push(sci);
      if (m.defaultDose) metaParts.push(m.defaultDose);
      if (m.defaultFrequency) metaParts.push(m.defaultFrequency);

      const FORM_LABELS = (global.PharmacyMedications && global.PharmacyMedications.FORM_LABELS) || {};
      const formKey = (m.form && FORM_LABELS[m.form]) ? m.form : "vial";
      const formLabel = FORM_LABELS[formKey] || formKey;
      const formClass = "admin-form-badge is-" + formKey;

      const row = h("div", {
        class: "admin-med-row" + (selectedId === m.id ? " selected" : ""),
        dataset: { medId: m.id }
      }, [
        h("div", { class: "admin-med-pos", title: "ترتيب الظهور في قائمة الاختيار" }, String(idx + 1)),
        h("div", { class: "admin-med-info" }, [
          h("div", { class: "admin-med-name" }, [
            primaryName(m),
            h("span", { class: formClass, title: "الشكل الدوائي" }, formLabel)
          ]),
          h("div", { class: "admin-med-meta" },
            metaParts.length ? metaParts.join(" · ") : "—")
        ]),
        h("div", { class: "admin-med-actions" }, [
          h("button", {
            class: "admin-ico-btn move top",
            type: "button",
            dataset: { medId: m.id, action: "move-top" },
            title: "نقل للأعلى (أول القائمة)",
            disabled: isFirst ? "disabled" : undefined
          }, "⤒"),
          h("button", {
            class: "admin-ico-btn move up",
            type: "button",
            dataset: { medId: m.id, action: "move-up" },
            title: "تحريك لأعلى",
            disabled: isFirst ? "disabled" : undefined
          }, "↑"),
          h("button", {
            class: "admin-ico-btn move down",
            type: "button",
            dataset: { medId: m.id, action: "move-down" },
            title: "تحريك لأسفل",
            disabled: isLast ? "disabled" : undefined
          }, "↓"),
          h("button", {
            class: "admin-ico-btn move bottom",
            type: "button",
            dataset: { medId: m.id, action: "move-bottom" },
            title: "نقل للأسفل (آخر القائمة)",
            disabled: isLast ? "disabled" : undefined
          }, "⤓"),
          h("button", {
            class: "admin-ico-btn edit",
            type: "button",
            dataset: { medId: m.id, action: "edit-med" },
            title: "تعديل"
          }, "✎"),
          h("button", {
            class: "admin-ico-btn del",
            type: "button",
            dataset: { medId: m.id, action: "del-med" },
            title: "حذف"
          }, "✕")
        ])
      ]);
      container.appendChild(row);
    });
  }

  // ---------- Admin: show/hide editor form ----------
  function showAdminForm(med, isNew) {
    const card = document.getElementById("admin-form-card");
    const empty = document.getElementById("admin-empty");
    empty.hidden = true;
    card.hidden = false;
    document.getElementById("admin-form-title").textContent =
      isNew ? "إضافة دواء جديد" : "تعديل دواء";

    const nameTrade = document.getElementById("adm-name-trade");
    const nameAr = document.getElementById("adm-name-ar");
    const nameEn = document.getElementById("adm-name-en");
    const form   = document.getElementById("adm-form");
    const dose   = document.getElementById("adm-dose");
    const freq   = document.getElementById("adm-freq");
    const freqWrap = document.getElementById("adm-freq-custom-wrap");
    const freqCustom = document.getElementById("adm-freq-custom");

    nameTrade.value = med.nameTrade || "";
    nameAr.value    = med.nameAr || "";
    nameEn.value    = med.nameEn || "";
    // Set form dropdown: fall back to "vial" if form is unknown/empty
    const VALID_FORMS = ["vial", "ampule", "prefilled-syringe", "tablet", "supplies"];
    const formVal = VALID_FORMS.indexOf(med.form) !== -1 ? med.form : "vial";
    form.value = formVal;
    dose.value      = med.defaultDose || "";

    const freqOptions = global.PharmacyMedications.FREQUENCIES;
    const isStandard = freqOptions.includes(med.defaultFrequency);
    if (isStandard || !med.defaultFrequency) {
      freq.value = med.defaultFrequency || "1×1";
      freqWrap.hidden = true;
      freqCustom.value = "";
    } else {
      freq.value = "custom";
      freqWrap.hidden = false;
      freqCustom.value = med.defaultFrequency;
    }
  }
  function hideAdminForm() {
    document.getElementById("admin-form-card").hidden = true;
    document.getElementById("admin-empty").hidden = false;
    ["adm-name-trade", "adm-name-ar", "adm-name-en", "adm-dose", "adm-freq-custom"].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = "";
    });
    document.getElementById("adm-form").value = "vial";
    document.getElementById("adm-freq").value = "1×1";
    document.getElementById("adm-freq-custom-wrap").hidden = true;
  }
  function toggleAdminFreqCustom() {
    const freq = document.getElementById("adm-freq").value;
    document.getElementById("adm-freq-custom-wrap").hidden = freq !== "custom";
  }

  // ---------- Admin: read form into med object ----------
  function readAdminForm() {
    const nameTrade = document.getElementById("adm-name-trade").value.trim();
    const nameAr = document.getElementById("adm-name-ar").value.trim();
    const nameEn = document.getElementById("adm-name-en").value.trim();
    const form   = document.getElementById("adm-form").value;
    const dose   = document.getElementById("adm-dose").value.trim();
    const freqSel = document.getElementById("adm-freq").value;
    const freqCustom = document.getElementById("adm-freq-custom").value.trim();
    const frequency = freqSel === "custom" ? freqCustom : freqSel;
    const VALID_FORMS = ["vial", "ampule", "prefilled-syringe", "tablet", "supplies"];

    return {
      nameTrade: nameTrade,
      nameAr:    nameAr,
      nameEn:    nameEn,
      form:      VALID_FORMS.indexOf(form) !== -1 ? form : "vial",
      defaultDose:      dose,
      defaultFrequency: frequency
    };
  }

  // ---------- Print Chart (التشارت) ----------
  // Builds a printable matrix (table) where:
  //   - Rows  = patients (only occupied beds), rightmost column = patient names
  //   - Cols  = medications (only those prescribed to at least one patient)
  //   - Cell at (patient_i, med_j) = the count of doses/day if the patient
  //     has that medication, else empty
  // The matrix is sorted by room+bed for patients, and by sort_order for meds.
  // Header is a small editable text field where the pharmacist writes the
  // ward/floor info and date by hand (no title, no totals, no footer).
  function buildChartReport(patientsMap, meds) {
    const root = document.getElementById("chart-print-root");
    root.innerHTML = "";

    if (!Array.isArray(meds) || meds.length === 0) {
      root.appendChild(h("div", {
        style: "text-align:center;padding:40px;color:#999;font-size:14px;"
      }, "لا توجد أدوية في الكتالوج"));
      return;
    }
    if (!patientsMap || typeof patientsMap !== "object") {
      root.appendChild(h("div", {
        style: "text-align:center;padding:40px;color:#999;font-size:14px;"
      }, "لا يوجد مرضى مسجلون"));
      return;
    }

    // Build the list of occupied beds (room-N-bed-M → patient)
    const Ward = global.PharmacyWard;
    const occupiedRows = [];
    Ward.ROOMS.forEach(room => {
      room.beds.forEach(bed => {
        const key = Ward.bedKey(room.id, bed.number);
        const p = patientsMap[key];
        if (p && p.name && p.name.trim()) {
          occupiedRows.push({
            key: key,
            roomId: room.id,
            bedNum: bed.number,
            name: p.name.trim(),
            medications: Array.isArray(p.medications) ? p.medications : []
          });
        }
      });
    });

    if (occupiedRows.length === 0) {
      root.appendChild(h("div", {
        style: "text-align:center;padding:40px;color:#999;font-size:14px;"
      }, "لا توجد أسرّة مشغولة بعد"));
      return;
    }

    // Sort patients by room then bed
    occupiedRows.sort((a, b) =>
      (a.roomId - b.roomId) || (a.bedNum - b.bedNum));

    // ----- Filter medications: only show those prescribed to at least one
    // patient. This saves huge horizontal space (e.g., 59 catalog meds →
    // only 5-10 columns when only those are prescribed). -----
    const prescribedIds = new Set();
    occupiedRows.forEach(p => {
      p.medications.forEach(pm => {
        if (pm && pm.id) prescribedIds.add(pm.id);
      });
    });
    const orderedMeds = meds.filter(m => prescribedIds.has(m.id));

    // ----- Editable header (pharmacist fills by hand) -----
    // Two side-by-side fields: "الطابق/الوحدة" + "التاريخ"
    // (Also available on screen, but only rendered when printing)
    root.appendChild(h("div", { class: "chart-editable-header" }, [
      h("div", { class: "chart-editable-field" }, [
        h("span", { class: "chart-editable-label" }, "الطابق / الوحدة: "),
        h("span", { class: "chart-editable-blank" }, "____________________")
      ]),
      h("div", { class: "chart-editable-field" }, [
        h("span", { class: "chart-editable-label" }, "التاريخ: "),
        h("span", { class: "chart-editable-blank" }, "________________")
      ])
    ]));

    // ----- Matrix table -----
    const table = h("table", { class: "chart-matrix" });

    // --- Header row: first cell = "اسم المريض", then one cell per prescribed med
    const thead = h("thead", {});
    const headRow = h("tr", {});
    headRow.appendChild(h("th", { class: "chart-patient-col-header" }, "اسم المريض"));
    orderedMeds.forEach(m => {
      const label = m.nameTrade || m.nameAr || m.nameEn || m.id;
      headRow.appendChild(h("th", {
        class: "chart-med-col-header",
        title: label + (m.nameEn ? " (" + m.nameEn + ")" : "")
      }, [
        h("div", { class: "chart-med-label" }, label)
      ]));
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    // --- Body rows: one per patient
    const tbody = h("tbody", {});
    occupiedRows.forEach((p) => {
      const myMedCounts = {};
      p.medications.forEach(pm => {
        const match = (pm.frequency || "").match(/×\s*(\d+)/);
        const n = match ? parseInt(match[1], 10) : 0;
        myMedCounts[pm.id] = { count: n, freq: pm.frequency || "" };
      });

      const tr = h("tr", {});
      // Patient label cell (rightmost)
      tr.appendChild(h("td", { class: "chart-patient-cell" }, [
        h("div", { class: "chart-patient-name" }, p.name),
        h("div", { class: "chart-patient-loc" }, `غ ${p.roomId} · س ${p.bedNum}`)
      ]));

      // One cell per prescribed medication
      orderedMeds.forEach(m => {
        const entry = myMedCounts[m.id];
        let cellText = "";
        let cellClass = "chart-cell";
        if (entry) {
          if (entry.count > 0) {
            cellText = String(entry.count);
          } else {
            // Custom freq (e.g. "حسب القياس") — show raw text
            cellText = entry.freq || "؟";
            cellClass += " chart-cell-custom";
          }
        }
        tr.appendChild(h("td", { class: cellClass }, cellText));
      });

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    root.appendChild(table);

    // ----- NO footer (user asked to save space) -----
  }

  global.PharmacyUI = {
    h,
    renderStats,
    renderRooms,
    renderPatientView,
    renderPatientsList,
    renderMedOptions,
    renderSelectedList,
    openSheet,
    closeSheet,
    showView,
    bedStatus,
    // admin
    renderAdminMedList,
    showAdminForm,
    hideAdminForm,
    toggleAdminFreqCustom,
    readAdminForm,
    // helpers
    primaryName,
    scientificName,
    // sheet tabs
    renderSheetTabs,
    updateTabCounts,
    setActiveTabUI,
    // chart
    buildChartReport
  };
})(window);
