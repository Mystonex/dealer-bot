# Dealer Bot 🛡️🤖
Discord helper for planning guild activities with **one-tap joins**, **live countdowns**, and **smart reminders**.

> _“Less scheduling, more playing.”_

---

## ✨ What Dealer does

- 🗓️ **Event Hub (sticky post)**
  - Weekly schedule (**Guild Hunt** / **Guild Dance**) with **live `<t:…:R>` countdowns**
  - Daily / Weekly / **Stimen Vaults** reset timers (render in each viewer’s local time)

- 🙋 **One-tap participation**
  - **Join / Leave** buttons with a live participant list

- 🧵 **Planning threads**
  - “Open Thread” button to create a focused chat with all attendees

- 🔔 **Auto reminders** (24h · 6h · 1h · 15m)
  - Sends **only the most relevant** due ping
  - Last ping shows a **live countdown** (dynamic `<t:…:R>`)

- 📣 **Auto announcements**
  - When **Guild Hunt** / **Guild Dance** open, Dealer posts an `@everyone` notice
  - Announcement **auto-deletes** when the window ends

- 🧹 **Self-cleaning**
  - Old event cards & planning threads are removed **2h after** the event time

- ♻️ **Auto-refresh**
  - Hub auto-refreshes around event starts and reset times (plus hourly safety)

---

## 🚀 Quick start (local)

    git clone https://github.com/Mystonex/dealer-bot.git
    cd dealer-bot
    npm install
    cp .env.example .env   # or create .env from the example and fill values
    npm run dev            # tsx watch

**Node**: v20+ recommended  
**DB**: SQLite under `./data/` (ignored by git)

---

## ⚙️ Configuration

Create `.env` from `.env.example` and fill your values:

    # Discord
    DISCORD_TOKEN=xxx
    DISCORD_CLIENT_ID=xxx
    GUILD_ID=123456789012345678
    EVENT_CHANNEL_ID=123456789012345678

    # Timezone used for scheduling math (viewers still see their own local time)
    TZ_DEFAULT=Europe/Zurich

    # Event Hub behavior
    EVENT_HUB_PIN=true
    EVENT_HUB_ALWAYS_LAST=true
    EVENT_HUB_BUMP_COOLDOWN_MS=60000

    # Reminder minutes before event start (order matters)
    USERPING_1=1440   # 24h
    USERPING_2=360    # 6h
    USERPING_3=60     # 1h
    USERPING_4=15     # 15m
    USERPING_TICK_SEC=30

**Permissions to invite the bot** (minimum):
- Send Messages, Embed Links, Use External Emojis  
- Manage Messages (cleanup), Manage Threads (planning threads)  
- Mention `@everyone` (for open announcements; optional if you switch to a role)

---

## 🧭 How it works (high level)

- **Event Hub** is (re)built on startup, after boundaries (event starts & resets), and hourly.  
- Weekly events:  
  - **Guild Hunt**: Fri · Sat · Sun (start 17:00; ends 07:00 next day)  
  - **Guild Dance**: Fri → Sat (start 18:30; ends 06:30)  
- **Resets**: Daily 08:00, Weekly Mon 08:00, **Stimen Vaults** next date/time from config.  
- **Announcements**: post at start, delete at end.  
- **Cleanup**: event cards + threads deleted 2h after event time.

---

## 🧩 Scripts

    npm run dev     # watch mode (tsx)
    npm run build   # compile to dist/
    npm run start   # run compiled build

---

## 🗺️ Roadmap / Ideas

- Role-based announcements instead of `@everyone`  
- Per-event reminder templates / localization  
- Admin slash commands to tune timers live

Have ideas? Open an issue or post in the server — **Dealer is home-built**, and your feedback drives it. 🚀

---

## 📄 License

MIT
