import { resetAndSeedDemoData, seedDemoData } from "./demo.js";

const command = process.argv[2] || "seed";

if (command === "reset") {
  console.log(JSON.stringify(resetAndSeedDemoData(), null, 2));
} else {
  console.log(JSON.stringify(seedDemoData(), null, 2));
}
