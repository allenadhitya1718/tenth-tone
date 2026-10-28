# Coin purchases: store setup

Everything in the app and on the server is ready (checked 28 Oct 2026):

- The app's buy flow (`mobile/src/features/wallet/store.ts`) only finishes a purchase after the server confirms it.
- The Play billing permission is added by expo-iap.
- Until a product exists in the store, the Recharge page shows "not available" for it and the button stays grey.
- Server functions deployed on Mumbai: `verify-purchase`, `apple-notifications` and `play-voided-purchases` (the last runs every 6 hours).

What is left needs the owner's accounts. Do the steps in order.

## 1. Agreements and bank (start first, approval takes 1-2 days)

- **Apple:** App Store Connect, Business: sign the **Paid Apps** agreement and add the bank account and tax forms.
- **Google:** Play Console, Settings, Payments profile: create the merchant account and add the bank account.

## 2. The 8 coin products

Use the product IDs exactly as written. Prices are the ones in the database (`coin_packages`). If a store has no exact SAR price point, pick the nearest one and change `price_label` in the admin panel (Gift list & coin packs) to match. The app shows the store's price anyway.

| Product ID | Coins | Price (SAR) | Name (EN) | Name (AR) |
|---|---|---|---|---|
| flyp.coins.65 | 65 | 2.99 | 65 Coins | 65 عملة |
| flyp.coins.330 | 330 | 12.99 | 330 Coins | 330 عملة |
| flyp.coins.660 | 660 | 25.99 | 660 Coins | 660 عملة |
| flyp.coins.1321 | 1,321 | 52.99 | 1,321 Coins | 1,321 عملة |
| flyp.coins.3303 | 3,303 | 129.99 | 3,303 Coins | 3,303 عملة |
| flyp.coins.6607 | 6,607 | 259.99 | 6,607 Coins | 6,607 عملة |
| flyp.coins.13214 | 13,214 | 519.99 | 13,214 Coins | 13,214 عملة |
| flyp.coins.33035 | 33,035 | 1,299.99 | 33,035 Coins | 33,035 عملة |

Description, the same for every pack:

- EN: `Coins to send gifts in FLYP LIVE.`
- AR: `عملات لإرسال الهدايا في بث FLYP المباشر.`

### Apple (app `com.flyp.social`)
App Store Connect, the app, Monetization, In-App Purchases, `+`:

1. Type **Consumable**. Reference name: the product ID. Product ID: from the table.
2. Price: Saudi Arabia as the base country, then the price from the table.
3. Localizations: English and Arabic, with the name and description above.
4. Review information: a screenshot of the Recharge page. Notes: "Coins are spent on gifts for creators in live audio rooms."
5. The products are reviewed together with the next app version: add them under "In-App Purchases" on the version page before submitting.

### Google (app `com.flyp.app`)
Play Console, the app, Monetize, Products, In-app products:

1. Products can only be created once a build with billing is on a track. Upload the current dev build to **Internal testing** first if the page says so.
2. Create the product: the ID from the table, the name and description above (English plus an Arabic translation), and the price.
3. Set each product to **Active**.

## 3. Keys for `verify-purchase`

Supabase, Edge Functions, Secrets. Only the owner sets these.

| Secret | Where it comes from |
|---|---|
| `APPLE_IAP_KEY_ID` | App Store Connect, Users and Access, Integrations, In-App Purchase: generate a key |
| `APPLE_IAP_ISSUER_ID` | same page, Issuer ID |
| `APPLE_IAP_PRIVATE_KEY` | the downloaded `.p8` file, its whole contents |
| `APPLE_BUNDLE_ID` | `com.flyp.social` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Google Cloud: create a service account and a JSON key. Then Play Console, Users and permissions: invite its email with **View financial data** and **Manage orders and subscriptions** for FLYP |

`GOOGLE_PLAY_PACKAGE_NAME` is optional (default `com.flyp.app`). The same Google service account is also used by `play-voided-purchases` for refunds.

## 4. Apple refund notifications

App Store Connect, the app, App Information, App Store Server Notifications. Set both the Production and Sandbox URL to:

```
https://vfkwipvinmnybilcrdzr.supabase.co/functions/v1/apple-notifications
```

Pick **Version 2**. Google needs nothing extra.

## 5. Test purchases (no real money)

- **Google:** Play Console, Settings, License testing: add the tester Gmail. The tester installs from the Internal testing link.
- **Apple:** App Store Connect, Users and Access, Sandbox: create a tester; sign in to it on the iPhone under Settings, App Store, Sandbox Account.
- **Server, during the test only:** set `IAP_ALLOW_SANDBOX` to `true`, and `IAP_SANDBOX_USER_IDS` to the FLYP user id(s) of the test accounts (Supabase, Authentication, Users). Without both, a test purchase is refused on purpose, so nobody can mint free coins with a tester account.

Then test:

1. Buy the smallest pack.
2. Check that the balance rises.
3. Check that the History tab shows "credited".
4. Send a gift on a live.
5. Check the diamonds on the creator's Earnings tab.
6. Refund the test order and check that the coins are taken back.

## 6. Store review and going live

- Give Apple and Google a demo account. While the build is in review, keep its user id in `IAP_SANDBOX_USER_IDS` with `IAP_ALLOW_SANDBOX=true`, because reviewers buy with test money.
- After approval, set `IAP_ALLOW_SANDBOX` back to `false` and clear `IAP_SANDBOX_USER_IDS`.

## Payouts

Already built. A creator asks for a withdrawal of at least 40 SAR. An admin approves it in the admin panel (Payouts) and pays it by bank transfer. The diamond value and the minimum are in Payout settings.
