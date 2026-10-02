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

  // ---------- Icon helper ----------
  // If the icon value starts with "img:", render an <img> element.
  // Otherwise, render a <span> with the emoji text.
  function makeIcon(iconValue) {
    if (typeof iconValue === "string" && iconValue.indexOf("img:") === 0) {
      const src = iconValue.slice(4);
      return h("img", {
        src: src,
        alt: "",
        class: "sheet-tab-icon-img"
      });
    }
    return h("span", { class: "sheet-tab-icon", "aria-hidden": "true" }, iconValue);
  }

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
    for (const p of Object.values(patientsMap)) {
      if (p && p.name && p.name.trim()) patientCount++;
    }
    // Update patients-count in the patients view (if visible)
    const pcEl = document.getElementById("patients-count");
    if (pcEl) pcEl.textContent = patientCount;
  }

  // ---------- Bed status helper ----------
  function bedStatus(patient) {
    if (!patient || !patient.name || !patient.name.trim()) return "empty";
    const hasMeds = Array.isArray(patient.medications) && patient.medications.length > 0;
    return hasMeds ? "meds" : "occupied";
  }

  // Detect if a patient has Albumin and/or Meronem prescribed.
  // Used to color the bed button with a split gradient (yellow/red/green)
  // per the user's clinical rule:
  //   - Meronem only    → half red + half green
  //   - Albumin only    → half yellow + half green
  //   - Albumin+Meronem → thirds yellow + red + green
  // Match by id OR by name (case-insensitive) so any user-added
  // variant like 'meronem-500mg' or 'Albumin 25%' is detected.
  function bedSpecialFlags(patient) {
    const flags = { hasAlbumin: false, hasMeronem: false };
    if (!patient || !Array.isArray(patient.medications)) return flags;
    for (const pm of patient.medications) {
      if (!pm) continue;
      const id = (pm.id || "").toLowerCase();
      const name = ((pm.nameTrade || "") + " " + (pm.nameEn || "") + " " + (pm.nameAr || "")).toLowerCase();
      // Albumin: match id or name contains 'albumin' or 'ألبومين'
      if (id.indexOf("albumin") >= 0 || name.indexOf("albumin") >= 0 || name.indexOf("ألبومين") >= 0) {
        flags.hasAlbumin = true;
      }
      // Meronem/Meropenem: match id or name contains 'meronem' or 'meropenem' or 'ميرونيم' or 'ميروبينيم'
      if (
        id.indexOf("meronem") >= 0 || id.indexOf("meropenem") >= 0 ||
        name.indexOf("meronem") >= 0 || name.indexOf("meropenem") >= 0 ||
        name.indexOf("ميرونيم") >= 0 || name.indexOf("ميروبينيم") >= 0
      ) {
        flags.hasMeronem = true;
      }
    }
    return flags;
  }

  // ---------- Rooms grid ----------
  // Renders room cards in a simple grid (no corridor, no entrance,
  // no connector dots — just clean room cards).
  function renderRooms(patientsMap) {
    const container = document.getElementById("rooms-grid");
    container.innerHTML = "";

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
      container.appendChild(roomCard);
    });
  }

  // Helper: build a single bed button
  function bedButton(room, bed, patientsMap) {
    const key = global.PharmacyWard.bedKey(room.id, bed.number);
    const patient = patientsMap[key] || null;
    const status = bedStatus(patient);
    // Bed colors are back to the default (green/yellow/gray).
    // Albumin/Meronem detection is now only used in the patients
    // list view (renderPatientsList) where we show a small yellow
    // badge next to the patient name when they have Albumin.
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

    // Plate number (optional field under the name input)
    const plateInput = document.getElementById("patient-plate-input");
    plateInput.value = (patient && patient.plateNumber) ? String(patient.plateNumber) : "";

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
      // Detect Albumin (yellow dot) and Meronem (red dot) for visual
      // triage in the patients list.
      const flags = bedSpecialFlags(p);
      const hasAlbumin = flags.hasAlbumin;
      const hasMeronem = flags.hasMeronem;
      // Plate number (optional field, shown under the room/bed line
      // if the patient has one)
      const plateNumber = p.plateNumber && String(p.plateNumber).trim()
        ? String(p.plateNumber).trim()
        : "";

      const nameChildren = [p.name];
      if (hasAlbumin) {
        // Small yellow dot next to the name to mark Albumin
        nameChildren.push(h("span", {
          class: "pr-albumin-dot",
          title: "Albumin — يحتاج متابعة"
        }, "●"));
      }
      if (hasMeronem) {
        // Small red dot next to the name to mark Meronem (500mg or 1g)
        nameChildren.push(h("span", {
          class: "pr-meronem-dot",
          title: "Meronem — يحتاج متابعة"
        }, "●"));
      }

      const locChildren = [`غرفة ${roomId} · سرير ${bedNum}`];
      if (plateNumber) {
        locChildren.push(h("span", { class: "pr-plate" }, " · طبلة " + plateNumber));
      }

      const rowCls =
        "patient-row" +
        (hasMeds ? " has-meds" : "") +
        (hasAlbumin ? " has-albumin" : "") +
        (hasMeronem ? " has-meronem" : "");
      const row = h("div", {
        class: rowCls,
        dataset: { roomId: roomId, bed: bedNum, key: p.key }
      }, [
        h("div", { class: "pr-avatar" }, initial),
        h("div", { class: "pr-info" }, [
          h("div", { class: "pr-name" }, nameChildren),
          h("div", { class: "pr-loc" }, locChildren)
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
    const VALID_FORMS = ["vial", "ampule", "prefilled-syringe", "tablet", "syrup-and-oral-drop", "suppository", "solution", "supplies"];
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
        makeIcon(FORM_ICONS[form] || "•"),
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
          // Single row: name | dose | -/+ | delete — all on one line
          h("div", { class: "sel-item-row" }, [
            h("div", { class: "sel-item-name" }, primaryName(m)),
            h("span", { class: "sel-item-dose" }, m.dose || "—"),
            renderFreqStepper(m.frequency),
            h("button", {
              class: "sel-item-del",
              type: "button",
              dataset: { selIndex: idx, action: "del-selected" },
              title: "حذف"
            }, "✕")
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

    // Group meds by their form (vial / ampule / tablet / syrup / ...).
    // We use the FORM_ORDER from medications.js so the sections appear
    // in a fixed, predictable order (the same order as the sheet tabs).
    // Within each section, the meds keep their original relative order
    // from the `meds` array — this preserves the catalog's sort_order
    // so move-up/move-down still work as before.
    const Meds = global.PharmacyMedications || {};
    const FORM_LABELS = Meds.FORM_LABELS || {};
    const FORM_ORDER  = Meds.FORM_ORDER || ["vial", "ampule", "prefilled-syringe", "tablet", "syrup-and-oral-drop", "suppository", "solution", "supplies"];

    // Group: bucket each med into its form group (using 'vial' as
    // fallback for unknown/legacy forms).
    const groups = {};
    FORM_ORDER.forEach(form => { groups[form] = []; });
    meds.forEach(m => {
      const formKey = (m.form && FORM_LABELS[m.form]) ? m.form : "vial";
      if (!groups[formKey]) groups[formKey] = []; // unknown form → its own bucket
      groups[formKey].push(m);
    });

    // Render each non-empty group with a section header.
    // We keep a running index across all groups so the "position"
    // badge on each row still reflects the med's position in the
    // full catalog (1-based), matching what the chart and the
    // bottom-sheet selection see. Move-up/move-down use the actual
    // index in the underlying `meds` array (passed via the med's id),
    // not the visible position, so they keep working.
    let runningIdx = 0;
    FORM_ORDER.forEach(form => {
      const bucket = groups[form];
      if (!Array.isArray(bucket) || bucket.length === 0) return;
      const formLabel = FORM_LABELS[form] || form;

      // Section header — sticky so it stays visible when scrolling
      // a long list of meds within one form.
      const header = h("div", {
        class: "admin-med-section-header admin-form-badge is-" + form
      }, [
        h("span", { class: "admin-med-section-name" }, formLabel),
        h("span", { class: "admin-med-section-count" }, bucket.length + " دواء")
      ]);
      container.appendChild(header);

      bucket.forEach((m) => {
        const idx = runningIdx;
        const isFirst = idx === 0;
        const isLast  = idx === meds.length - 1;
        const sci = scientificName(m);
        const metaParts = [];
        if (sci) metaParts.push(sci);
        if (m.defaultDose) metaParts.push(m.defaultDose);
        if (m.defaultFrequency) metaParts.push(m.defaultFrequency);

        const formKey = (m.form && FORM_LABELS[m.form]) ? m.form : "vial";
        const formLabelInner = FORM_LABELS[formKey] || formKey;
        const formClass = "admin-form-badge is-" + formKey;

        const row = h("div", {
          class: "admin-med-row" + (selectedId === m.id ? " selected" : ""),
          dataset: { medId: m.id }
        }, [
          h("div", { class: "admin-med-pos", title: "ترتيب الظهور في قائمة الاختيار" }, String(idx + 1)),
          h("div", { class: "admin-med-info" }, [
            h("div", { class: "admin-med-name" }, [
              primaryName(m),
              h("span", { class: formClass, title: "الشكل الدوائي" }, formLabelInner)
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
        runningIdx++;
      });
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
    const VALID_FORMS = ["vial", "ampule", "prefilled-syringe", "tablet", "syrup-and-oral-drop", "suppository", "solution", "supplies"];
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
    const VALID_FORMS = ["vial", "ampule", "prefilled-syringe", "tablet", "syrup-and-oral-drop", "suppository", "solution", "supplies"];

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
  // Auto-pagination: 35 patients per page, header + med columns repeat.
  function buildChartReport(patientsMap, meds, supplyDistribution) {
    const root = document.getElementById("chart-print-root");
    root.innerHTML = "";

    if (!Array.isArray(meds) || meds.length === 0) {
      root.appendChild(h("div", {
        style: "text-align:center;padding:40px;color:#999;font-size:14px;"
      }, "لا توجد أدوية في الكتالوج"));
      return;
    }

    const PATIENTS_PER_PAGE = 35;
    const MED_COLS = 50;

    const Ward = global.PharmacyWard;
    const occupiedRows = [];
    if (patientsMap && typeof patientsMap === "object") {
      Ward.ROOMS.forEach(room => {
        room.beds.forEach(bed => {
          const key = Ward.bedKey(room.id, bed.number);
          const p = patientsMap[key];
          if (p && p.name && p.name.trim()) {
            // IMPORTANT: deep-copy the patient's medications array so
            // the random-supply injection below doesn't mutate the
            // actual stored data. The chart only sees a temporary
            // snapshot; localStorage and state.patients stay clean.
            //
            // ALSO: filter out any legacy 'syringe-5cc' entries that
            // might still be on the patient from before this update
            // (when 5cc was auto-managed + stored on the patient).
            // They're now injected at print-time only, so we drop the
            // stale stored copies here to avoid duplicates.
            const medsCopy = (Array.isArray(p.medications) ? p.medications : [])
              .filter(pm => pm && pm.id !== "syringe-5cc") // drop legacy 5cc
              .map(pm => pm && typeof pm === "object" ? Object.assign({}, pm) : pm);
            occupiedRows.push({
              name: p.name.trim(),
              medications: medsCopy
            });
          }
        });
      });
    }

    // -------- Supply distribution (from the Supply Order modal) --------
    // The caller (app.js supply-order-submit) passes a
    // supplyDistribution map: supplyId → { bedKey: freq }.
    // We inject each supply into the corresponding patient's
    // medication list (on the deep-copy, not the stored data).
    // Supplies with no entry in supplyDistribution (or freq=0) are
    // simply not added.
    if (supplyDistribution && typeof supplyDistribution === "object") {
      occupiedRows.forEach(row => {
        // Find this patient's bedKey by matching the name+medications
        // — actually we need the bedKey. Let's store it on the row.
      });
    }

    // We need the bedKey to look up supplyDistribution. Let's
    // re-do the occupiedRows build to include the bedKey.
    // (The original loop above didn't store it. We need to redo
    //  the supply injection using the bedKey.)
    //
    // Actually, let's restructure: pass bedKey into the row.

    // Re-build occupiedRows with bedKey included
    const occupiedRowsWithKey = [];
    {
      const Ward2 = global.PharmacyWard;
      Ward2.ROOMS.forEach(room => {
        room.beds.forEach(bed => {
          const key = Ward2.bedKey(room.id, bed.number);
          const p = patientsMap[key];
          if (p && p.name && p.name.trim()) {
            const medsCopy = (Array.isArray(p.medications) ? p.medications : [])
              .filter(pm => pm && pm.id !== "syringe-5cc")
              .map(pm => pm && typeof pm === "object" ? Object.assign({}, pm) : pm);
            occupiedRowsWithKey.push({
              bedKey: key,
              name: p.name.trim(),
              medications: medsCopy
            });
          }
        });
      });
    }

    // Inject supplies from supplyDistribution
    if (supplyDistribution && typeof supplyDistribution === "object") {
      // For each supplyId in the distribution, look up the catalog
      // entry (for display name/dose). Fall back to hardcoded defaults.
      const findOrDefaults = (id, fallback) => {
        const m = meds.find(x => x && x.id === id);
        return m || fallback;
      };
      const supplyDefaults = {
        "dextrose-saline":   { nameTrade: "G/S", nameAr: "ديكستروز سالين", nameEn: "Glucose Saline", defaultDose: "500 ml" },
        "ringers-lactate":    { nameTrade: "R/L", nameAr: "رينجر لاكتات", nameEn: "Ringer Lactate", defaultDose: "500 ml" },
        "glucose-5":          { nameTrade: "G/W", nameAr: "مغذي سكري 5%", nameEn: "Glucose 5%", defaultDose: "500 ml" },
        "sodium-chloride-09": { nameTrade: "N/S", nameAr: "مغذي ملح 500مل", nameEn: "Normal Saline 500ml", defaultDose: "500 ml" },
        "nacl-100ml":         { nameTrade: "N/S 100ml", nameAr: "مغذي ملح 100مل", nameEn: "NaCl 0.9% 100ml", defaultDose: "100 ml" },
        "iv-set":             { nameTrade: "I.V. Set", nameAr: "خط الإعطاء", nameEn: "I.V. Set", defaultDose: "1 خط" },
        "blood-iv-set":       { nameTrade: "Blood I.V. Set", nameAr: "خط دم", nameEn: "Blood I.V. Set", defaultDose: "1 خط" },
        "cannula":            { nameTrade: "Cannula", nameAr: "كانيولا", nameEn: "Cannula", defaultDose: "1 قطعة" },
        "syringe-5cc":        { nameTrade: "5cc Syringe", nameAr: "سرنجة 5 سي سي", nameEn: "5cc Syringe", defaultDose: "1 سرنجة" },
        "syringe-1cc":        { nameTrade: "1cc Syringe", nameAr: "سرنجة 1 سي سي", nameEn: "1cc Syringe", defaultDose: "1 سرنجة" },
        "syringe-10cc":       { nameTrade: "10cc Syringe", nameAr: "سرنجة 10 سي سي", nameEn: "10cc Syringe", defaultDose: "1 سرنجة" },
        "syringe-20cc":       { nameTrade: "20cc Syringe", nameAr: "سرنجة 20 سي سي", nameEn: "20cc Syringe", defaultDose: "1 سرنجة" },
        "syringe-50cc":       { nameTrade: "50cc Syringe", nameAr: "سرنجة 50 سي سي", nameEn: "50cc Syringe", defaultDose: "1 سرنجة" },
        "urine-bag":          { nameTrade: "Urine Bag", nameAr: "كيس إدرار", nameEn: "Urine Bag", defaultDose: "1 كيس" },
        "ng-tube-14":         { nameTrade: "NG Tube 14", nameAr: "أنبوب تغذية 14", nameEn: "NG Tube 14", defaultDose: "1 قطعة" },
        "floy-14":            { nameTrade: "Foley 14", nameAr: "قسطرة فولي 14", nameEn: "Foley 14", defaultDose: "1 قطعة" }
      };

      Object.keys(supplyDistribution).forEach(supplyId => {
        const dist = supplyDistribution[supplyId];
        if (!dist || typeof dist !== "object") return;
        const defaults = supplyDefaults[supplyId] || { nameTrade: supplyId, nameAr: "", nameEn: supplyId, defaultDose: "" };
        const med = findOrDefaults(supplyId, defaults);

        occupiedRowsWithKey.forEach(row => {
          const freq = dist[row.bedKey];
          if (freq && freq > 0) {
            row.medications.push({
              id:        supplyId,
              nameTrade: med.nameTrade || defaults.nameTrade,
              nameAr:    med.nameAr || defaults.nameAr || "",
              nameEn:    med.nameEn || defaults.nameEn || "",
              form:      "supplies",
              dose:      (med.defaultDose || defaults.defaultDose) || "",
              frequency: "1×" + freq
            });
          }
        });
      });
    }

    // Replace occupiedRows with the enriched version
    occupiedRows.length = 0;
    occupiedRowsWithKey.forEach(r => occupiedRows.push(r));

    const prescribedIds = new Set();
    occupiedRows.forEach(p => {
      p.medications.forEach(pm => {
        if (pm && pm.id) prescribedIds.add(pm.id);
      });
    });
    // prescribedMeds = catalog meds that are prescribed. PLUS any
    // injected random supplies that aren't in the catalog (e.g. user
    // deleted syringe-1cc / iv-set but we still injected them with
    // fallback defaults). We add those fallbacks so their columns
    // appear in the chart.
    const prescribedMeds = meds.filter(m => prescribedIds.has(m.id));
    // Find any prescribed ids that aren't in the catalog, and
    // synthesize catalog-like entries for them from the injected
    // rows (so they get a column header in the chart).
    const catalogIds = new Set(meds.map(m => m && m.id).filter(Boolean));
    const missingFromCatalog = [];
    prescribedIds.forEach(id => {
      if (!catalogIds.has(id)) {
        // Find the first injected row that has this id and use its
        // metadata as the column header source.
        for (const row of occupiedRows) {
          const found = (row.medications || []).find(pm => pm && pm.id === id);
          if (found) {
            missingFromCatalog.push({
              id:        found.id,
              nameTrade: found.nameTrade,
              nameAr:    found.nameAr    || "",
              nameEn:    found.nameEn    || "",
              form:      found.form      || "supplies"
            });
            break;
          }
        }
      }
    });
    const allPrescribedMeds = prescribedMeds.concat(missingFromCatalog);

    // Prioritize the auto-injected supplies so they always get a
    // column in the chart. Without this, a catalog with 50+
    // prescribed meds could fill the 50-column limit before reaching
    // the supplies at the end (and the user would see "NaCl 100ml"
    // and "Cannula" missing from the chart).
    //
    // The user asked for the supplies to appear at the END of the
    // chart (after all regular medications), not at the beginning.
    // So we take the first (MED_COLS - N_priority) regular meds,
    // then append the priority supplies. This guarantees:
    //   1. Supplies always get a column (reserved slots at the end)
    //   2. Supplies appear after all other meds
    const PRIORITY_SUPPLY_IDS = [
      "dextrose-saline", "ringers-lactate", "glucose-5", "sodium-chloride-09",
      "nacl-100ml", "iv-set", "blood-iv-set", "cannula",
      "syringe-5cc", "syringe-1cc", "syringe-10cc", "syringe-20cc", "syringe-50cc",
      "urine-bag", "ng-tube-14", "floy-14"
    ];
    // Split: priority supplies (for counting), then the rest in
    // catalog order.
    const priorityBucket = [];
    const restBucket = [];
    allPrescribedMeds.forEach(m => {
      if (m && PRIORITY_SUPPLY_IDS.indexOf(m.id) !== -1) {
        priorityBucket.push(m);
      } else {
        restBucket.push(m);
      }
    });
    // Sort priority bucket by the PRIORITY_SUPPLY_IDS order so they
    // appear in the chart in a predictable, stable order.
    priorityBucket.sort((a, b) => {
      return PRIORITY_SUPPLY_IDS.indexOf(a.id) - PRIORITY_SUPPLY_IDS.indexOf(b.id);
    });
    // Reserve the last N slots for priority supplies, fill the rest
    // with regular meds (up to MED_COLS - N_priority).
    const numPriority = priorityBucket.length;
    const maxRegular = Math.max(0, MED_COLS - numPriority);
    const regularToFit = restBucket.slice(0, maxRegular);
    const ordered = regularToFit.concat(priorityBucket);
    const orderedMeds = [];
    for (let i = 0; i < MED_COLS; i++) {
      orderedMeds.push(ordered[i] || null);
    }

    const numPages = Math.max(1, Math.ceil(occupiedRows.length / PATIENTS_PER_PAGE));

    for (let page = 0; page < numPages; page++) {
      const startIdx = page * PATIENTS_PER_PAGE;
      const pagePatients = occupiedRows.slice(startIdx, startIdx + PATIENTS_PER_PAGE);

      const pageDiv = h("div", { class: "chart-page" + (page > 0 ? " chart-page-break" : "") });
      const table = h("table", { class: "chart-matrix" });

      const thead = h("thead", {});
      const headRow = h("tr", {});
      headRow.appendChild(h("th", { class: "chart-patient-col-header" }, [
        h("center", {}, [
          h("div", {}, "الطابق الثامن"),
          h("div", {}, "الوحدة الخامسة")
        ])
      ]));
      orderedMeds.forEach(m => {
        if (!m) {
          headRow.appendChild(h("th", { class: "chart-med-col-header chart-med-empty" }, ""));
          return;
        }
        const label = m.nameTrade || m.nameAr || m.nameEn || m.id;
        headRow.appendChild(h("th", {
          class: "chart-med-col-header",
          title: label + (m.nameEn ? " (" + m.nameEn + ")" : "")
        }, [
          h("center", {}, [
            h("div", { class: "chart-med-label" }, label)
          ])
        ]));
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = h("tbody", {});
      for (let i = 0; i < PATIENTS_PER_PAGE; i++) {
        const p = pagePatients[i];
        const tr = h("tr", {});

        const patientName = (p && p.name) ? p.name : "";
        tr.appendChild(h("td", { class: "chart-patient-cell" }, [
          h("center", {}, patientName)
        ]));

        let myMedCounts = null;
        if (p && Array.isArray(p.medications) && p.medications.length > 0) {
          myMedCounts = {};
          p.medications.forEach(pm => {
            const match = (pm.frequency || "").match(/×\s*(\d+)/);
            const n = match ? parseInt(match[1], 10) : 0;
            myMedCounts[pm.id] = { count: n, freq: pm.frequency || "" };
          });
        }

        orderedMeds.forEach(m => {
          let cellText = "";
          let cellClass = "chart-cell";
          if (!m) {
            tr.appendChild(h("td", { class: cellClass }, ""));
            return;
          }
          if (myMedCounts) {
            const entry = myMedCounts[m.id];
            if (entry) {
              if (entry.count > 0) {
                cellText = String(entry.count);
              } else {
                cellText = entry.freq || "؟";
                cellClass += " chart-cell-custom";
              }
            }
          }
          tr.appendChild(h("td", { class: cellClass }, cellText));
        });

        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      pageDiv.appendChild(table);
      root.appendChild(pageDiv);
    }
    // No return value — the user requested no flashHint message after
    // the random distribution, so we don't need to surface stats to
    // the caller.
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
