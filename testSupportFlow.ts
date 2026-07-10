import dotenv from "dotenv";
dotenv.config();

import { handleSupportChat } from "./src/server/aiSupport.js";

async function run() {
  const telegramId = "336997351";
  
  try {
    console.log("Turn 1...");
    const res1 = await handleSupportChat(telegramId, "Hi, I am Dawit", [], false);
    console.log("Res 1:", res1);
    
    console.log("\nTurn 2...");
    const res2 = await handleSupportChat(telegramId, "What is my balance?", [], false);
    console.log("Res 2:", res2);
    
    console.log("\nTurn 3...");
    const res3 = await handleSupportChat(telegramId, "Can you block a user?", [], false);
    console.log("Res 3:", res3);
    
  } catch (err: any) {
    console.error("Test Error:", err);
  }
}

run();
