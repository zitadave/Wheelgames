import pkg from './dist/server.cjs';
const { getRemainingSlots } = pkg;
const dummyRooms = {
  "mini": {
    claimedSlots: { "5": {}, "10": {} },
    roundId: 1
  }
};
getRemainingSlots("mini", 50, dummyRooms).then(rem => {
  console.log("Remaining slots:", rem.length);
  console.log("Are 5 and 10 there?", rem.includes(5), rem.includes(10));
});
