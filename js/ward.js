/* ============================================================
   ward.js
   Ward structure generator — modeled as a long corridor map.

   The physical layout (per user description):
   - One long corridor with 10 rooms on ONE side (left when entering).
   - Entrance is at the top of the map (room 1 is the first room you reach).
   - Rooms 1-5: each room has 6 beds — laid out as a 2×3 grid:
                   2 beds top row + 2 beds middle row + 2 beds bottom row.
                   → bed layout type: "grid-2x3"
   - Rooms 6-10: each room has 4 beds — laid out as a 2×2 grid:
                   2 beds top row + 2 beds bottom row.
                   → bed layout type: "grid-2x2"

   We store a `layout` field on each room and a `side` field on each
   bed (top/middle/bottom) so the UI can render the grid as rows.
   ============================================================ */

(function (global) {
  "use strict";

  // Bed numbering convention for 6-bed rooms (1-5):
  //   Top row:    beds 1 (right) + 2 (left)
  //   Middle row: beds 3 (right) + 4 (left)
  //   Bottom row: beds 5 (right) + 6 (left)
  // For 4-bed rooms (6-10):
  //   Top row:    beds 1 (right) + 2 (left)
  //   Bottom row: beds 3 (right) + 4 (left)
  // In RTL, "right" appears on the right side of each row.
  const ROOMS = [];
  for (let r = 1; r <= 10; r++) {
    const isSix = r <= 5;
    const bedCount = isSix ? 6 : 4;
    const layout   = isSix ? "grid-2x3" : "grid-2x2";
    const beds = [];
    if (isSix) {
      // Top row: 1 (right) + 2 (left)
      beds.push({ number: 1, side: "top" });
      beds.push({ number: 2, side: "top" });
      // Middle row: 3 (right) + 4 (left)
      beds.push({ number: 3, side: "middle" });
      beds.push({ number: 4, side: "middle" });
      // Bottom row: 5 (right) + 6 (left)
      beds.push({ number: 5, side: "bottom" });
      beds.push({ number: 6, side: "bottom" });
    } else {
      // Top row: 1 (right) + 2 (left)
      beds.push({ number: 1, side: "top" });
      beds.push({ number: 2, side: "top" });
      // Bottom row: 3 (right) + 4 (left)
      beds.push({ number: 3, side: "bottom" });
      beds.push({ number: 4, side: "bottom" });
    }
    ROOMS.push({ id: r, bedCount, layout, beds });
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
