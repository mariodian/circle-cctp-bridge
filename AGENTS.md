# AGENTS.md

Browser page that moves USDC (CCTP V2) and EURC, cirBTC, and WETH (CCTPx) between Ethereum (1), Arc (5042), and Avalanche (43114). No backend. The wallet signs every transaction.

## Layout

- `src/main.ts`, `src/App.svelte`, `src/app.css` — Vite entry, page shell, Tailwind tokens.
- `src/lib/cctp/logic.ts` — pure route, quote, and reserve rules. No ethers, no `globalThis`. Do not split it. `test/logic.test.ts` is the safety suite.
- `src/lib/cctp/transfer.ts` — send and resume. Browser confirms go through `Deps.confirm`, not `window.confirm`.
- `src/lib/cctp/contracts.ts` — addresses, ABIs, and `lib()` (bundled ethers 6.13.2). `errorText` lives here.
- `src/lib/bridge/bridge.svelte.ts` — one `Bridge` class: wallet session, address book, button actions, and the quote timer.
- `src/lib/format.ts` — `shortAddress`, `feeText`, `receiveText`.
- `src/lib/components/` — app UI. `src/lib/components/ui/` is shadcn-svelte; leave it alone unless a component is missing.
- `index.html` — mount point and the production Content-Security-Policy.

## Conventions

- Svelte 5 only: `$props()`, `$state`, `$derived`. No `export let`, stores, `on:` directives, slots, or `createEventDispatcher`.
- Bridge display flags (`feeLoading`, `mode`, button flags) are `$derived`, not getters. Quote inputs are `routeKey`, `amount`, `fast`, `selfMint`, `recipientKey`, and `me`. The quote `$effect.root` lives in the `Bridge` constructor.
- TypeScript imports use the `$lib/...js` form (`verbatimModuleSyntax`). Do not set `baseUrl`.
- Use an existing shadcn-svelte component for buttons, dialogs, inputs, and skeletons. Keep the element ids listed in the components (`connect`, `amt`, `send`, `resume`, and the rest).
- A new chain needs a `CHAINS` record (Circle domain and `feeConfirm`) and its RPC host in `connect-src`. `chain(id)` throws if either field is missing, so a bad record fails at load.
- Leave transfer rules, confirmation copy, and contract addresses unchanged unless the task is to change them.

## Security

Production CSP is `script-src 'self'` and `style-src 'self'`. `vite.config.ts` allows inline styles only while `bun run dev` is serving. `connect-src` is Circle Iris plus the three public RPCs. Inter is bundled. `src/main.ts` refuses to mount when `window.top !== window.self`.

## Tooling

Bun only (`bun.lock`). `typescript` is v6 because `svelte-check` needs it beside TypeScript 7 at `@typescript/native`.

```bash
bun test                 # test/logic.test.ts
bun run check            # svelte-check, then tsc -p tsconfig.json
bun run format:check     # Prettier: no tabs, semicolons, double quotes, no trailing commas, width 100
```

`bun run dev` is the Vite server (HMR on). `bun run build` writes gitignored `dist/`. Preview after a fresh clone: `bun install && bun run build && bun run preview -- --host 127.0.0.1 --port 8000`.

Root `tsc` excludes `*.svelte`, `*.svelte.ts`, and `src/lib/components`. `svelte-check` (`tsconfig.app.json`) still covers components. If `bun run check` reports a deleted Svelte file, delete that file under `.svelte-check/` and rerun.
