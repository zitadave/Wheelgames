import { gridRooms, getRemainingSlots } from "./src/server/gridState.js";

// Manually claim a slot for testing
gridRooms["mini"].claimedSlots["1"] = { isSelf: false, userId: "test", username: "Tester" };
gridRooms["mini"].claimedSlots["2"] = { isSelf: false, userId: "test", username: "Tester" };

const remaining = getRemainingSlots("mini", 50);
console.log(`Remaining slots: ${remaining.length}`);
console.log(`Remaining slots: ${remaining.slice(0, 10)}`);
