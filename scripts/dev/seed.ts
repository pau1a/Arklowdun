import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const DAY = 86_400_000;

interface Options {
  households: number;
  rows: number;
  seed: number;
  reset: boolean;
  dbPath: string;
  profile: boolean;
}

function defaultDbPath(): string {
  const home = os.homedir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "com.paula.arklowdun-dev", "arklowdun.sqlite3");
  }
  if (process.platform === "win32") {
    const appdata = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appdata, "com.paula.arklowdun-dev", "arklowdun.sqlite3");
  }
  return path.join(home, ".local", "share", "com.paula.arklowdun-dev", "arklowdun.sqlite3");
}

function isDevSafe(p: string): boolean {
  const lower = p.toLowerCase();
  return lower.includes("arklowdun-dev") || lower.endsWith("dev.sqlite3");
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const opts: Options = { households: 3, rows: 1000, seed: 1, reset: false, dbPath: defaultDbPath(), profile: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case "--households":
        opts.households = Number(args[++i]);
        break;
      case "--rows":
        opts.rows = Number(args[++i]);
        break;
      case "--seed":
        opts.seed = Number(args[++i]);
        break;
      case "--reset":
        opts.reset = true;
        break;
      case "--db":
        opts.dbPath = args[++i];
        break;
      case "--profile":
        opts.profile = true;
        break;
      case "--help":
        console.log("Usage: seed.ts [options]\n" +
          "--households N  number of households (default 3)\n" +
          "--rows M        per-household base volume (default 1000)\n" +
          "--seed N        PRNG seed (default 1)\n" +
          "--reset         reset database file\n" +
          "--db path       sqlite path override\n" +
          "--profile       run profile harness after seeding");
        process.exit(0);
      default:
        console.error(`Unknown arg: ${a}`);
        process.exit(1);
    }
  }
  return opts;
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(rand: () => number, arr: T[]) => arr[Math.floor(rand() * arr.length)];
const chance = (rand: () => number, p: number) => rand() < p;
const randInt = (rand: () => number, min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const randDateAround = (rand: () => number, today: number, spread: number) => today + randInt(rand, -spread, spread) * DAY;
const uuidLike = (rand: () => number) => {
  let out = "";
  for (let i = 0; i < 26; i++) out += Math.floor(rand() * 16).toString(16);
  return out;
};
const remindMaybe = (rand: () => number, due: number) =>
  chance(rand, 0.5) ? due - randInt(rand, 2, 14) * DAY : null;
const attachment = (rand: () => number) => {
  if (!chance(rand, 0.3)) return { root: null as string | null, rel: null as string | null };
  const r = rand();
  const root = r < 0.6 ? "appData" : r < 0.9 ? "home" : "temp";
  const year = randInt(rand, 2023, 2025);
  const month = String(randInt(rand, 1, 12)).padStart(2, "0");
  const rel = `receipts/${year}/${month}/invoice_${uuidLike(rand)}.pdf`;
  return { root, rel };
};

async function main() {
  const opts = parseArgs();

  if (process.env.VITE_ENV !== "development") {
    console.error("Refusing to run: VITE_ENV must be 'development'");
    process.exit(1);
  }
  if (!path.isAbsolute(opts.dbPath)) {
    console.error("--db path must be absolute");
    process.exit(1);
  }
  if (!isDevSafe(opts.dbPath)) {
    console.error(`Refusing to touch non-dev path: ${opts.dbPath}`);
    process.exit(1);
  }

  if (opts.reset) {
    fs.rmSync(opts.dbPath, { force: true });
    fs.mkdirSync(path.dirname(opts.dbPath), { recursive: true });
  }

  const db = new Database(opts.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");

  const check = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='household'").get();
  if (!check) {
    console.error("Missing 'household' table. Run the app once to apply migrations.");
    process.exit(1);
  }

  const rand = mulberry32(opts.seed);
  const counts: Record<string, number> = {};
  const now = Date.now();

  const insertHousehold = db.prepare("INSERT INTO household (id,name,created_at,updated_at,tz) VALUES (?,?,?,?,?)");
  const insertEvent = db.prepare("INSERT INTO events (id,title,start_at,end_at,tz,start_at_utc,end_at_utc,household_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
  const insertBill = db.prepare("INSERT INTO bills (id,amount,due_date,reminder,household_id,created_at,updated_at,root_key,relative_path) VALUES (?,?,?,?,?,?,?,?,?)");
  const insertPolicy = db.prepare("INSERT INTO policies (id,amount,due_date,reminder,household_id,created_at,updated_at,root_key,relative_path) VALUES (?,?,?,?,?,?,?,?,?)");
  const insertInventory = db.prepare("INSERT INTO inventory_items (id,name,purchase_date,warranty_expiry,reminder,household_id,created_at,updated_at,position,root_key,relative_path) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  const insertPropDoc = db.prepare("INSERT INTO property_documents (id,description,renewal_date,reminder,household_id,created_at,updated_at,root_key,relative_path) VALUES (?,?,?,?,?,?,?,?,?)");
  const insertPet = db.prepare("INSERT INTO pets (id,name,type,household_id,created_at,updated_at) VALUES (?,?,?,?,?,?)");
  const insertPetMed = db.prepare("INSERT INTO pet_medical (id,pet_id,date,description,reminder,household_id,created_at,updated_at,root_key,relative_path) VALUES (?,?,?,?,?,?,?,?,?,?)");
  const insertVehicle = db.prepare("INSERT INTO vehicles (id,name,make,model,next_mot_due,next_service_due,household_id,created_at,updated_at,position) VALUES (?,?,?,?,?,?,?,?,?,?)");
  const insertNote = db.prepare("INSERT INTO notes (id,household_id,title,body,z_index,created_at,updated_at) VALUES (?,?,?,?,?,?,?)");
  const insertShop = db.prepare("INSERT INTO shopping_items (id,household_id,title,is_done,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?)");
  const insertCategory = db.prepare("INSERT INTO budget_categories (id,name,household_id,created_at,updated_at) VALUES (?,?,?,?,?)");
  const insertExpense = db.prepare("INSERT INTO expenses (id,category_id,amount,date,household_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)");

  const run = db.transaction(() => {
    for (let i = 0; i < opts.households; i++) {
      const hhId = uuidLike(rand);
      const name = `Household ${String.fromCharCode(65 + i)}`;
      const tz = ["Europe/London", "America/New_York", "Asia/Tokyo"][i % 3];
      const created = now - randInt(rand, 0, 540) * DAY;
      const updated = created + randInt(rand, 0, 30) * DAY;
      insertHousehold.run(hhId, name, created, updated, tz);
      counts.household = (counts.household || 0) + 1;

      const categories: string[] = [];
      for (let c = 0; c < 8; c++) {
        const id = uuidLike(rand);
        categories.push(id);
        const cAt = now - randInt(rand, 0, 540) * DAY;
        const uAt = cAt + randInt(rand, 0, 30) * DAY;
        insertCategory.run(id, `Category ${c + 1}`, hhId, cAt, uAt);
        counts.budget_categories = (counts.budget_categories || 0) + 1;
      }

      const pets: string[] = [];
      const petCount = Math.max(1, Math.floor(opts.rows * 0.02));
      for (let p = 0; p < petCount; p++) {
        const id = uuidLike(rand);
        pets.push(id);
        const cAt = now - randInt(rand, 0, 540) * DAY;
        const uAt = cAt + randInt(rand, 0, 30) * DAY;
        insertPet.run(id, `Pet ${p + 1}`, pick(rand, ["dog", "cat", "bird"]), hhId, cAt, uAt);
        counts.pets = (counts.pets || 0) + 1;
      }

      const eventCount = opts.rows;
      for (let e = 0; e < eventCount; e++) {
        const id = uuidLike(rand);
        const start = randDateAround(rand, now, 180);
        const end = start + randInt(rand, 1, 48) * 3_600_000;
        const cAt = now - randInt(rand, 0, 540) * DAY;
        const uAt = cAt + randInt(rand, 0, 30) * DAY;
        insertEvent.run(id, `Event ${e + 1}`, start, end, tz, start, end, hhId, cAt, uAt);
      }
      counts.events = (counts.events || 0) + eventCount;

      for (let b = 0; b < opts.rows; b++) {
        const id = uuidLike(rand);
        const due = randDateAround(rand, now, 180);
        const cAt = now - randInt(rand, 0, 540) * DAY;
        const uAt = cAt + randInt(rand, 0, 30) * DAY;
        const { root, rel } = attachment(rand);
        insertBill.run(id, randInt(rand, 1000, 50000), due, remindMaybe(rand, due), hhId, cAt, uAt, root, rel);
      }
      counts.bills = (counts.bills || 0) + opts.rows;

      const polCount = Math.floor(opts.rows * 0.3);
      for (let j = 0; j < polCount; j++) {
        const id = uuidLike(rand);
        const due = randDateAround(rand, now, 180);
        const cAt = now - randInt(rand, 0, 540) * DAY;
        const uAt = cAt + randInt(rand, 0, 30) * DAY;
        const { root, rel } = attachment(rand);
        insertPolicy.run(id, randInt(rand, 1000, 50000), due, remindMaybe(rand, due), hhId, cAt, uAt, root, rel);
      }
      counts.policies = (counts.policies || 0) + polCount;

      const invCount = Math.floor(opts.rows * 0.5);
      for (let j = 0; j < invCount; j++) {
        const id = uuidLike(rand);
        const purchase = randDateAround(rand, now, 180);
        const warranty = chance(rand, 0.5) ? purchase + randInt(rand, 30, 365) * DAY : null;
        const reminder = warranty ? remindMaybe(rand, warranty) : null;
        const cAt = now - randInt(rand, 0, 540) * DAY;
        const uAt = cAt + randInt(rand, 0, 30) * DAY;
        const { root, rel } = attachment(rand);
        insertInventory.run(id, `Item ${j + 1}`, purchase, warranty, reminder, hhId, cAt, uAt, j, root, rel);
      }
      counts.inventory_items = (counts.inventory_items || 0) + invCount;

      const pdCount = Math.floor(opts.rows * 0.2);
      for (let j = 0; j < pdCount; j++) {
        const id = uuidLike(rand);
        const renewal = randDateAround(rand, now, 180);
        const cAt = now - randInt(rand, 0, 540) * DAY;
        const uAt = cAt + randInt(rand, 0, 30) * DAY;
        const { root, rel } = attachment(rand);
        insertPropDoc.run(id, `Doc ${j + 1}`, renewal, remindMaybe(rand, renewal), hhId, cAt, uAt, root, rel);
      }
      counts.property_documents = (counts.property_documents || 0) + pdCount;

      const medCount = Math.floor(opts.rows * 0.1);
      for (let j = 0; j < medCount; j++) {
        const id = uuidLike(rand);
        const pet = pick(rand, pets);
        const date = randDateAround(rand, now, 180);
        const cAt = now - randInt(rand, 0, 540) * DAY;
        const uAt = cAt + randInt(rand, 0, 30) * DAY;
        const { root, rel } = attachment(rand);
        insertPetMed.run(id, pet, date, "Checkup", remindMaybe(rand, date), hhId, cAt, uAt, root, rel);
      }
      counts.pet_medical = (counts.pet_medical || 0) + medCount;

      const vehCount = Math.floor(opts.rows * 0.05);
      for (let j = 0; j < vehCount; j++) {
        const id = uuidLike(rand);
        const make = `Make ${j + 1}`;
        const model = `Model ${j + 1}`;
        const nextMot = chance(rand, 0.5) ? randDateAround(rand, now, 180) : null;
        const nextService = chance(rand, 0.5) ? randDateAround(rand, now, 180) : null;
        const cAt = now - randInt(rand, 0, 540) * DAY;
        const uAt = cAt + randInt(rand, 0, 30) * DAY;
        insertVehicle.run(id, `${make} ${model}`, make, model, nextMot, nextService, hhId, cAt, uAt, j);
      }
      counts.vehicles = (counts.vehicles || 0) + vehCount;

      const noteCount = Math.floor(opts.rows * 0.1);
      for (let j = 0; j < noteCount; j++) {
        const id = uuidLike(rand);
        const cAt = now - randInt(rand, 0, 540) * DAY;
        const uAt = cAt + randInt(rand, 0, 30) * DAY;
        insertNote.run(id, hhId, `Note ${j + 1}`, `Body ${j + 1}`, j, cAt, uAt);
      }
      counts.notes = (counts.notes || 0) + noteCount;

      const shopCount = Math.floor(opts.rows * 0.1);
      for (let j = 0; j < shopCount; j++) {
        const id = uuidLike(rand);
        const cAt = now - randInt(rand, 0, 540) * DAY;
        const uAt = cAt + randInt(rand, 0, 30) * DAY;
        insertShop.run(id, hhId, `Item ${j + 1}`, chance(rand, 0.3) ? 1 : 0, j, cAt, uAt);
      }
      counts.shopping_items = (counts.shopping_items || 0) + shopCount;

      const expCount = Math.floor(opts.rows * 0.4);
      for (let j = 0; j < expCount; j++) {
        const id = uuidLike(rand);
        const cat = pick(rand, categories);
        const date = randDateAround(rand, now, 180);
        const cAt = now - randInt(rand, 0, 540) * DAY;
        const uAt = cAt + randInt(rand, 0, 30) * DAY;
        insertExpense.run(id, cat, randInt(rand, 100, 10000), date, hhId, cAt, uAt);
      }
      counts.expenses = (counts.expenses || 0) + expCount;
    }
  });

  run();
  db.close();

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const summary = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(", ");
  console.log(`${summary}, total:${total}`);

  if (opts.profile) {
    const mod = await import("./profile.ts");
    await mod.runProfile(opts.dbPath);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

