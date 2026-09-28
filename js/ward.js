/* ============================================================
   ward.js
   Ward structure generator.
   10 rooms, 50 beds:
     rooms 1-5  → 6 beds each (30)
     rooms 6-10 → 4 beds each (20)
   ============================================================ */

(function (global) {
  "use strict";

  const ROOMS = [];
  for (let r = 1; r <= 10; r++) {
    const bedCount = r <= 5 ? 6 : 4;
    const beds = [];
    for (let b = 1; b <= bedCount; b++) beds.push(b);
    ROOMS.push({ id: r, bedCount, beds });
  }

  const TOTAL_BEDS = ROOMS.reduce((acc, r) => acc + r.bedCount, 0); // 50

  // Build the storage key for a (room, bed)
  function bedKey(roomId, bedNumber) {
    return `room-${roomId}-bed-${bedNumber}`;
  }

  global.PharmacyWard = {
    ROOMS,
    TOTAL_BEDS,
    bedKey
  };
})(window);
