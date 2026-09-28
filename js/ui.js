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

  // ---------- Room card ----------
  function renderRooms(patientsMap) {
    const container = document.getElementById("rooms-grid");
    container.innerHTML = "";

    global.PharmacyWard.ROOMS.forEach(room => {
      const occupied = room.beds.filter(b => {
        const p = patientsMap[global.PharmacyWard.bedKey(room.id, b)];
        return p && p.name && p.name.trim();
      }).length;

      const bedsGrid = h("div", { class: `beds-grid cols-${room.bedCount}` });

      room.beds.forEach(bed => {
        const key = global.PharmacyWard.bedKey(room.id, bed);
        const patient = patientsMap[key] || null;
        const status = bedStatus(patient);
        const btn = h("button", {
          class: `bed-btn state-${status}`,
          dataset: { roomId: room.id, bed: bed, key: key },
          type: "button"
        }, [
          h("span", { class: "bed-icon" }),
          h("span", { class: "bed-num" }, "سرير " + bed),
          h("span", { class: "bed-state" })
        ]);
        bedsGrid.appendChild(btn);
      });

      const card = h("div", { class: "room-card" }, [
        h("div", { class: "room-head" }, [
          h("div", { class: "room-title" }, [
            h("span", { class: "room-num" }, "غرفة " + room.id),
            h("span", { class: "room-beds-count" }, room.bedCount + " أسرّة")
          ]),
          h("span", { class: "room-occ" }, occupied + " / " + room.bedCount + " مشغول")
        ]),
        bedsGrid
      ]);
      container.appendChild(card);
    });
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

    return h("div", { class: "med-card", dataset: { medIndex: index } }, [
      h("div", { class: "med-card-head" }, [
        h("div", {}, [
          h("div", { class: "med-name" }, med.nameAr || med.nameEn || med.name),
          med.nameEn && med.nameAr
            ? h("div", { class: "med-name-en" }, med.nameEn)
            : null
        ]),
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
  function renderMedOptions(meds, selectedIds, filterText) {
    const container = document.getElementById("med-options");
    container.innerHTML = "";

    const q = (filterText || "").trim().toLowerCase();
    const filtered = q
      ? meds.filter(m =>
          (m.nameAr || "").toLowerCase().includes(q) ||
          (m.nameEn || "").toLowerCase().includes(q))
      : meds;

    if (filtered.length === 0) {
      container.appendChild(h("div", {
        style: "text-align:center;padding:20px;color:var(--text-muted);font-weight:600;"
      }, "لا توجد نتائج مطابقة"));
      return;
    }

    filtered.forEach(m => {
      const id = "med-opt-" + m.id;
      const checked = selectedIds.has(m.id);
      container.appendChild(
        h("label", { class: "med-option", for: id }, [
          h("input", {
            type: "checkbox",
            id: id,
            dataset: { medId: m.id },
            checked: checked ? "checked" : undefined
          }),
          h("div", { class: "med-option-body" }, [
            h("div", { class: "med-option-name" }, m.nameAr),
            h("div", { class: "med-option-meta" },
              `${m.nameEn} · ${m.defaultDose} · ${m.defaultFrequency}`)
          ])
        ])
      );
    });
  }

  // selected meds editable list inside the sheet
  function renderSelectedList(selected) {
    const container = document.getElementById("selected-list");
    container.innerHTML = "";
    if (selected.length === 0) return;

    const freqOptions = global.PharmacyMedications.FREQUENCIES;

    selected.forEach((m, idx) => {
      const isCustomFreq = !freqOptions.includes(m.frequency);
      const freqSelect = isCustomFreq
        ? h("select", { dataset: { selIndex: idx, field: "frequency" } }, [
            h("option", { value: m.frequency, selected: "selected" }, m.frequency),
            ...freqOptions.map(f => h("option", { value: f }, f))
          ])
        : h("select", { dataset: { selIndex: idx, field: "frequency" } },
            freqOptions.map(f => h("option", { value: f, selected: f === m.frequency ? "selected" : undefined }, f))
          );

      container.appendChild(
        h("div", { class: "sel-item", dataset: { selIndex: idx } }, [
          h("div", { class: "sel-item-head" }, [
            h("div", { class: "sel-item-name" }, m.nameAr),
            h("button", {
              class: "sel-item-del",
              type: "button",
              dataset: { selIndex: idx, action: "del-selected" }
            }, "✕")
          ]),
          h("div", { class: "med-fields" }, [
            h("div", { class: "med-field" }, [
              h("label", {}, "الجرعة"),
              h("input", {
                type: "text",
                value: m.dose,
                placeholder: "الجرعة",
                dataset: { selIndex: idx, field: "dose" },
                autocomplete: "off"
              })
            ]),
            h("div", { class: "med-field" }, [
              h("label", {}, "التكرار"),
              freqSelect
            ])
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

    meds.forEach(m => {
      const row = h("div", {
        class: "admin-med-row" + (selectedId === m.id ? " selected" : ""),
        dataset: { medId: m.id }
      }, [
        h("div", { class: "admin-med-info" }, [
          h("div", { class: "admin-med-name" }, m.nameAr || m.nameEn || "(بدون اسم)"),
          h("div", { class: "admin-med-meta" },
            `${m.nameEn || "—"} · ${m.defaultDose || "—"} · ${m.defaultFrequency || "—"}`)
        ]),
        h("div", { class: "admin-med-actions" }, [
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

    const nameAr = document.getElementById("adm-name-ar");
    const nameEn = document.getElementById("adm-name-en");
    const dose   = document.getElementById("adm-dose");
    const freq   = document.getElementById("adm-freq");
    const freqWrap = document.getElementById("adm-freq-custom-wrap");
    const freqCustom = document.getElementById("adm-freq-custom");

    nameAr.value = med.nameAr || "";
    nameEn.value = med.nameEn || "";
    dose.value   = med.defaultDose || "";

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
    ["adm-name-ar", "adm-name-en", "adm-dose", "adm-freq-custom"].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = "";
    });
    document.getElementById("adm-freq").value = "1×1";
    document.getElementById("adm-freq-custom-wrap").hidden = true;
  }
  function toggleAdminFreqCustom() {
    const freq = document.getElementById("adm-freq").value;
    document.getElementById("adm-freq-custom-wrap").hidden = freq !== "custom";
  }

  // ---------- Admin: read form into med object ----------
  function readAdminForm() {
    const nameAr = document.getElementById("adm-name-ar").value.trim();
    const nameEn = document.getElementById("adm-name-en").value.trim();
    const dose   = document.getElementById("adm-dose").value.trim();
    const freqSel = document.getElementById("adm-freq").value;
    const freqCustom = document.getElementById("adm-freq-custom").value.trim();
    const frequency = freqSel === "custom" ? freqCustom : freqSel;

    return {
      nameAr:    nameAr,
      nameEn:    nameEn,
      defaultDose:      dose,
      defaultFrequency: frequency
    };
  }

  // ---------- Print: build the patient medication report ----------
  function buildPrintReport(patient, roomId, bedNumber) {
    const root = document.getElementById("print-root");
    root.innerHTML = "";

    const now = new Date();
    const dateStr =
      `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}` +
      ` ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    const meds = (patient && Array.isArray(patient.medications)) ? patient.medications : [];

    // Header
    const header = h("div", { class: "pr-doc-header" }, [
      h("div", {}, [
        h("div", { class: "pr-doc-title" }, "قائمة أدوية المريض"),
        h("p", { class: "pr-doc-sub" }, "إدارة الصيدلية السريرية — الجناح الداخلي")
      ]),
      h("div", { class: "pr-doc-meta" }, [
        h("div", {}, "Date: " + dateStr),
        h("div", { style: "margin-top:2px;" }, "Room " + roomId + " · Bed " + bedNumber)
      ])
    ]);
    root.appendChild(header);

    // Patient card
    root.appendChild(
      h("div", { class: "pr-patient-card" }, [
        h("div", { class: "pr-patient-name" }, patient && patient.name ? patient.name : "(بدون اسم)"),
        h("div", { class: "pr-patient-loc" }, `الغرفة: ${roomId} — السرير: ${bedNumber}`)
      ])
    );

    // Meds table
    root.appendChild(h("div", { class: "pr-section-title" }, "العلاجات المقررة"));

    if (meds.length === 0) {
      root.appendChild(h("p", {
        style: "font-size:13px;color:#64748B;font-weight:600;padding:8px 0;"
      }, "لا توجد علاجات مسجلة لهذا المريض."));
    } else {
      const table = h("table", { class: "pr-meds-table" });
      const thead = h("thead", {}, h("tr", {}, [
        h("th", { style: "width:8%;" }, "#"),
        h("th", { style: "width:42%;" }, "الدواء"),
        h("th", { style: "width:25%;" }, "الجرعة"),
        h("th", { style: "width:25%;" }, "التكرار")
      ]));
      const tbody = h("tbody", {});
      meds.forEach((m, i) => {
        const nameCell = h("td", {}, [
          h("span", { class: "pr-med-name" }, m.nameAr || m.nameEn || m.name || ""),
          m.nameEn && m.nameAr
            ? h("span", { class: "pr-med-name-en" }, m.nameEn)
            : null
        ]);
        tbody.appendChild(h("tr", {}, [
          h("td", {}, String(i + 1)),
          nameCell,
          h("td", {}, m.dose || "—"),
          h("td", {}, m.frequency || "—")
        ]));
      });
      table.appendChild(thead);
      table.appendChild(tbody);
      root.appendChild(table);
    }

    // Footnote
    root.appendChild(h("div", { class: "pr-footnote" },
      "تم إنشاء هذا المستند من تطبيق إدارة الصيدلية السريرية. الجرعات قابلة للتعديل حسب الحالة السريرية وتعليمات الطبيب."));

    // Signatures
    root.appendChild(h("div", { class: "pr-signatures" }, [
      h("div", { class: "pr-sig" }, [
        h("div", {}, "الصيدلي المسؤول"),
        h("div", { class: "pr-sig-line" }, "التوقيع")
      ]),
      h("div", { class: "pr-sig" }, [
        h("div", {}, "ممرض/ة الجناح"),
        h("div", { class: "pr-sig-line" }, "التوقيع")
      ])
    ]));
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
    // print
    buildPrintReport
  };
})(window);
