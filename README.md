# 🥟 Momo Rewards — "Buy 5 plates, get 1 FREE"

A complete digital stamp-card system for a momo shop. No paper cards, no app download.

| Who | Opens | What they can do |
|---|---|---|
| **Customer** | `https://your-site/` (scan the counter poster) | Join in 10 s with name + mobile, see a live stamp card with QR code, get a celebration when a stamp or free plate arrives, add the card to the home screen, English / हिंदी |
| **Staff** | `https://your-site/admin` | Find a customer by scanning their QR (phone camera) or typing their number → tap **Add 2 plates** → tap **Give free plate** when due. Register new customers. Undo own mistakes. |
| **Owner** | `https://your-site/admin` | Everything staff can do **plus** dashboard, full activity log, change the offer (5 → 6 plates etc.), staff logins, block / delete customers, manual corrections, CSV exports, backup & restore, printable counter poster |

Works for any number of customers (tested with concurrent stamping; SQLite comfortably handles tens of thousands of customers on a small server, PostgreSQL scales further).

---

## How a day at the counter works

1. **First visit** – customer scans the poster QR → enters name + number → card opens on their phone.
   (Or staff tap **+ New customer** and type the number.)
2. **Every order** – customer shows their card → staff tap **📷 Scan** → card opens → tap **Add 3 plates**.
   The customer's phone updates within seconds (+ vibration and confetti 🎉).
3. **5th plate** – card turns gold: *"Your FREE plate is ready!"* Staff tap **Give free plate**.
4. Extra plates carry over: 4 stamps + 3 plates = 1 free plate + 2 stamps.

## Built-in protection against cheating

| Risk | Protection |
|---|---|
| Customer adds stamps themselves | Impossible — only logged-in staff can add stamps. The customer page is read-only. |
| Someone gives another person's phone number to grab their free plate | Phone lookup on the public page shows progress only, never the card/QR. Free plates given **without scanning** the card are flagged ("Not scanned") in the log and dashboard. Owner can switch on **Require card scan** so only a scanned card can be redeemed. |
| Screenshot of someone else's card | The reward banner has a live ticking clock and the card refreshes itself; the QR is checked against the server. |
| Staff typing 50 instead of 5, or double-tapping | Max plates per entry (default 10) and a "stamped 1 min ago — add again?" warning. |
| Staff being "generous" | Every entry records who did it. Dashboard shows per-staff plates, free plates, unscanned free plates and undos. Staff can only undo their own entry within 15 min. |
| Password guessing | Login rate-limiting per user and per network, scrypt-hashed PINs/passwords, httpOnly session cookies, CSRF + strict security headers. |

## Customer data & privacy

The join form asks for explicit consent and only stores name + mobile number. The owner can delete a customer and their whole history (Customers → open → Owner tools → Delete) when asked, and export everything as CSV. Download a backup regularly (Settings → Your data).

---

## Put it online (pick one)

The camera scanner needs **HTTPS** — all options below give you HTTPS automatically.

### Option A — Always-on: Render paid + disk (≈ US $7–8 / month)

1. Upload this folder to a GitHub repository.
2. Render → **New → Web Service** → your repo → *Instance type: Starter*.
   - Build: `npm ci --omit=dev` · Start: `node server/index.js`
   - Add a **Disk** (Advanced): mount path `/var/data`, 1 GB (Render snapshots it daily).
   - Environment: `DATA_DIR` = `/var/data`, `SETUP_CODE` = any secret word, `NODE_VERSION` = `22`
3. When it shows **Live**, open `https://<your-app>.onrender.com/admin` and finish setup with your SETUP_CODE.
4. Settings → **Print counter poster**. Stick it at the counter. Done.

Optional: buy a domain (e.g. `tashimomos.in`) and add it under Render → *Settings → Custom Domains*.

### Option B — ₹0: Render free web service + Neon free PostgreSQL (what `render.yaml` sets up)

Free Render services lose local files on restart, so the data lives in a free Neon database:

1. Create a free project at **neon.tech** (region: Singapore) → **Connect** → copy the connection string (`postgresql://…`).
2. Render → **New → Blueprint** → paste this repo's URL → Render reads `render.yaml` and asks for **DATABASE_URL**: paste the Neon string → **Deploy**.
3. Render generates a `SETUP_CODE` (service → *Environment*). Open `https://<your-app>.onrender.com/admin` and finish setup with it.

Trade-off: a free Render service sleeps after 15 minutes without visitors and takes up to a minute to wake. Open the admin page when you open the shop; or point a free uptime monitor (e.g. UptimeRobot) at `https://<your-app>.onrender.com/healthz` every 10 minutes.

### Option C — Any VPS / your own server (Docker)

```bash
docker build -t momo-rewards .
docker run -d --name momo -p 3000:3000 -v momo-data:/data -e SETUP_CODE=secret momo-rewards
```
Put it behind HTTPS (Caddy, nginx + Let's Encrypt, or Cloudflare Tunnel).

### Run on your own computer (to try it)

Needs Node.js 22 or newer (nodejs.org).
```bash
npm install
npm start            # → http://localhost:3000  and  http://localhost:3000/admin
npm run seed:demo    # optional: fill an EMPTY test database with 48 demo customers
```

---

## Configuration

All optional — see `.env.example`.

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Use PostgreSQL instead of SQLite (Neon, Supabase, Render Postgres…) |
| `DATA_DIR` | Folder for the SQLite file (`momo.db`). Must be on a persistent disk. |
| `SETUP_CODE` | Required on the one-time setup screen, so nobody else can claim your fresh install |
| `PUBLIC_URL` | Your public address, if card links should use a specific domain |
| `PORT` | Port to listen on (default 3000) |

Everything else (offer, reward text, limits, staff) is changed in **/admin → Settings**.

## For developers

```
server/
  index.js          start-up & graceful shutdown
  app.js            Express app, security headers, static files, error handling
  db.js             SQLite (better-sqlite3) / PostgreSQL (pg) adapter + migrations
  loyalty.js        the rules: add plates, roll-over, redeem, undo, adjust (all transactional, row-locked)
  auth.js           scrypt hashing, DB-backed sessions, role guards
  security.js       CSP & headers, same-origin JSON guard, rate limiter
  settings.js       owner-editable settings with validation
  routes/public.js  customer API (join, card, lookup, QR)
  routes/admin.js   staff/owner API (counter, lists, stats, settings, staff, exports, backup)
public/
  index.html + assets/app.js     customer PWA (offline-capable, installable, EN/HI)
  admin/                         counter app (camera QR scan via BarcodeDetector or jsQR)
  poster.html                    printable A4 counter poster
test/api.test.js                 19 end-to-end tests (auth, roll-over, cool-down, redeem verification,
                                 undo rules, concurrency, CSV injection, backup/restore, CSRF, rate limits)
```

The included `.npmrc` turns off npm install scripts: the SQLite driver ships ready-made binaries for Windows, macOS and Linux, so nothing needs compiling.

```bash
npm test          # tests on SQLite
npm run test:pg   # same tests on a throw-away PostgreSQL (needs dev dependencies)
```

Every balance change is a single DB transaction that locks the customer row and writes an audit row with before/after values — the history always explains the balance, and undo restores it exactly.

### Ideas for later
- SMS/WhatsApp OTP when redeeming (needs a paid provider such as MSG91 or the WhatsApp Business API)
- Birthday bonus, double-stamp days, reward expiry
- Apple / Google Wallet passes
- Multiple outlets sharing one card
