# Workday: start here (handoff for a new chat)

If a chat runs out of room, start a new chat and paste this:

> I'm Shmuel. I have an app called Workday. Everything is in my GitHub repo **Shmuel-pixel/workday**. Read `HANDOFF.md` in that repo first, then keep working on the app the same way.

Download everything any time: **https://github.com/Shmuel-pixel/workday/archive/refs/heads/main.zip**

---

## What Workday is
A home-screen web app (iPhone and iPad) for Shmuel, a scheduler at Five Star Services (construction and demolition, Lakewood NJ).
- Today board: To-Do on top, Done below. Swipe right = done, swipe left = back. Drag the handle to reorder. Tap a card to open and edit it (title, optional tags, notes and photos, links).
- Hebrew/English calendar (tap the date). Yomim Tovim, Erev, Chol Hamoed, fasts, Shabbos, US legal holidays. No modern Israeli holidays. Never schedule work on Shabbos or Yom Tov.
- Zmanim from KosherJava (KosherZmanim 0.9.0) with location setting. Mincha reminder 1 hour before shkia, Motzei Shabbos at shkia + 72.
- Reminders as phone notifications (morning brief 7:30, summary 6 PM, Trello 8 PM, Erev summary, mincha, Motzei). None on Friday night, Shabbos or Yom Tov.
- Messages tab: WhatsApp Business inbox (test mode until WhatsApp is connected).
- Assistant: talk or type. Speech to text, answers spoken. Finds places (Google Maps + web) with Maps and Waze links. Adds and changes jobs.
- Translate tab: Stern Translator rules, language on top and English under it, optional transliteration ("how to say it"). "Write a text": Dale Carnegie, clean up, clear and firm, shorter.
- Tools tab: Equipment (Equipment Manager sheet) and Keys (permanent serial numbers).
- Dumpsters tab (Dumpster Log sheet). Orders tab is a placeholder.
- Five Star card button + "Fill from Workday" bookmarklet for the Five Star card maker page.
- Home Screen widget through the Scriptable app.
- Set up another device with a 6-digit code.

## Live addresses
- App: https://shmuel-pixel.github.io/workday/
- Messages service (Cloudflare Worker): https://workday-messages.shmuel-4f0.workers.dev
- Workday Connect (Google Apps Script web app): the address is saved only on Shmuel's devices and in his Apps Script. Do not put it in this repo (its page shows the connection code).

## Files in this repo
- `index.html` the built app (do not edit by hand; build it from `src/workday.html`).
- `sw.js` offline cache + push notifications. `manifest.webmanifest`, `icons/`.
- `src/workday.html` THE SOURCE of the app. `src/build.py` turns it into `index.html` and bumps the cache version in `sw.js`.
- `src/connect/Code.gs` Workday Connect (Google Apps Script). The token here is a placeholder; the real code is in Shmuel's Google Doc "Workday Connect - code to copy (v2)".
- `src/claude-project-instructions.md` instructions for the Claude Project "Workday" (manage the app from the Claude app through the Google Sheet).
- `src/fill/` Five Star card maker bookmarklet. `src/widget/` Scriptable widget. `src/tools/drop.js` seals jobs for the Workday inbox.
- `worker/` the messages service (Cloudflare Worker, Durable Object with SQLite). Deploys automatically from GitHub Actions (`.github/workflows/deploy-messages.yml`) using the repo secret `CLOUDFLARE_API_TOKEN`. Account ID is in `worker/wrangler.toml`.
- `.github/workflows/inbox.yml` lets Claude drop sealed, signed jobs into the app.

## How to change the app
1. Edit `src/workday.html` (keep it ONE file).
2. Rules: ASCII only in the file (use \uXXXX escapes for other characters), no template literals, string concatenation, plain functions. Bump `APPVER`.
3. Build: put `workday.html` and `build.py` side by side with a `workday/` clone of this repo and run `python3 build.py`. Or apply the same changes to `index.html` directly.
4. Commit and push. GitHub Pages updates in about a minute. In the app: gear, Update app now.
5. Test with a phone-size browser before pushing (Playwright, iPhone 13).

## Google Sheets (Shmuel's account)
- Workday `1-6dJlD1UaD16rgJfdY1cVjH_hgaYjNdQkrrJeA30WHo`: Cards (... Crew Size, Title), Keys, Notes, Contractors, Foremen, Job Sites, Crew (Name, Phone, Language, Notes, Truck), Lists (Vehicles, Work Types, Tools), Settings (reminders rows 2-8; B11 = Next key serial), Suggestions, Read Me.
- Equipment Manager `1fV83ak0tgWdPJy-iTrHzxkg6_fzpcF8k6ThH62aiXJ4`
- Dumpster Log `15YCb4w9HbNq1Mw9E2ZmX9FP8pTVsHVqkh3yMUNUJ1v4`
- Supply Tracker `1X-1lPEIHSr5uEjTAq7UA4MfzE1LwC_Z4erVa3dELcuo`

## Rules Shmuel set
- Always confirm names (crew, contractor, foreman, address) and get his OK before editing a sheet.
- Key serial numbers never change and are never reused. Retire, never delete. Next number = max(Settings B11, highest serial + 1).
- Nothing from WhatsApp or email becomes a job without asking "Should I set this up?"
- Crew names match the Five Star card maker: Adan, Albert, Alex, Anjio, Charlie, Hugo, Jeronimo, Jonathon, Marco, Mario, Riccardo, Ruben, Sergio, Winston. Anjio's usual truck: 2016 Ford Transit.
- He uses an iPhone (and an iPad). Give exact step-by-step instructions, as few manual steps as possible.
- Never paste keys or tokens into a chat.

## Waiting / not done yet
- WhatsApp Business connection (needs a second screen for Meta's QR code; coexistence).
- Outlook email reading (waiting on work approval).
- People API turned on in the Apps Script (for Google Contacts search), if not done yet.
- Orders page (needs what one order line has).
- Phomemo M110 tool and key stickers (paused).
- Text messages (iMessage) for the AI: only possible with a Mac.
