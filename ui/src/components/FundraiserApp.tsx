import { useEffect, useMemo, useState } from 'react';
import { useAccount, useReadContract } from 'wagmi';
import { Contract, ZeroAddress, ZeroHash, formatEther, parseEther } from 'ethers';
import { isAddress, zeroAddress } from 'viem';

import { Header } from './Header';
import { FUNDRAISER_ABI, FUNDRAISER_ADDRESS, MAX_UINT64 } from '../config/contracts';
import { useZamaInstance } from '../hooks/useZamaInstance';
import { useEthersSigner } from '../hooks/useEthersSigner';
import '../styles/Fundraiser.css';

type CampaignTuple = readonly [string, bigint, bigint, boolean, bigint, string];
type ContributionTuple = readonly [string, bigint, bigint];

export function FundraiserApp() {
  const { address } = useAccount();
  const { instance, isLoading: zamaLoading, error: zamaError } = useZamaInstance();
  const signerPromise = useEthersSigner();

  const [contractAddress, setContractAddress] = useState<string>(FUNDRAISER_ADDRESS);
  const [contributionValue, setContributionValue] = useState<string>('');
  const [configForm, setConfigForm] = useState({ name: '', goal: '', endTime: '' });
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [decrypting, setDecrypting] = useState(false);
  const [decryptedContribution, setDecryptedContribution] = useState<string | null>(null);
  const [decryptedTotal, setDecryptedTotal] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [updating, setUpdating] = useState(false);

  const isContractReady = useMemo(
    () => contractAddress !== '' && isAddress(contractAddress) && contractAddress !== zeroAddress,
    [contractAddress],
  );

  const campaignDetails = useReadContract({
    address: isContractReady ? (contractAddress as `0x${string}`) : undefined,
    abi: FUNDRAISER_ABI,
    functionName: 'getCampaignDetails',
    query: { enabled: isContractReady, refetchInterval: 8000 },
  });

  const contributionInfo = useReadContract({
    address: isContractReady && address ? (contractAddress as `0x${string}`) : undefined,
    abi: FUNDRAISER_ABI,
    functionName: 'getContribution',
    args: address && isContractReady ? [address] : undefined,
    query: { enabled: isContractReady && !!address, refetchInterval: 8000 },
  });

  const encryptedTotalQuery = useReadContract({
    address: isContractReady ? (contractAddress as `0x${string}`) : undefined,
    abi: FUNDRAISER_ABI,
    functionName: 'getEncryptedTotalRaised',
    query: { enabled: isContractReady, refetchInterval: 12000 },
  });

  const campaign: CampaignTuple | undefined = campaignDetails.data as CampaignTuple | undefined;
  const contribution: ContributionTuple | undefined = contributionInfo.data as ContributionTuple | undefined;

  const raisedWei = campaign ? campaign[4] : 0n;
  const goalWei = campaign ? campaign[1] : 0n;
  const endTime = campaign ? Number(campaign[2]) : 0;
  const isClosed = campaign ? campaign[3] : false;
  const organizer = campaign ? campaign[5] : ZeroAddress;
  const isOrganizer = organizer !== ZeroAddress && address?.toLowerCase() === organizer.toLowerCase();
  const endDate = endTime ? new Date(endTime * 1000) : null;
  const isExpired = endTime ? Date.now() >= endTime * 1000 : false;

  const progress = useMemo(() => {
    if (!goalWei || goalWei === 0n) return 0;
    const ratio = Number(raisedWei * 10000n / goalWei) / 100;
    return Math.min(ratio, 100);
  }, [goalWei, raisedWei]);
  const progressLabel = useMemo(() => progress.toFixed(1), [progress]);

  useEffect(() => {
    if (campaign && configForm.name === '') {
      setConfigForm({
        name: campaign[0],
        goal: formatEther(campaign[1]),
        endTime: new Date(Number(campaign[2]) * 1000).toISOString().slice(0, 16),
      });
    }
  }, [campaign, configForm.name]);

  const handleContribution = async () => {
    if (!isContractReady) {
      setTxStatus('Add a deployed fundraiser address first.');
      return;
    }
    if (!address) {
      setTxStatus('Connect a wallet to contribute.');
      return;
    }
    if (!instance) {
      setTxStatus('Encryption service is not ready yet.');
      return;
    }
    const signer = await signerPromise;
    if (!signer) {
      setTxStatus('No signer available.');
      return;
    }

    try {
      const parsedValue = contributionValue.trim() === '' ? 0n : parseEther(contributionValue);
      if (parsedValue <= 0n) {
        setTxStatus('Enter a contribution amount in ETH.');
        return;
      }
      if (parsedValue > MAX_UINT64) {
        setTxStatus('Contribution is above uint64 limit; use a smaller amount.');
        return;
      }

      setTxStatus('Encrypting your contribution...');
      const input = instance.createEncryptedInput(contractAddress, address);
      input.add64(parsedValue);
      const encrypted = await input.encrypt();

      const contract = new Contract(contractAddress, FUNDRAISER_ABI, signer);
      setTxStatus('Waiting for confirmation...');
      const tx = await contract.contribute(encrypted.handles[0], encrypted.inputProof, { value: parsedValue });
      await tx.wait();
      setTxStatus('Contribution submitted successfully.');
      setContributionValue('');
      setDecryptedContribution(null);
      setDecryptedTotal(null);
      campaignDetails.refetch?.();
      contributionInfo.refetch?.();
      encryptedTotalQuery.refetch?.();
    } catch (err) {
      console.error(err);
      setTxStatus(err instanceof Error ? err.message : 'Failed to contribute.');
    }
  };

  const handleConfigure = async () => {
    if (!isContractReady) {
      setTxStatus('Add a deployed fundraiser address first.');
      return;
    }
    if (!isOrganizer) {
      setTxStatus('Only the organizer can update campaign settings.');
      return;
    }
    if (!instance) {
      setTxStatus('Encryption service is not ready yet.');
      return;
    }
    const signer = await signerPromise;
    if (!signer) {
      setTxStatus('No signer available.');
      return;
    }

    try {
      if (!configForm.name.trim()) {
        setTxStatus('Campaign name is required.');
        return;
      }
      const goal = parseEther(configForm.goal || '0');
      if (goal <= 0n) {
        setTxStatus('Goal must be greater than zero.');
        return;
      }
      const parsedEnd = Date.parse(configForm.endTime);
      const endTimestamp = Number.isNaN(parsedEnd) ? 0 : Math.floor(parsedEnd / 1000);
      if (endTimestamp <= Math.floor(Date.now() / 1000)) {
        setTxStatus('End time must be in the future.');
        return;
      }

      setUpdating(true);
      setTxStatus('Updating campaign...');
      const contract = new Contract(contractAddress, FUNDRAISER_ABI, signer);
      const tx = await contract.configureCampaign(configForm.name.trim(), goal, endTimestamp);
      await tx.wait();
      setTxStatus('Campaign details updated.');
      campaignDetails.refetch?.();
    } catch (err) {
      console.error(err);
      setTxStatus(err instanceof Error ? err.message : 'Failed to update campaign.');
    } finally {
      setUpdating(false);
    }
  };

  const handleDecryptContribution = async () => {
    if (!isContractReady || !contribution || !address || !instance) {
      setTxStatus('Need a contract, signer, and encrypted contribution.');
      return;
    }
    const encryptedHandle = contribution[0];
    if (!encryptedHandle || encryptedHandle === ZeroHash) {
      setTxStatus('No encrypted contribution to decrypt.');
      return;
    }
    const signer = await signerPromise;
    if (!signer) {
      setTxStatus('No signer available.');
      return;
    }

    try {
      setDecrypting(true);
      const keypair = instance.generateKeypair();
      const startTimeStamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '10';
      const contractAddresses = [contractAddress];
      const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimeStamp, durationDays);
      const signature = await signer.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message
      );

      const result = await instance.userDecrypt(
        [{ handle: encryptedHandle, contractAddress }],
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        address,
        startTimeStamp,
        durationDays
      );
      const decryptedValue = result[encryptedHandle] ?? '0';
      setDecryptedContribution(decryptedValue.toString());
      setTxStatus('Contribution decrypted locally.');
    } catch (err) {
      console.error(err);
      setTxStatus(err instanceof Error ? err.message : 'Failed to decrypt contribution.');
    } finally {
      setDecrypting(false);
    }
  };

  const handleDecryptTotal = async () => {
    if (!isContractReady || !encryptedTotalQuery.data || !instance || !address) {
      setTxStatus('Need a contract, signer, and encrypted total.');
      return;
    }
    const encryptedHandle = encryptedTotalQuery.data as string;
    if (!encryptedHandle || encryptedHandle === ZeroHash) {
      setTxStatus('No encrypted total recorded yet.');
      return;
    }
    const signer = await signerPromise;
    if (!signer) {
      setTxStatus('No signer available.');
      return;
    }

    try {
      setDecrypting(true);
      const keypair = instance.generateKeypair();
      const startTimeStamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = '10';
      const contractAddresses = [contractAddress];
      const eip712 = instance.createEIP712(keypair.publicKey, contractAddresses, startTimeStamp, durationDays);
      const signature = await signer.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message
      );

      const result = await instance.userDecrypt(
        [{ handle: encryptedHandle, contractAddress }],
        keypair.privateKey,
        keypair.publicKey,
        signature.replace('0x', ''),
        contractAddresses,
        address,
        startTimeStamp,
        durationDays
      );
      const decryptedValue = result[encryptedHandle] ?? '0';
      setDecryptedTotal(decryptedValue.toString());
      setTxStatus('Encrypted total decrypted locally.');
    } catch (err) {
      console.error(err);
      setTxStatus(err instanceof Error ? err.message : 'Failed to decrypt total.');
    } finally {
      setDecrypting(false);
    }
  };

  const handleCloseCampaign = async () => {
    if (!isContractReady) {
      setTxStatus('Add a deployed fundraiser address first.');
      return;
    }
    if (!isOrganizer) {
      setTxStatus('Only the organizer can close the campaign.');
      return;
    }
    const signer = await signerPromise;
    if (!signer) {
      setTxStatus('No signer available.');
      return;
    }

    try {
      setClosing(true);
      setTxStatus('Closing campaign and withdrawing funds...');
      const contract = new Contract(contractAddress, FUNDRAISER_ABI, signer);
      const tx = await contract.closeCampaign();
      await tx.wait();
      setTxStatus('Campaign closed. Funds sent to organizer.');
      campaignDetails.refetch?.();
    } catch (err) {
      console.error(err);
      setTxStatus(err instanceof Error ? err.message : 'Failed to close campaign.');
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="fundraiser-shell">
      <Header />

      <section className="fundraiser-hero">
        <div>
          <p className="eyebrow">Encrypted community funding</p>
          <h1>PrismLift</h1>
          <p className="subtitle">
            Run a fully on-chain ETH fundraiser while every contribution is protected with Zama FHE. Goals, timelines,
            and payouts stay transparent—individual amounts stay encrypted.
          </p>
          <div className="contract-input">
            <label htmlFor="contractAddress">Fundraiser contract</label>
            <input
              id="contractAddress"
              value={contractAddress}
              onChange={(e) => setContractAddress(e.target.value.trim())}
              placeholder="0x... (deployed on Sepolia)"
            />
            {!isContractReady ? (
              <p className="hint">Paste the deployed contract from deployments/sepolia.</p>
            ) : (
              <p className="hint success">Contract connected.</p>
            )}
          </div>
        </div>
        <div className="hero-card">
          <div className="hero-row">
            <div>
              <p className="label">Raised</p>
              <h2>{formatEther(raisedWei)} ETH</h2>
              <p className="label">Target · {formatEther(goalWei)} ETH</p>
            </div>
            <div className="progress-chip">{progressLabel}%</div>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="hero-row">
            <div>
              <p className="label">Ends</p>
              <p className="value">{endDate ? endDate.toLocaleString() : 'Not set'}</p>
            </div>
            <div>
              <p className="label">Status</p>
              <p className={`status ${isClosed ? 'closed' : isExpired ? 'expired' : 'active'}`}>
                {isClosed ? 'Closed' : isExpired ? 'Expired' : 'Active'}
              </p>
            </div>
          </div>
          <div className="hero-row subtle">
            <div>
              <p className="label">Organizer</p>
              <p className="value monospace">{organizer}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid">
        <div className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Participate</p>
              <h3>Contribute with encrypted amount</h3>
            </div>
            <span className="chip">No mocks · On-chain ETH</span>
          </div>
          <div className="form-row">
            <label htmlFor="contribution">Contribution (ETH)</label>
            <input
              id="contribution"
              type="number"
              min="0"
              step="0.0001"
              value={contributionValue}
              onChange={(e) => setContributionValue(e.target.value)}
              placeholder="0.25"
            />
          </div>
          <button className="primary" onClick={handleContribution} disabled={zamaLoading || !isContractReady}>
            {zamaLoading ? 'Initializing Zama...' : 'Send encrypted contribution'}
          </button>
          <div className="inline-stats">
            <div>
              <p className="label">Your clear total</p>
              <p className="value">
                {contribution ? `${formatEther(contribution[1])} ETH` : address ? '0.0 ETH' : 'Connect wallet'}
              </p>
            </div>
            <div>
              <p className="label">Last contribution</p>
              <p className="value">
                {contribution && Number(contribution[2]) > 0
                  ? new Date(Number(contribution[2]) * 1000).toLocaleString()
                  : '—'}
              </p>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Visibility</p>
              <h3>Decrypt with your key</h3>
            </div>
            <span className="chip ghost">{zamaLoading ? 'Loading relayer' : 'Zama relayer ready'}</span>
          </div>
          <p className="helper">
            Use local keys to decrypt your encrypted balance. The organizer can also decrypt the encrypted total raised.
          </p>
          <div className="button-row">
            <button
              className="secondary"
              onClick={handleDecryptContribution}
              disabled={decrypting || zamaLoading || !contribution}
            >
              {decrypting ? 'Decrypting...' : 'Decrypt my contribution'}
            </button>
            <button
              className="secondary"
              onClick={handleDecryptTotal}
              disabled={decrypting || zamaLoading || !encryptedTotalQuery.data || !isOrganizer}
              title={isOrganizer ? 'Decrypt encrypted total' : 'Only the organizer can decrypt the total'}
            >
              {decrypting ? 'Decrypting...' : 'Decrypt total (organizer)'}
            </button>
          </div>
          <div className="decrypt-grid">
            <div className="decrypt-pill">
              <p className="label">Decrypted contribution (wei)</p>
              <p className="value monospace">{decryptedContribution ?? '—'}</p>
            </div>
            <div className="decrypt-pill">
              <p className="label">Decrypted total (wei)</p>
              <p className="value monospace">{decryptedTotal ?? '—'}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid">
        <div className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Campaign settings</p>
              <h3>Set name, goal, and deadline</h3>
            </div>
            <span className="chip">{isOrganizer ? 'You are the organizer' : 'Read-only'}</span>
          </div>
          <div className="form-grid">
            <label>
              <span>Campaign name</span>
              <input
                value={configForm.name}
                onChange={(e) => setConfigForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="PrismLift Seed Round"
              />
            </label>
            <label>
              <span>Goal (ETH)</span>
              <input
                type="number"
                min="0"
                step="0.1"
                value={configForm.goal}
                onChange={(e) => setConfigForm((prev) => ({ ...prev, goal: e.target.value }))}
                placeholder="12"
              />
            </label>
            <label>
              <span>End time (UTC)</span>
              <input
                type="datetime-local"
                value={configForm.endTime}
                onChange={(e) => setConfigForm((prev) => ({ ...prev, endTime: e.target.value }))}
              />
            </label>
          </div>
          <div className="button-row">
            <button className="primary ghost" onClick={handleConfigure} disabled={!isOrganizer || updating}>
              {updating ? 'Updating...' : 'Save campaign settings'}
            </button>
            <button className="danger" onClick={handleCloseCampaign} disabled={!isOrganizer || closing}>
              {closing ? 'Closing...' : 'Close campaign & withdraw'}
            </button>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <p className="eyebrow">Live signals</p>
              <h3>What the contract sees</h3>
            </div>
          </div>
          <div className="insight-grid">
            <div className="insight">
              <p className="label">Contract balance</p>
              <p className="value">{formatEther(raisedWei)} ETH</p>
            </div>
            <div className="insight">
              <p className="label">Encrypted total handle</p>
              <p className="value monospace tiny">
                {encryptedTotalQuery.data ? (encryptedTotalQuery.data as string).slice(0, 18) + '...' : '—'}
              </p>
            </div>
            <div className="insight">
              <p className="label">Goal remaining</p>
              <p className="value">
                {goalWei > raisedWei ? `${formatEther(goalWei - raisedWei)} ETH` : 'Goal reached'}
              </p>
            </div>
            <div className="insight">
              <p className="label">Status</p>
              <p className="value">{isClosed ? 'Closed' : isExpired ? 'Past deadline' : 'Active'}</p>
            </div>
          </div>
          {txStatus && <div className="status-box">{txStatus}</div>}
          {zamaError && <div className="status-box error">{zamaError}</div>}
        </div>
      </section>
    </div>
  );
}
