import { ConnectButton } from '@rainbow-me/rainbowkit';
import '../styles/Fundraiser.css';

export function Header() {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="orb" />
        <div>
          <span className="brand-name">PrismLift</span>
          <span className="brand-subtitle">Encrypted Fundraiser</span>
        </div>
      </div>
      <ConnectButton />
    </header>
  );
}
