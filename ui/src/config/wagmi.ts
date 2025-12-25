import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { sepolia } from 'wagmi/chains';

export const config = getDefaultConfig({
  appName: 'PrismLift',
  projectId: 'b227a8d1c9d4483cc4fce6f36f1b0e0c',
  chains: [sepolia],
  ssr: false,
});
