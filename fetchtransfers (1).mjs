/**
 * Daily FotMob transfer scraper for the EFL Transfer Tracker.
 *
 * Strategy:
 *  1. For each of the four divisions, fetch the league's transfers tab
 *     (one request per league — 4 total) which lists every deal involving
 *     a club in that league.
 *  2. Normalise into the site's schema and write data/transfers.json.
 *
 * Uses @max-xoo/fotmob for its x-mas auth handling, but reads raw JSON via
 * the authenticated axios instance and parses defensively, so FotMob schema
 * changes degrade to a loud failure rather than silent bad data.
 *
 * NOTE: unofficial API. Keep it to one gentle pass per day.
 */
import Fotmob from "@max-xoo/fotmob";
import { writeFileSync, mkdirSync } from "node:fs";

const LEAGUES = [
  { id: 47, key: "PL", name: "Premier League" },
  { id: 48, key: "CH", name: "Championship" },
  { id: 108, key: "L1", name: "League One" },
  { id: 109, key: "L2", name: "League Two" },
];

const GBP_PER_EUR = 0.85; // FotMob fees are EUR; rough conversion, adjust as desired
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const FotmobClass = Fotmob.default ?? Fotmob;
const fm = new FotmobClass();

let CHOSEN_PREFIX = null; // discovered on first successful request

async function rawGet(path) {
  await fm.ensureInitialized();
  const token = fm.xmas ? "yes" : "NO TOKEN";
  const prefixes = CHOSEN_PREFIX != null ? [CHOSEN_PREFIX] : ["", "data/"];
  let lastErr = null;
  for (const prefix of prefixes) {
    const url = prefix + path;
    try {
      const res = await fm.axiosInstance.get(url);
      const body = res.data;
      if (body?.error) throw new Error(`API error body: ${JSON.stringify(body).slice(0, 200)}`);
      if (typeof body === "string") throw new Error(`Got HTML/string instead of JSON (Cloudflare block?): ${body.slice(0, 120)}`);
      CHOSEN_PREFIX = prefix;
      console.log(`OK ${url} (x-mas token: ${token})`);
      return body;
    } catch (e) {
      const status = e.response?.status ?? "no-response";
      const snippet = typeof e.response?.data === "string" ? e.response.data.slice(0, 150) : JSON.stringify(e.response?.data ?? "").slice(0, 150);
      console.error(`  tried ${e.config?.baseURL ?? ""}${url} -> status ${status} (x-mas token: ${token}) body: ${snippet}`);
      lastErr = e;
    }
  }
  throw lastErr;
}

function normFee(fee, transferType) {
  // FotMob fee objects vary: { feeText, localizedFeeText, value } or absent.
  const typeText = (transferType?.text ?? transferType ?? "").toString().toLowerCase();
  let type = "perm";
  if (typeText.includes("loan")) type = "loan";
  if (typeText.includes("free")) type = "free";
  const feeText = (fee?.feeText ?? "").toLowerCase();
  if (feeText.includes("free")) type = "free";
  if (feeText.includes("loan")) type = type === "perm" ? "loan" : type;
  let m = null; // millions GBP
  if (typeof fee?.value === "number" && fee.value > 0) m = (fee.value / 1e6) * GBP_PER_EUR;
  return { type, fee: m == null ? null : Math.round(m * 10) / 10 };
}

function normOne(t, divisionKey, dir, clubName) {
  const { type, fee } = normFee(t.fee, t.transferType);
  return {
    division: divisionKey,
    club: clubName,
    dir, // "in" | "out"
    player: t.name ?? t.playerName ?? "Unknown",
    position: t.position?.strPosShort?.label ?? t.position ?? "",
    fromClub: t.fromClub ?? clubName,
    toClub: t.toClub ?? clubName,
    type,
    fee,
    transferDate: (t.transferDate ?? "").slice(0, 10),
    window: windowFor(t.transferDate),
    marketValue: typeof t.marketValue === "number" ? Math.round((t.marketValue / 1e6) * GBP_PER_EUR * 10) / 10 : null,
    playerId: t.playerId ?? null,
  };
}

function windowFor(dateStr) {
  if (!dateStr) return "Unknown";
  const d = new Date(dateStr);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  if (m >= 6 && m <= 9) return `Summer ${y}`;
  if (m <= 2) return `Winter ${y - 1}/${String(y).slice(2)}`;
  if (m === 12) return `Winter ${y}/${String(y + 1).slice(2)}`;
  return `Mid-season ${y}`;
}

async function leagueTransfers(league) {
  const data = await rawGet(`leagues?id=${league.id}&tab=transfers&type=league`);
  const t = data?.transfers ?? data?.tabs?.transfers ?? null;
  if (!t) throw new Error(`No transfers object for ${league.name} — FotMob schema may have changed. Top-level keys: ${Object.keys(data ?? {}).join(", ")}`);
  const rows = [];
  // FotMob groups by club: [{ teamId, teamName, transfersIn: [...], transfersOut: [...] }]
  // or flat { data: [...] } — handle both.
  const groups = Array.isArray(t) ? t : t.data ?? t.clubs ?? [];
  for (const g of groups) {
    const clubName = g.teamName ?? g.name ?? "Unknown club";
    for (const x of g.transfersIn ?? g["Players in"] ?? []) rows.push(normOne(x, league.key, "in", clubName));
    for (const x of g.transfersOut ?? g["Players out"] ?? []) rows.push(normOne(x, league.key, "out", clubName));
    // flat list fallback: entries carry their own club/direction
    if (!g.transfersIn && !g.transfersOut && (g.name || g.playerName) && (g.fromClub || g.toClub)) {
      rows.push(normOne(g, league.key, g.toClubId && groups.teamId === g.toClubId ? "in" : "in", g.toClub ?? "Unknown club"));
    }
  }
  return rows;
}

async function main() {
  const all = [];
  const errors = [];
  for (const league of LEAGUES) {
    try {
      const rows = await leagueTransfers(league);
      console.log(`${league.name}: ${rows.length} transfer records`);
      all.push(...rows);
    } catch (e) {
      console.error(`FAILED ${league.name}: ${e.message}`);
      errors.push(`${league.name}: ${e.message}`);
    }
    await sleep(3000); // be gentle
  }
  if (all.length === 0) {
    console.error("No data fetched at all — refusing to overwrite existing data.");
    process.exit(1);
  }
  mkdirSync("data", { recursive: true });
  writeFileSync(
    "data/transfers.json",
    JSON.stringify({ updated: new Date().toISOString(), source: "fotmob", errors, transfers: all }, null, 1)
  );
  console.log(`Wrote data/transfers.json — ${all.length} records, ${errors.length} league errors.`);
  // Non-zero exit if partially failed, so the Actions run shows amber/red and you notice.
  if (errors.length) process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });
