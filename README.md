# PrismLift

PrismLift is a privacy-aware ETH fundraising dApp built on Zama FHE. Organizers configure a campaign name, goal, and deadline, while every contribution is recorded as encrypted ciphertext on-chain. The organizer can close the campaign at any time to withdraw all funds.

## Project overview
PrismLift focuses on transparent fundraising while keeping contribution amounts encrypted in contract storage. It combines standard ETH transfers with FHE-based accounting so organizers can verify totals without exposing contributors' encrypted balances on-chain.

### Problems this project solves
- **Privacy leakage in fundraising:** Traditional on-chain fundraising exposes contributor balances and totals in plain storage.
- **Operational friction:** Organizers want a simple workflow to configure, track, and close a campaign.
- **Proof of fundraising state:** Contributors and organizers need reliable, on-chain records of progress and participation.

### Advantages
- **Encrypted accounting:** Contribution balances and aggregate totals are stored as ciphertext using Zama FHE.
- **Simple organizer control:** A single organizer address can update metadata and close the campaign.
- **Auditable ETH flow:** The contract holds ETH, and withdrawals are handled on-chain.
- **Clear separation of concerns:** FHE handles encrypted math, while standard ETH flows remain compatible with existing wallets.

## Core features
- Campaign configuration: name, goal (wei), end time (unix timestamp).
- Encrypted per-contributor balances and encrypted total raised.
- Clear accounting fields for UI display and event reporting.
- Organizer-only campaign updates and closure with full withdrawal.
- Custom Hardhat tasks for encrypting inputs and decrypting totals.

## How it works (end-to-end)
1. **Organizer deploys** the contract with campaign metadata.
2. **Contributor encrypts** their contribution amount using the Zama relayer SDK.
3. **Contributor sends ETH** with `msg.value` and provides the encrypted amount plus proof.
4. **Contract updates encrypted state** with FHE addition, while clear totals update for UI display.
5. **Organizer decrypts totals** using the relayer SDK when needed.
6. **Organizer closes** the campaign and withdraws all ETH.

## Technology stack
- **Smart contracts:** Solidity + Zama FHE (`@fhevm/solidity`)
- **Dev framework:** Hardhat + hardhat-deploy + TypeChain
- **Relayer SDK:** `@zama-fhe/relayer-sdk` for encryption/decryption
- **Frontend:** React + Vite + RainbowKit
- **On-chain reads:** viem (via wagmi)
- **On-chain writes:** ethers `Contract`
- **Network:** Sepolia (no localhost network in the UI)

## Repository layout
- `contracts/` - Solidity contracts
- `deploy/` - Hardhat deploy script
- `tasks/` - Hardhat CLI tasks (encrypt, decrypt, and admin ops)
- `test/` - Contract tests
- `ui/` - Front-end (React + Vite)
- `deployments/` - Deployed addresses and ABI artifacts

## Smart contract details
**Contract:** `contracts/ZamaFundraiser.sol`

### State
- `campaignName` - campaign name.
- `fundraisingGoal` - target amount in wei.
- `endTime` - unix timestamp when contributions stop.
- `organizer` - immutable organizer address.
- `totalRaised` - clear (non-encrypted) ETH total.
- `encryptedTotalRaised` - encrypted total (euint64).
- `encryptedContributions` - mapping of encrypted per-user totals.
- `clearContributions` - mapping of clear per-user totals (for UI).
- `lastContributionAt` - last contribution timestamp.
- `isClosed` - campaign close flag.

### Key functions
- `configureCampaign(name, goal, endTime)` - update metadata while active.
- `contribute(encryptedAmount, proof)` - accepts ETH and updates encrypted totals.
- `closeCampaign()` - closes and withdraws all ETH to the organizer.
- `getCampaignDetails()` - returns public metadata and totals.
- `getContribution(contributor)` - returns encrypted + clear contribution info.
- `getEncryptedTotalRaised()` - returns encrypted total.

### Events
- `CampaignUpdated(name, goal, endTime)`
- `ContributionReceived(contributor, amountWei, encryptedBalance)`
- `CampaignClosed(organizer, amountWithdrawn)`

### Security and correctness
- Reentrancy guard on state-changing functions.
- Organizer-only controls for updates and withdrawals.
- View methods do not rely on `msg.sender`.
- `euint64` is used for encrypted amounts; contributions above `uint64` max are rejected.

## Front-end details
- **Location:** `ui/`
- **UI stack:** React + Vite + RainbowKit (no Tailwind).
- **Reads:** viem (via wagmi).
- **Writes:** ethers `Contract`.
- **No local storage:** state is derived from on-chain data.
- **No localhost network:** UI targets Sepolia.
- **No JSON in UI:** ABI is copied into `ui/src/config/contracts.ts` as a TS export.

### ABI sync workflow
1. Deploy the contract (see deployment steps below).
2. Open `deployments/sepolia/ZamaFundraiser.json`.
3. Copy the ABI into `ui/src/config/contracts.ts`.
4. Update the `FUNDRAISER_ADDRESS` constant with the deployed address.

## Configuration
Create a `.env` file in the project root (used by Hardhat):
```
PRIVATE_KEY=your_private_key_without_0x
INFURA_API_KEY=your_infura_project_id
ETHERSCAN_API_KEY=optional_etherscan_key
CAMPAIGN_NAME=PrismLift Launch
CAMPAIGN_GOAL_ETH=10
CAMPAIGN_DURATION_DAYS=14
```
Only `PRIVATE_KEY` is used for deployment; MNEMONIC is not used anywhere.

## Commands
Install dependencies:
```bash
npm install
```

Compile contracts:
```bash
npm run compile
```

Run tests (uses the mock FHEVM on Hardhat):
```bash
npm test
```

Deploy:
```bash
npm run deploy:localhost
npm run deploy:sepolia
```

## Hardhat tasks
Campaign info:
```bash
npx hardhat task:campaign-info --network sepolia
```

Contribute (encrypts amount and sends ETH):
```bash
npx hardhat task:contribute --network sepolia --value 0.25
```

Decrypt a contributor balance:
```bash
npx hardhat task:decrypt-contribution --network sepolia --user 0xYourAddress
```

Decrypt total raised (organizer should run):
```bash
npx hardhat task:decrypt-total --network sepolia
```

Close campaign:
```bash
npx hardhat task:close-campaign --network sepolia
```

## Usage guide
### Organizer flow
1. Set `CAMPAIGN_NAME`, `CAMPAIGN_GOAL_ETH`, and `CAMPAIGN_DURATION_DAYS`.
2. Deploy to Sepolia using `npm run deploy:sepolia`.
3. Copy ABI + address into the UI config.
4. Monitor contributions via UI or Hardhat tasks.
5. Close the campaign to withdraw all funds.

### Contributor flow
1. Connect wallet in the UI (Sepolia).
2. Enter a contribution amount.
3. The app encrypts the amount via the relayer and submits the transaction.
4. The encrypted balance is updated on-chain.

## Data model and accounting
- **Clear values:** `totalRaised` and `clearContributions` are used for UI display and analytics.
- **Encrypted values:** `encryptedTotalRaised` and `encryptedContributions` are the FHE-protected ledger.
- **Consistency:** The UI and Hardhat tasks send the same numeric value for `msg.value` and the encrypted input to keep clear and encrypted totals aligned.

## Limitations and assumptions
- ETH transfer values are visible on-chain; encryption protects stored balances and encrypted totals, not the transaction value itself.
- The organizer can close the campaign at any time; no refunds are implemented.
- Encrypted accounting relies on the Zama relayer for correct proofs.

## Future roadmap
- Per-campaign access control (multiple organizers or admins).
- Optional refund flow after end time if goal is not met.
- Multi-currency support (ERC-20 + encrypted token amounts).
- Front-end analytics dashboard with encrypted insights.
- Configurable campaign phases and milestone-based withdrawals.
- On-chain verification hooks for community attestations.

## License
BSD 3-Clause Clear
