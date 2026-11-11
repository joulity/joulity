// Real accounts: Privy email / Google login creates a NEAR mainnet wallet for the user.
// Privy holds the key in split form; nobody at Joulity can sign for the user.
import { PrivyProvider, usePrivy } from '@privy-io/react-auth';
import { useCreateWallet, useSignRawHash } from '@privy-io/react-auth/extended-chains';
import type { Signer } from './relay';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { balances, type Chain } from './near';

// public app id (not a secret)
export const PRIVY_APP_ID = 'cmw0q72r501jx0fjqlnviauaf';

type Auth = {
  ready: boolean; authed: boolean; email: string; nearId: string;
  chain: Chain | null; chainErr: boolean; walletErr: string;
  login: () => void; logout: () => Promise<void>; refresh: () => void; sign: Signer;
};
const AuthCtx = createContext<Auth | null>(null);

function Bridge({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();
  const creating = useRef(false);
  const [walletErr, setWalletErr] = useState('');
  const [chain, setChain] = useState<Chain | null>(null);
  const [chainErr, setChainErr] = useState(false);

  const wallet = user?.linkedAccounts.find(a => a.type === 'wallet' && a.chainType === 'near');
  const nearId = wallet?.type === 'wallet' ? wallet.address : '';
  const email = user?.email?.address ?? user?.google?.email ?? '';

  // first login: make the NEAR wallet
  useEffect(() => {
    if (!authenticated || !user || nearId || creating.current) return;
    creating.current = true;
    setWalletErr('');
    createWallet({ chainType: 'near' })
      .catch(e => setWalletErr(String(e?.message ?? e)))
      .finally(() => { creating.current = false; });
  }, [authenticated, user, nearId, createWallet]);

  const refresh = useCallback(() => {
    if (!nearId) return;
    balances(nearId).then(c => { setChain(c); setChainErr(false); }).catch(() => setChainErr(true));
  }, [nearId]);

  useEffect(() => {
    setChain(null);
    if (!nearId) return;
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [nearId, refresh]);

  const sign: Signer = useCallback(async (hash) => (await signRawHash({ address: nearId, chainType: 'near', hash })).signature, [signRawHash, nearId]);
  const value: Auth = { ready, authed: authenticated, email, nearId, chain, chainErr, walletErr, login, logout, refresh, sign };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['email', 'google'],
        appearance: { theme: 'light', accentColor: '#111113', landingHeader: 'Sign in to Joulity', showWalletLoginFirst: false },
      }}
    >
      <Bridge>{children}</Bridge>
    </PrivyProvider>
  );
}

export const useAuth = () => useContext(AuthCtx)!;
