/* ============================================================
   ward.js
   Ward structure generator — modeled as a long corridor map.

   The physical layout (per user description):
   - One long corridor with 10 rooms on ONE side (left when entering).
   - Entrance is at the top of the map (room 1 is the first room you reach).
   - Rooms 1-5: each room has 6 beds — when you enter the room, there are
                   3 beds on the RIGHT and 3 beds on the LEFT.
                   → bed layout type: "split-3-3"
   - Rooms 6-10: each room has 4 beds — straight linear arrangement.
                   → bed layout type: "linear-4"

   We store a `layout` field on each room and a `side` field on each bed
   so the UI can render the corridor as a true map.
   ============================================================ */

(function (global) {
  "use strict";

  // Bed numbering convention for split rooms (1-5):
  // When you walk into the room:
  //   - RIGHT side: beds 1, 2, 3  (1 nearest the door)
  //   - LEFT  side: beds 4, 5, 6  (4 nearest the door)
  // For linear rooms (6-10): beds 1, 2, 3, 4 in a row.
  const ROOMS = [];
  for (let r = 1; r <= 10; r++) {
    const isSplit = r <= 5;
    const bedCount = isSplit ? 6 : 4;
    const layout   = isSplit ? "split-3-3" : "linear-4";
    const beds = [];
    if (isSplit) {
      // Right side: 1, 2, 3 (nearest door → farthest)
      for (let b = 1; b <= 3; b++) beds.push({ number: b, side: "right" });
      // Left  side: 4, 5, 6 (nearest door → farthest)
      for (let b = 4; b <= 6; b++) beds.push({ number: b, side: "left" });
    } else {
      for (let b = 1; b <= 4; b++) beds.push({ number: b, side: "row" });
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

