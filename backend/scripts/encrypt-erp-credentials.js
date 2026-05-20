// scripts/encrypt-erp-credentials.js
//
// One-time idempotent migration: scan erp_connections, encrypt any plaintext
// passwords in place, and leave already-encrypted (v1:) values alone.
//
// USAGE (on Render shell, or locally with .env loaded):
//   node scripts/encrypt-erp-credentials.js          # dry run (preview only)
//   node scripts/encrypt-erp-credentials.js --apply  # actually write changes
//
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, ENCRYPTION_KEY

const { createClient } = require("@supabase/supabase-js");
const { encrypt, isEncrypted, assertKeyConfigured } = require("../lib/crypto");

const APPLY = process.argv.includes("--apply");

async function main() {
  assertKeyConfigured(); // fail fast if env is bad

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  console.log(`[encrypt-erp-credentials] ${APPLY ? "APPLY MODE" : "DRY RUN"}`);

  const { data: rows, error } = await supabase
    .from("erp_connections")
    .select("id, team_id, erp_type, username, password, base_url");

  if (error) {
    console.error("Failed to read erp_connections:", error.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log("No rows found in erp_connections. Nothing to do.");
    return;
  }

  let toEncrypt = 0;
  let alreadyEncrypted = 0;
  let nullOrEmpty = 0;

  for (const row of rows) {
    if (!row.password) {
      nullOrEmpty++;
      continue;
    }
    if (isEncrypted(row.password)) {
      alreadyEncrypted++;
      continue;
    }
    toEncrypt++;
    const preview = row.password.length > 4
      ? `${row.password.slice(0, 2)}***${row.password.slice(-2)}`
      : "***";
    console.log(
      `  - row ${row.id} (team=${row.team_id}, erp=${row.erp_type}) password "${preview}" -> will encrypt`
    );

    if (APPLY) {
      const encrypted = encrypt(row.password);
      const { error: updErr } = await supabase
        .from("erp_connections")
        .update({ password: encrypted })
        .eq("id", row.id);
      if (updErr) {
        console.error(`    FAILED to update row ${row.id}:`, updErr.message);
        process.exit(2);
      }
      console.log(`    OK row ${row.id} encrypted`);
    }
  }

  console.log("\nSummary:");
  console.log(`  Total rows:           ${rows.length}`);
  console.log(`  To encrypt:           ${toEncrypt}`);
  console.log(`  Already encrypted:    ${alreadyEncrypted}`);
  console.log(`  Null/empty password:  ${nullOrEmpty}`);

  if (!APPLY && toEncrypt > 0) {
    console.log(
      "\nThis was a DRY RUN. Re-run with --apply to actually encrypt these rows."
    );
  }
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
