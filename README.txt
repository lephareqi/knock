$KNOCK site

Local development
1. Install Node.js 20.19+.
2. Run `npm install`.
3. Run `npm run dev` and open the local URL printed by Vite.
4. Run `npm test` and `npm run build` to validate changes. The deployable site is written to `dist/`.

The small, unlisted door in the Knock landing-page footer opens `knock-launchpad.html`. It is an easter egg, not access control. The existing SoXo app remains in `public/` and is served separately by `npm start`; it is not replaced by this static Knock build.

Launchpad
- Launches standard Pump.fun tokens on Solana mainnet using Pump's official `@pump-fun/pump-sdk`.
- Requires Phantom. The connected visitor's wallet creates, pays for, reviews, signs, and submits each launch transaction. The site never asks for a seed phrase or private key.
- Each creator supplies their name, ticker, HTTPS metadata JSON URL, and optional initial SOL buy. The metadata JSON and image must already be hosted; this page does not upload them.
- A disclosed one-time platform fee of 0.5% of the initial buy is sent to `DXMj13Ni2kioTLCvfBgyLro2ZrFwfuiug6pz1bhHNU3G` in the same transaction. The fee is rounded down to the nearest lamport. No initial buy means no platform fee.
- Account rent and network/priority fees are additional and can vary. The transaction review is shown before Phantom opens, and Phantom must approve every transaction.
- The app uses the public Solana mainnet RPC for reads and transaction construction. To configure another HTTPS RPC locally, set `VITE_SOLANA_RPC_URL` in an untracked `.env.local` file.
- No live mainnet launch has been executed or independently audited from this repository. The current Pump SDK dependency tree reports upstream npm security advisories; resolve these with compatible patched releases and review the integration before production use.

Token launches are real, public, and irreversible. Review the token details, fee, recipient, and full transaction carefully before signing. Memecoins are risky and can go to zero.
