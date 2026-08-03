#!/usr/bin/env node
// Seed (or refresh) the Help & Guide page content in the datastore from the
// bundled default in src/content/helpContent.js. Writes to Supabase
// (`help_content` table) when configured, otherwise the local JSON store.
//
// The page is stored one row per part — a `header` row, one `section` row per
// section, and a `cta` row — each keyed by a stable `slug`. Rows are matched by
// slug and updated in place, missing ones are created, and rows that no longer
// correspond to any part (including a single pre-split row holding the whole
// document) are removed.
//
// Usage:
//   npm run seed:help              # write/refresh every part
//   npm run seed:help -- --dry-run # report what would change, write nothing

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import { DEFAULT_HELP_CONTENT, splitHelpContent } from '../src/content/helpContent.js';

const { loadEnvConfig } = nextEnv;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');

  // Env must be loaded before server modules are imported: server/supabase.js
  // reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY at module load.
  loadEnvConfig(ROOT);
  const sb = await import('../server/supabase.js');
  const store = await import('../server/store.js');

  console.log(`Destination: ${sb.enabled ? 'Supabase (help_content table)' : 'local JSON store (server/data/db.json)'}`);

  const rows = splitHelpContent(DEFAULT_HELP_CONTENT);
  const existing = await store.list('HelpContent');
  const bySlug = new Map(existing.filter(r => r.slug).map(r => [r.slug, r]));
  const wanted = new Set(rows.map(r => r.slug));

  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const match = bySlug.get(row.slug);
    const label = `${row.kind}/${row.slug}`;
    if (match) {
      if (!dryRun) await store.update('HelpContent', match.id, row);
      console.log(`  update ${label}`);
      updated++;
    } else {
      if (!dryRun) await store.create('HelpContent', row, 'seed-script');
      console.log(`  create ${label}`);
      created++;
    }
  }

  // Anything left over: a pre-split whole-document row, or a section that was
  // removed from the default since the last seed.
  const stale = existing.filter(r => !r.slug || !wanted.has(r.slug));
  for (const row of stale) {
    if (!dryRun) await store.remove('HelpContent', row.id);
    console.log(`  remove stale row ${row.id}${row.slug ? ` (${row.slug})` : ' (pre-split whole-page row)'}`);
  }

  console.log(
    dryRun
      ? `Dry run — nothing written (${created} would be created, ${updated} updated, ${stale.length} removed).`
      : `Done: ${created} created, ${updated} updated, ${stale.length} removed.`
  );
}

main().catch(err => {
  console.error(`Seed failed: ${err.message}`);
  process.exit(1);
});
