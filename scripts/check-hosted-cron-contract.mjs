import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function checkHostedCronContract(root = process.cwd()) {
  const workflowsRoot = path.join(root, ".github", "workflows");
  const errors = [];
  const files = fs.existsSync(workflowsRoot)
    ? fs
        .readdirSync(workflowsRoot)
        .filter((file) => /\.ya?ml$/i.test(file))
        .sort()
    : [];

  for (const file of files) {
    const source = fs.readFileSync(path.join(workflowsRoot, file), "utf8");
    if (/^\s*schedule\s*:/m.test(source) || /^\s*-\s*cron\s*:/m.test(source)) {
      errors.push(`${file}: hosted schedule is forbidden`);
    }
  }

  return { ok: errors.length === 0, workflowCount: files.length, errors };
}

const isCli = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isCli) {
  const result = checkHostedCronContract();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}
