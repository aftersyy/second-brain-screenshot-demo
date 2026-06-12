import { getSchedulerPlan, installOpenClawCronJobs } from "./scheduler.js";

const command = process.argv[2] || "plan";

if (command === "install") {
  console.log(JSON.stringify(installOpenClawCronJobs({ dryRun: false }), null, 2));
} else {
  console.log(JSON.stringify({ jobs: getSchedulerPlan() }, null, 2));
}
