// Privy lists Solana, smart-wallet and Farcaster packages as optional peers.
// Joulity uses only email/Google login and the NEAR wallet, so those imports resolve to an empty module.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const OPTIONAL = ['@solana/kit', '@solana-program/', 'permissionless', '@farcaster/mini-app-solana', '@abstract-foundation/agw-client'];

config.resolver.resolveRequest = (context, name, platform) => {
  if (OPTIONAL.some(p => name === p || name.startsWith(p.endsWith('/') ? p : p + '/'))) return { type: 'empty' };
  return context.resolveRequest(context, name, platform);
};

module.exports = config;
