# Usufruct × Slush — wallet write demo

A tiny Vite + React app to **see how a Usufruct write renders in a real wallet's
approval popup** (Slush, Suiet, any wallet-standard wallet). It drives `integrate`
and `rent` through `walletExecutor` — the wallet only **signs**, the SDK
**executes + enriches** (so the rich decodes still resolve the created objects).

This example lives outside the SDK package: the dapp-kit dependency is here, never
in `@usufruct-protocol/sdk`. The wallet is matched **structurally** — `useDAppKit()`'s
`signTransaction` *is* the SDK's `WalletSigner`, no SDK→dapp-kit coupling.

## Run it

1. **Build the SDK first** (the demo depends on it via `file:`):
   ```bash
   # from the repo root
   npm install && npm run build
   ```
2. **Install + start the demo:**
   ```bash
   cd examples/wallet-demo
   npm install
   npm run dev
   ```
   Open the printed `localhost` URL.

## Prepare a wallet

1. In **Slush** (browser extension), create a new account — Slush generates the
   seed locally; it never leaves your machine.
2. Switch Slush to **testnet**.
3. Send your **public address** to whoever funds the demo. They will fund it with
   SUI (gas), mint you a **DummyAsset** (for `integrate`), and send **DUMMY** coins
   (for `rent`'s floor payment).

## Use it

- **① Integrate** — finds a `DummyAsset` your account owns and lists it as a rental
  market. Slush pops the approval; watch how the PTB renders. The new escrow id is
  auto-filled below.
- **② Rent** — rents 1 tenure of the escrow id in the box (auto-filled from
  integrate, or paste any DUMMY-priced escrow). Slush pops again.

Both buttons log the decoded result (escrow / cap ids, receipt) — proof the
enriched result came back through the wallet path.

## Notes

- The SDK + dapp-kit share **one** `SuiGrpcClient` (see `src/dapp-kit.ts`).
- `ConnectButton` is unstyled here (the demo cares about Slush's rendering, not its
  own button). For the kit's styles, import its CSS in `main.tsx`.
- Testnet only.
