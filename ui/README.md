# PrismLift UI

React + Vite front-end for the ZamaFundraiser contract. Reads use viem (wagmi), writes use ethers with RainbowKit for wallet connectivity.

## Run locally
```bash
cd ui
npm install
npm run dev
```

## Configure
- Update `ui/src/config/contracts.ts` with the Sepolia deployment address from `deployments/sepolia/ZamaFundraiser.json`.
- The ABI in that file is copied directly from the generated deployment artifact—no `.json` imports are used in the app.

## Available scripts
- `npm run dev` — start the dev server
- `npm run build` — production build
- `npm run lint` — lint checks

The app never uses localhost chains or local storage and keeps all fund amounts encrypted via Zama relayer flows.
