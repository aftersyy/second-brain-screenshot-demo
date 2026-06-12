import { buildWechatRecommendationPreview, pushWechatRecommendation } from "./push.js";

function parseArgs(argv) {
  const options = {
    dry_run: true
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--date") options.date = argv[++index];
    else if (arg === "--limit") options.limit = Number(argv[++index]);
    else if (arg === "--send") options.dry_run = false;
    else if (arg === "--yes" || arg === "--confirm") options.confirm = true;
    else if (arg === "--json") options.json = true;
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const result = options.dry_run
  ? buildWechatRecommendationPreview(options)
  : pushWechatRecommendation(options);

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(result.message);
  console.log("");
  console.log(`channel: ${result.channel}`);
  console.log(`target: ${result.target}`);
  console.log(`dry_run: ${result.dry_run}`);
  if (result.requires_confirmation) {
    console.log("confirmation: rerun with --send --yes to actually send.");
  } else if (result.delivery) {
    console.log(`delivery_ok: ${result.delivery.ok}`);
  }
}

if (!result.ok && !result.requires_confirmation) {
  process.exitCode = 1;
}
