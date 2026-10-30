# Family Wish List

One wish list for the whole family, from any store, where the person a gift is for never sees what was bought.

![A shopper's view of a family member's list, with the names down the side](docs/screens/shopping-a-list.png)

Designed and built by **Steven Vanden Heuvel** ([Steven Design Co.](https://stevendesignco.com)). I built it for my own family's Christmas and birthday lists. This public copy uses made-up people (the Smiths, the Garcias) and is shared as a portfolio piece and for anyone who wants to run their own.

## Why I built it

Store wish lists tie a family to one store, and most list apps assume everyone is at ease with apps, accounts and passwords. My family includes grandparents who are not, and kids who are just learning to read a screen. So the brief was short:

- Any store, or something homemade.
- No passwords.
- Big, plain buttons that say what they do.
- A surprise that cannot be spoiled, even by someone who knows how to read a web page's data.

## What it does

- **One list per person,** from any store. Paste a link, tap the Add to Wish List button on a store's page (a bookmark on a computer, a Shortcut on iPhone, the Share menu on Android), or write something in, like "Grandma's cookies".
- **Shoppers mark what they bought,** go in together on a big gift, and add secret ideas to someone's list.
- **The person a list is for never sees** purchases, chip-ins or secret ideas.
- **Kids' lists,** kept by their parents. A child needs no email; a parent adds the list and decides whether the parents see purchases.
- **Who can see a list:** everyone in the family, or only the people the owner picks.
- **Draw names** (Secret Santa). Only the giver sees who they drew, not even the person who started the draw. Spending limit, give-by date, and pairs to keep apart; parents and their own kids never draw each other.
- **Ask to join.** A relative who is not on the list can ask from the sign-in page. Only the admin adds people.
- **My shopping:** everything you bought, in one place. Tap "It has been given" after a gift is opened. Anything still marked bought counts as given on December 26.
- **Sizes and favorites** on each list, so clothes fit and nobody gets peanuts by mistake.
- **First-run setup,** one question per screen, then a short tour that points at the real buttons.

<p>
  <img src="docs/screens/my-list-phone.png" width="250" alt="My list on a phone">
  <img src="docs/screens/i-bought-this-phone.png" width="250" alt="An item page on a phone, with I bought this">
  <img src="docs/screens/draw-names-phone.png" width="250" alt="Draw names on a phone, showing only your own match">
</p>

## The promise, kept on the server

Hiding purchases in the page is not enough: anyone can open a browser's developer tools and read the data a page receives. So the rule lives on the server, in [`site/lib/lists/rules.js`](site/lib/lists/rules.js) (`view()`). When you open your own list, your browser is never sent who bought what, who chipped in, or the secret ideas others added. The same function leaves out lists that are not shared with you, and the full list of name draw matches is never sent to anyone.

Every change goes through the same file (`apply()`), which checks who is asking before it saves anything. The API tests check the rule from every side, including twelve random name draws per run checked against every pairing rule.

## Designed for grandparents and kids

- **One job per screen:** a list, one item, My shopping, Draw names, or People.
- **The Back button works.** Every screen has its own address, and forms and confirm steps have their own history entry, so Back closes them instead of leaving the page.
- **Plain words on big buttons:** "Buy it at REI", "I bought this", "It has been given". Text links for quieter actions, like "Skip the tips".
- **Cards carry no buttons.** Each card is one link to the item's page, where the buttons are.
- **No passwords.** Sign-in is a six-digit code (or link) by email, and you stay signed in on that device for a year. The code exists because a phone's email app often opens links in its own browser.
- **16px text at the smallest, 44px tap targets,** and messages that stay on screen until the next action.
- **Tour tips that point at the real thing.** On a computer each tip sits beside the button it describes, with an arrow; on a phone it docks at the bottom or top, wherever it does not cover the button.

![A tour tip beside the Add an item button](docs/screens/tour-desktop.png)

## Accessibility and testing

Everything is driven the way a person would use it, in a real browser:

- **api:** about 400 checks of the rules, sign-in, photos, link lookups, robots.txt, list sharing, join requests and name draws.
- **flow, onboard, family:** click-through suites in Chromium on a computer and a phone, from first sign-in to drawing names.
- **screens:** 48 screens in light and dark, at phone and computer widths, each run through [axe](https://github.com/dequelabs/axe-core) for WCAG 2.2 AA, with checks for sideways scrolling and page errors.
- **grid:** fields that sit side by side line up.
- **check:styles:** proves the trimmed design system styles match the full ones, element by element.

Automated runs are not the whole story. A real iPhone showed the tour tip filling the screen when every automated WebKit run said it was a quarter of the height. iOS 26 Safari sizes a modal dialog to its full maximum height. It is fixed (`height: auto`), and phone screens are now also checked in the iOS Simulator.

## Built with

- **Plain HTML, CSS and JavaScript.** No framework and no build step.
- **Vercel Functions,** all routes served by one function ([`site/api/lists/[route].js`](site/api/lists/[route].js)), and **Vercel Blob** storage: one JSON file, saved with an ETag check so two people saving at once never overwrite each other.
- **Resend** for the sign-in emails.
- **SDC,** the Steven Design Co. design system: its tokens and its Button, Field, Select, Choice and Fieldset components. This repo carries **SDC lite**, the parts of SDC the app uses, generated by [`scripts/trim-sdc.mjs`](scripts/trim-sdc.mjs).
- **Playwright** and **axe-core** for the tests.

## Store links, and the line this app does not cross

Big stores (Amazon, Target, LEGO, REI, Etsy, Best Buy) do not let apps read their pages. This app names itself honestly, honors each store's robots.txt, and never pretends to be a browser to get around a block. Instead:

- **The store button** reads the product page you are already looking at, in your own browser, and brings its name, photo and price to your list.
- **A pasted link** still gets a name when the store says no: most store links carry the product name in the address itself, so the app reads it from the link without contacting the store.

<p>
  <img src="docs/screens/setup-phone.png" width="250" alt="The first setup screen on a phone">
  <img src="docs/screens/who-can-see-phone.png" width="250" alt="Choosing who can see your list">
</p>

## Run it on your computer

You need [Node.js](https://nodejs.org) 20 or newer.

```
git clone https://github.com/vandy1690/family-wish-list.git
cd family-wish-list
npm install
npx playwright install chromium     # once, for the tests
npm run dev                         # http://localhost:4380/lists
```

Sign in as `john@example.com`. No email is sent on your computer: the code appears in the sign-in box. The first address to sign in becomes the admin. Data is kept in `.data/`.

```
npm test               # api, flow, onboard, family, grid
npm run test:screens   # every screen, with axe, into .test-output/screens/
npm run docs:screens   # also refreshes the screenshots in docs/screens/
```

## Deploy your own

You need a [Vercel](https://vercel.com) account (the free plan is enough) and a [Resend](https://resend.com) account with a domain you can add DNS records to.

1. **Fork this repo.** In Vercel, make a new project from your fork and set its Root Directory to `site`.
2. **Storage:** in the project's Storage tab, create a Blob store and connect it. That adds `BLOB_READ_WRITE_TOKEN` for you.
3. **Email:** in Resend, add your domain, add the DNS records it shows, and make an API key once it says Verified.
4. **Settings:** add these environment variables in the Vercel project.

   | Variable | What it is |
   |---|---|
   | `LISTS_SECRET` | A long random string that signs sign-in links. Make one with `openssl rand -hex 32`. |
   | `LISTS_ORIGIN` | Where the app lives, like `https://wishlist.example.com`. |
   | `LISTS_ADMIN_EMAIL` | Your email. The first sign-in must use it, and becomes the admin. |
   | `RESEND_API_KEY` | The key from Resend. |

   Optional:

   | Variable | What it is |
   |---|---|
   | `LISTS_ADMIN_NAME` | Your name for the first sign-in. You can change it on People later. |
   | `LISTS_FROM` | The sender. Default: `<short name> <lists@your-domain>`, from `LISTS_ORIGIN`. |
   | `LISTS_REPLY_TO` | Where replies go. Default: `LISTS_ADMIN_EMAIL`. |
   | `LISTS_TITLE`, `LISTS_SHORT_TITLE` | Starting names for the list. The People page overrides them. |
   | `LISTS_CONTACT_EMAIL` | The footer's "Email" link. Default: `LISTS_ADMIN_EMAIL`. |
   | `LISTS_ADOBE_FONTS_KIT` | An Adobe Fonts project id, for the SDC display face (see Fonts). |

5. **Deploy,** then open `/api/lists/health`. Every value should be `true`.
6. **Sign in** with `LISTS_ADMIN_EMAIL`, go through setup, then on **People** give the list its name and add your family.

## Fonts

Body text is **Inter**, included (SIL Open Font License, in `site/lists/fonts/`). Headings are designed for **Nickel Gothic Variable**, an Adobe font that cannot be shared in a repo. Without it, headings fall back to Inter and everything still works.

If you have Adobe Fonts (any Creative Cloud plan), you can have the intended look: in Adobe Fonts, make a Web Project with Nickel Gothic Variable, add your domain to it, and set `LISTS_ADOBE_FONTS_KIT` to the project id.

## How the code is laid out

```
site/                      what gets deployed (the Vercel Root Directory)
  lists/                   the page: index.html, app.js, lists.css, sdc-lite.css, fonts/
  lists-sw.js              lets Android install the page, so it shows up in the Share menu
  api/lists/[route].js     one function for every /api/lists/... address
  lib/lists/
    rules.js               who sees what, and every change anyone can make
    store.js               Vercel Blob storage, with ETag-checked saves
    auth.js                sign-in links, codes and sessions
    meta.js                reading store links: robots.txt, safety checks, names from links
    mail.js, site.js       email, and the names of this wish list
    routes/                data, login, verify, logout, lookup, photo, request, config, health
dev/server.mjs             the local server
tests/                     the suites above, and run.mjs, which gives each one a fresh server
scripts/                   trim-sdc.mjs, check-styles.mjs
docs/screens/              the screenshots in this README
```

## License

MIT, for the code and SDC lite. See [LICENSE](LICENSE). Inter is under the SIL Open Font License 1.1. Nickel Gothic is not included; it is licensed through Adobe Fonts.
