# Make Auth0 feel like Sword

The in-game login page is in `apps/web`. The email/password page is hosted by
Auth0, so changing the game's CSS does not change that page. The settings below
make the two screens feel connected.

**Current status:** the game returns to `/#login` after sign-out. The custom
Auth0 template is prepared in `tools/auth0/universal-login.html`, but is **not
published to Auth0**. It needs the external setup below to appear to players.

The simpler Auth0 theme **is published**: the game's `meadow-sky.png` background,
serif type, cream paper, a warm 3px border, square widget corners, and short
storybook headings. The standalone logo area is hidden so the complete form fits
on a laptop screen. Moss remains on the in-game book page.

Both initial Log in and Sign up screens were checked without vertical overflow
at **1280×720**, **1366×768**, and **375×740**, with no credentials entered.
Password guidance, errors, browser zoom, and the mobile keyboard can add space;
scrolling remains available when needed rather than clipping form controls.

**Return to the book:** Log in and Sign up now open Auth0 in a popup while the
game's hero ledger stays open. Closing the popup leaves the player on that page;
the book also shows **Back to the book** to close the pending window. Popup
cancellation is not displayed as a login error. Successful authentication opens
game selection only after Auth0 confirms the signed-in state. Blocked popups
show instructions to allow the sign-in window and retry.

The app requests a 500×720 popup. Both initial Auth0 forms also fit a 500×640
content viewport without vertical overflow. Popup ownership/cleanup, blocked
windows, and provider cancellation are covered by frontend tests. The full
account sign-in/token exchange still requires a manual check from the game.

## Start here: colors, fonts, and the login card

