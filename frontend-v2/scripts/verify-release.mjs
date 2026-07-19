import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";

const root = resolve(import.meta.dirname, "..");
const repoRoot = resolve(root, "..");
const required = [
  "src/app/router.tsx",
  "src/components/server/ServerCard.tsx",
  "src/components/server/StatCard.tsx",
  "src/pages/server/AuditPage.tsx",
  "src/pages/server/BackupsPage.tsx",
  "src/pages/server/ConsolePage.tsx",
  "src/pages/server/DatabasesPage.tsx",
  "src/pages/server/FilesPage.tsx",
  "src/pages/server/MembersPage.tsx",
  "src/pages/server/NetworkPage.tsx",
  "src/pages/server/PlayersPage.tsx",
  "src/pages/server/PluginsPage.tsx",
  "src/pages/server/SchedulesPage.tsx",
  "src/pages/server/ServerDashboardPage.tsx",
  "src/pages/server/ServerSettingsPage.tsx",
  "src/pages/server/VersionsPage.tsx",
  "src/pages/server/WorldsPage.tsx",
  "src/services/backups.service.ts",
  "src/services/modrinth.service.ts",
  "../supabase/functions/_shared/core.ts",
  "../supabase/functions/upgrade-agent/index.ts",
  "../supabase/functions/delete-server/index.ts",
  "../supabase/functions/delete-account/index.ts",
  "src/pages/LegalPage.tsx",
  "src/pages/account/DiagnosticsPage.tsx",
  "src/services/account.service.ts",
  "../minecraft-agent/test_playit_handoff.py",
  "../minecraft-agent/test_persistence_upload.py",
  "../supabase/APPLY-BETA16.sql",
];

const failures = [];
for (const path of required) {
  if (!existsSync(resolve(root, path))) failures.push(`Missing required file: ${path}`);
}

const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
if (packageJson.version !== "2.0.0-beta.16") failures.push(`Unexpected package version: ${packageJson.version}`);

const upgradeSql = readFileSync(resolve(repoRoot, "supabase/APPLY-BETA16.sql"), "utf8");
const relatedPolicyDrop = 'drop policy if exists "users read related profiles" on public.profiles;';
const relatedPolicyCreate = 'create policy "users read related profiles" on public.profiles';
if (!upgradeSql.includes(relatedPolicyDrop) || upgradeSql.indexOf(relatedPolicyDrop) > upgradeSql.indexOf(relatedPolicyCreate)) {
  failures.push("APPLY-BETA16.sql must drop users read related profiles before recreating it");
}

const gitignore = readFileSync(resolve(repoRoot, ".gitignore"), "utf8").split(/\r?\n/);
if (gitignore.includes("server/")) failures.push(".gitignore must use /server/; bare server/ deletes React source directories");
if (!gitignore.includes("/server/")) failures.push(".gitignore is missing the root-only /server/ rule");

function files(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
const sourceFiles = files(resolve(root, "src"));
const caseMap = new Map();
for (const path of sourceFiles) {
  const name = relative(root, path).replaceAll("\\", "/");
  const lower = name.toLowerCase();
  if (caseMap.has(lower) && caseMap.get(lower) !== name) failures.push(`Case-insensitive path collision: ${caseMap.get(lower)} / ${name}`);
  caseMap.set(lower, name);
  const content = readFileSync(path, "utf8");
  if (/SUPABASE_SERVICE_ROLE_KEY|github_pat_|hf_[A-Za-z0-9]{24,}/.test(content)) failures.push(`Sensitive credential pattern in frontend: ${name}`);
}

if (failures.length) {
  console.error("\nSAW release verification failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log(`SAW release verification passed: ${required.length} critical files, ${sourceFiles.length} frontend source files.`);
