'use strict';
/**
 * Fills an EMPTY database with realistic demo customers + 30 days of history,
 * so you can explore the dashboard. Never run this on your real shop data.
 *   npm run seed:demo
 */
const { openDb } = require('../server/db');
const { randomCode, randomToken } = require('../server/util');

const FIRST = ['Aarav', 'Vivaan', 'Aditya', 'Ishaan', 'Rohan', 'Kabir', 'Arjun', 'Sai', 'Rahul', 'Karan', 'Ananya', 'Diya', 'Isha', 'Kavya',
  'Priya', 'Sneha', 'Riya', 'Neha', 'Pooja', 'Tanvi', 'Aman', 'Nikhil', 'Varun', 'Simran', 'Meera', 'Tenzin', 'Pema', 'Sonam', 'Dorjee', 'Yash'];
const LAST = ['Sharma', 'Verma', 'Gupta', 'Singh', 'Kumar', 'Mehta', 'Joshi', 'Rana', 'Thapa', 'Bhutia', 'Lepcha', 'Kapoor', 'Yadav', 'Mishra', 'Arora'];

(async () => {
  const db = await openDb();
  const n = (await db.get('SELECT COUNT(*) AS n FROM customers')).n;
  if (n > 0 && !process.argv.includes('--force')) {
    console.log(`Database already has ${n} customers — not seeding. (Use --force on a throw-away database only.)`);
    process.exit(0);
  }
  const staff = await db.all('SELECT id, name FROM staff WHERE active = 1');
  if (!staff.length) { console.log('Complete the first-run setup at /admin first.'); process.exit(1); }
  const required = Number((await db.get("SELECT value FROM settings WHERE key = 'stamps_required'"))?.value || 5);
  const DAY = 86400000;
  const nowTs = Date.now();
  let rnd = 42;
  const rand = () => { rnd = (rnd * 16807) % 2147483647; return (rnd - 1) / 2147483646; };
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const hourWeights = [11, 12, 13, 13, 14, 16, 17, 18, 18, 19, 19, 19, 20, 20, 21];

  await db.tx(async (t) => {
    for (let i = 0; i < 48; i++) {
      const name = `${pick(FIRST)} ${pick(LAST)}`;
      const phone = String(9000000000 + Math.floor(rand() * 999999999));
      const loyal = rand();
      const visits = loyal > 0.8 ? 8 + Math.floor(rand() * 10) : loyal > 0.4 ? 2 + Math.floor(rand() * 5) : 1;
      const firstDay = Math.floor(rand() * 30);
      const times = [];
      for (let v = 0; v < visits; v++) {
        const daysAgo = Math.max(0, firstDay - Math.floor(rand() * (firstDay + 1)));
        const d = new Date(nowTs - daysAgo * DAY);
        d.setHours(pick(hourWeights), Math.floor(rand() * 60), 0, 0);
        if (d.getTime() < nowTs) times.push(d.getTime());
      }
      times.sort((a, b) => a - b);
      if (!times.length) continue;
      const created = times[0] - 60000;
      const c = await t.get(
        "INSERT INTO customers(code, card_token, phone, name, source, created_at) VALUES(?,?,?,?,?,?) RETURNING id",
        [randomCode(6), randomToken(18), phone, name, rand() > 0.5 ? 'self' : 'counter', created]
      ).catch(() => null);
      if (!c) continue;
      let stamps = 0; let rewards = 0; let plates = 0; let earnedT = 0; let redeemedT = 0;
      for (const ts of times) {
        const st = pick(staff);
        if (rewards > 0 && rand() > 0.35) {
          await t.run(
            `INSERT INTO transactions(customer_id, staff_id, staff_name, type, rewards_redeemed, stamps_before, stamps_after,
              rewards_before, rewards_after, verified, created_at) VALUES(?,?,?,'redeem',1,?,?,?,?,?,?)`,
            [c.id, st.id, st.name, stamps, stamps, rewards, rewards - 1, rand() > 0.2 ? 1 : 0, ts - 30000]
          );
          rewards--; redeemedT++;
        }
        const p = rand() > 0.7 ? 2 + Math.floor(rand() * 3) : 1;
        const total = stamps + p; const earned = Math.floor(total / required);
        await t.run(
          `INSERT INTO transactions(customer_id, staff_id, staff_name, type, plates, rewards_earned, stamps_before, stamps_after,
            rewards_before, rewards_after, created_at) VALUES(?,?,?,'stamp',?,?,?,?,?,?,?)`,
          [c.id, st.id, st.name, p, earned, stamps, total % required, rewards, rewards + earned, ts]
        );
        stamps = total % required; rewards += earned; plates += p; earnedT += earned;
      }
      await t.run(
        `UPDATE customers SET stamps=?, rewards_available=?, total_plates=?, total_rewards_earned=?, total_rewards_redeemed=?,
          visits=?, last_visit_at=? WHERE id=?`,
        [stamps, rewards, plates, earnedT, redeemedT, times.length, times[times.length - 1], c.id]
      );
    }
  });
  console.log('Demo data added. Open /admin → Dashboard.');
  await db.close();
})();