1. Open [Auth0](https://manage.auth0.com/), select your Sword tenant, then open
   **Branding → Universal Login → Customization Options**.
2. Keep the **New Universal Login** experience. In the Styles editor, use:

   | Setting | Sword style |
   | --- | --- |
   | Page background | `#AAA0E4` — pastel lavender |
   | Widget/card background | `#F6ECD2` — light parchment |
   | Primary button | `#65753F` — moss green |
   | Primary button label | `#FFF6DD` — warm cream |
   | Main text | `#514832` — brown ink |
   | Links | `#526437` — dark green |
   | Input background | `#FFFBF0` |
   | Input border | `#B59B66` |
   | Font | Georgia / serif, if available in the font editor |
   | Corners | Small, approximately 2px |

3. Choose **Save and Publish**. Use **Try** to preview, then test both Log in
   and Sign up from the game. Branding themes can affect other apps in this tenant.
4. Under **Customize Text**, you can change the login title to **Welcome back,
   hero** and signup title to **Join the hero ledger**. Keep the email, password,
   and password-reset instructions clear.

These theme changes do not require installing anything in the repository.

## Add the “Back to Sword” button and storybook layout

Auth0 requires a configured **custom login domain** for New Universal Login
page templates. Its standard `dev-….us.auth0.com` domain does not render these
templates. Basic theme changes above are still useful without one.

Once a custom domain is available:

1. Open **Applications → Applications → Sword Web → Settings → Advanced Settings
   → Application Metadata**. Add `sword_web_url` with your website origin, without
   a trailing slash: `http://localhost:5173` for local development, or your actual
   public HTTPS website for the hosted game. This is public configuration.
   The button returns to that website's `/#login` page. When switching the active
   website between local and hosted, update this metadata value too.
2. Back up any existing Universal Login template before replacing it. With an
   authenticated [Auth0 CLI](https://auth0.com/docs/deploy-monitor/auth0-cli), run
   `auth0 universal-login customize`. Copy the contents of
   `tools/auth0/universal-login.html` into the template editor, preview, and save.
   Auth0's Management API is another supported way to upload the template.
3. The template adds an open book with cream pages, a green cloth cover,
   center binding, page numbers, Moss's note on the left, the login form on the
   right, a lavender background, and the
   **Back to Sword** button. Auth0 continues rendering the actual credential form,
   password reset, and other authentication prompts. It styles the surrounding
   page only for the existing Sword Web Client ID.
4. The frontend must authorize through the configured **custom Auth0 domain**
   for this template to appear. A custom Auth0 domain also changes the token's
   issuer; coordinate `VITE_AUTH0_DOMAIN` and the backend's
   `AUTH0_ISSUER_BASE_URL` for that domain, keeping the audience `https://sword-api`.
   Check the Auth0 connection/provider callback configuration before switching.
5. Test Log in, Sign up, password reset, the back button, successful game entry,
   and Sign out. The back button should return to the hero ledger without signing
   the player in. Until the custom template is activated, browser Back returns
   from Auth0 to the game's login page.

The back URL comes from administrator-managed application metadata, never a
player-supplied query parameter. Set it only to a website you control. A hosted
public game should point back to its public website, rather than localhost.

### Which code editor should I use?

The **Colors** fields accept color values, not HTML or instructions in plain
English. A complete book layout needs HTML/CSS in a supported template.

The **Advanced Options → Login → Customize Login Page** editor is for **Classic
Login**. It uses a different template format with Auth0 Lock or Auth0.js. Do not
paste our New Universal Login Liquid template into that editor. Auth0 no longer
updates Classic Login and recommends its current Universal Login customization
options. The prepared book template keeps the current New Universal Login flow.

Without a custom domain, the no-code editor can still use a publicly hosted
storybook background image, a matching hosted font, and a cream login card.
That gives a book-inspired appearance, while the full two-page layout requires
the page template setup above.

### Prepared visual-editor assets

These URLs are public assets for the simpler theme, without a custom domain:

- Font: `https://fonts.gstatic.com/s/librebaskerville/v24/kmKUZrc3Hgbbcjq75U4uslyuy4kn0olVQ-LglH6T17uj8Q4iDgNP.woff2`
- Moss emblem: `https://raw.githubusercontent.com/SwampHacks-XII/Sword/main/apps/web/public/art/moss.svg`
- Game background: `https://raw.githubusercontent.com/SwampHacks-XII/Sword/main/apps/web/public/art/meadow-sky.png`
- Alternative scalable pixel background: `https://raw.githubusercontent.com/SwampHacks-XII/Sword/main/apps/web/public/art/pixel-world.svg`
- Lighter paper: widget background `#F6ECD2`, input background `#FFFBF0`.
- Compact theme: hide the logo area; 14px reference text; subtitle, body,
  buttons, input labels, and links at 100%; title at 150%.
- Widget border: 3px; widget corners: 0px; input/button corners: 2px; shadow on.

The serif font, lighter paper colors, game background, and paper border were
published in Auth0 and each group was confirmed with **All changes are live**.
The dashboard initially returned a generic customization-save error for a
combined update, so apply future settings in small groups and verify each save.

The text editor uses **Welcome back, hero.** and **Your next chapter awaits.**
for login, and **Begin your legend.** and **Create an account to begin your story.**
for signup. Keep the Log in / Sign up links and credential labels clear.

The standard-domain visual editor does not add a custom **Back to Sword**
hyperlink to the login/signup widget. The prepared page template's link returns
to `/#login` once a custom domain is configured. Do not claim that link is live
just because the basic theme has been published. The currently selected popup
flow provides a way back without needing that link or buying a domain.

## Hosting address versus a login domain

Render supplies the game with an `onrender.com` address. Auth0's custom domain
requires a domain whose DNS records you can edit. A purchased or already-owned
domain can use separate subdomains: `play.example.com` points to Render, while
`login.example.com` points to the CNAME target provided by Auth0. The free Render
address is enough to host and play the game; a custom domain is optional for
hosting and needed for the full Auth0 page-template customization.

## Sign-out behavior

The app sends Auth0's `/v2/logout` endpoint a return URL ending in `/#login`,
so a player returns directly to Log in / Sign up. Keep the website origin in
**Sword Web → Settings → Allowed Logout URLs**, as in the existing setup.
Auth0 ignores fragments when checking this endpoint's logout allowlist.

## Official references

- [Theme editor](https://auth0.com/docs/customize/login-pages/universal-login/customize-themes)
- [Page templates, custom domains, and the Auth0 CLI](https://auth0.com/docs/customize/login-pages/universal-login/customize-templates)
- [Logout redirects](https://auth0.com/docs/authenticate/login/logout/redirect-users-after-logout)
- [Classic Login editor and its limitations](https://auth0.com/docs/customize/login-pages/classic-login/customize-with-lock-sdk)
