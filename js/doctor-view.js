// Doctor view module — interfaces for medical doctors
// ============================================================
// The doctor view is shown when a user with role="doctor" logs in.
// It displays a list of all occupied patients (across all rooms),
// and lets the doctor:
//   - Tap a patient → see their current medications
//   - Add a new medication to the patient (a "prescription")
//   - The prescription is saved to the patient's medications array
//     (same storage path the pharmacist uses) so the pharmacist
//     sees it immediately via Supabase Realtime.
//
// Mobile-first design — doctors primarily use phones.

(function (global) {
  "use strict";

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(k => {
        if (k === "class") el.className = attrs[k];
        else if (k === "dataset") Object.assign(el.dataset, attrs[k]);
        else if (k.startsWith("on") && typeof attrs[k] === "function") {
          el.addEventListener(k.slice(2), attrs[k]);
        } else if (attrs[k] != null) el.setAttribute(k, attrs[k]);
      });
    }
    if (children != null) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(c => {
        if (c == null) return;
        if (typeof c === "string") el.appendChild(document.createTextNode(c));
        else el.appendChild(c);
      });
    }
    return el;
  }

  // ---- Render the list of occupied patients ----
  // The doctor sees ALL occupied patients (regardless of room) so
  // they can write prescriptions for any of them.
  function renderDoctorPatientsList(state) {
    const list = $("doctor-patients-list");
    if (!list) return;
    list.innerHTML = "";

    const Ward = global.PharmacyWard;
    const occupied = [];
    Ward.ROOMS.forEach(room => {
      room.beds.forEach(bed => {
        const key = Ward.bedKey(room.id, bed.number);
        const p = state.patients[key];
        if (p && p.name && p.name.trim()) {
          occupied.push({
            bedKey: key,
            name: p.name.trim(),
            plateNumber: p.plateNumber || "",
            roomNumber: room.id,
            bedNumber: bed.number,
            medications: p.medications || []
          });
        }
      });
    });

    if (occupied.length === 0) {
      list.appendChild(h("div", {
        class: "empty-state"
      }, [
        h("div", { class: "empty-icon" }, "⌕"),
        h("p", {}, "لا يوجد مرضى مشغولون"),
        h("span", {}, "عند إضافة مريض سيظهر هنا")
      ]));
      return;
    }

    occupied.forEach(patient => {
      const medCount = patient.medications.length;
      const card = h("div", {
        class: "doctor-patient-card",
        dataset: { bedKey: patient.bedKey },
        onclick: () => openDoctorPatientDetail(patient, state)
      }, [
        h("div", { class: "doctor-patient-head" }, [
          h("div", { class: "doctor-patient-name" }, patient.name),
          h("div", { class: "doctor-patient-loc" },
            `غرفة ${patient.roomNumber} · سرير ${patient.bedNumber}` +
            (patient.plateNumber ? ` · طبلة ${patient.plateNumber}` : ""))
        ]),
        h("div", { class: "doctor-patient-meta" },
          medCount > 0
            ? `${medCount} دواء`
            : "لا أدوية حالياً")
      ]);
      list.appendChild(card);
    });
  }

  // ---- Open patient detail (modal-like overlay) ----
  // Shows current meds + a button to add a new prescription.
  function openDoctorPatientDetail(patient, state) {
    // For now, use a simple prompt-based UI. Later we can build a
    // proper modal with a med picker.
    const detail = `
المريض: ${patient.name}
الغرفة: ${patient.roomNumber} · السرير: ${patient.bedNumber}
${patient.plateNumber ? "رقم الطبلة: " + patient.plateNumber + "\n" : ""}
الأدوية الحالية:
${(patient.medications || []).map((m, i) =>
  `${i+1}. ${m.nameAr || m.nameTrade || m.nameEn || m.id} — ${m.dose || ""} (${m.frequency || ""})`
).join("\n") || "لا أدوية حالياً"}
    `.trim();

    alert(detail);
    // TODO: build proper modal with add-prescription form
  }

  // ---- Helper: get element by id ----
  function $(id) { return document.getElementById(id); }

  // ---- Public API ----
  global.PharmacyDoctorView = {
    renderDoctorPatientsList
  };

})(window);
