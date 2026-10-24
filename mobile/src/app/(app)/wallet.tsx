import { WALLET_LAUNCHED } from '@/features/wallet/launch';
import { Wallet } from '@/features/wallet/Wallet';
import { WalletComingSoon } from '@/features/wallet/WalletComingSoon';

export default function Screen() {
  return WALLET_LAUNCHED ? <Wallet /> : <WalletComingSoon />;
}
