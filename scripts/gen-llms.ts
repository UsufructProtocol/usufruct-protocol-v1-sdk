/**
 * Generate `llms-full.txt` — the self-contained payload a dev pastes into an AI
 * agent's context to write working Usufruct scripts without learning the API.
 *
 * Single source of truth: it concatenates the canonical docs in reading order
 * (no content is authored here, only a short preamble), so the payload never
 * drifts from the docs. Run after editing any source: `npm run gen:llms`.
 *
 * `llms.txt` (the curated index) is hand-authored — this only builds the full one.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Reading order: getting-started → the model → the write seam → borrow → the
// primitives line → the complete reference. Each file already opens with its H1.
const SOURCES = [
  'QUICKSTART.md',
  'concepts/api-design.md',
  'concepts/write-model.md',
  'concepts/borrow.md',
  'concepts/primitives.md',
  'API.md',
  'concepts/cookbook.md',
];

const PREAMBLE = `# Usufruct Protocol SDK — full context for AI agents

> This file is the self-contained documentation payload for \`@usufruct-protocol/sdk\`,
> the official TypeScript SDK for the Usufruct Protocol — an on-chain rental market
> primitive for any Sui asset, priced in any payment coin. Load it into an agent's
> context to write working Usufruct scripts. It concatenates, in reading order:
> QUICKSTART, the four concept docs (api-design, write-model, borrow, primitives),
> the complete API reference, and a cookbook of runnable recipes. Cross-document
> links are relative to the repo.

## Install & a canonical setup

\`\`\`bash
npm i @usufruct-protocol/sdk @mysten/sui
\`\`\`

\`\`\`ts
import { usufruct, SUI } from '@usufruct-protocol/sdk';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

// signer = identity + signing. Use { account } for read-only / external wallets,
// { executor } for a wallet/Ledger/sponsor/multisig adapter.
const u = usufruct({ network: 'testnet', signer: Ed25519Keypair.generate() });

const escrow = await u.nav.escrow('0x…');           // resolve a handle (identity only)
const state  = await escrow.read.assetState();      // live discriminated union
const cap    = await escrow.write.rent({ tenures: 1 }).send();  // pay the floor → a UsufructCap
\`\`\`

## The model in one paragraph

Every object is its **identity** (flat fields) plus five verbs — **nav · read ·
inspect · react · write** — identical on the root \`u\` and on every handle
(\`Escrow\`/\`UsufructCap\`/\`GovernanceCap\`/inboxes). \`read\`/\`write\` are on-chain state;
\`inspect\`/\`react\` are the event log (pull/push); \`nav\` walks the object graph. Reads
are **drift-zero** (the deployed Move views via simulateTransaction). Authority is
**possession** of a bearer object, not an ACL. Writes are **\`Plan\`s** — \`.send()\` runs
build+sign+decode; \`.build(tx,sender)\` lets you drive the PTB.

---
`;

const parts: string[] = [PREAMBLE];
for (const rel of SOURCES) {
  const body = readFileSync(new URL(rel, `file://${ROOT}`), 'utf8').trimEnd();
  parts.push(`\n\n<!-- ─────────── source: ${rel} ─────────── -->\n\n${body}`);
}

const out = parts.join('\n') + '\n';
writeFileSync(new URL('llms-full.txt', `file://${ROOT}`), out);

const lines = out.split('\n').length;
const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(0);
console.log(`llms-full.txt — ${SOURCES.length} sources, ${lines} lines, ${kb} KB`);
