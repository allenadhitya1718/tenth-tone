// The one switch for the coin economy in the app. While false, the Wallet page
// and the live gift sheet show "coming soon" instead of balances, packages and
// gifts. The server refuses gifts too until app_limits.gifts_enabled is set
// (0156); flip both together at launch.
export const WALLET_LAUNCHED = true;
