import bcrypt from "bcrypt";
import { db } from "../lib/db.js";

const SUPER_ADMIN_EMAIL = process.env.DB_SEED_EMAIL;
const SUPER_ADMIN_PASSWORD = process.env.DB_SEED_PASSWORD;
const SUPER_ADMIN_FIRST_NAME = process.env.DB_SEED_FIRST_NAME || "Super";
const SUPER_ADMIN_LAST_NAME = process.env.DB_SEED_LAST_NAME || "Admin";

if (!SUPER_ADMIN_EMAIL || !SUPER_ADMIN_PASSWORD) {
  console.error("Seed failed: DB_SEED_EMAIL and DB_SEED_PASSWORD environment variables are required.");
  process.exit(1);
}

async function seed() {
  const email = SUPER_ADMIN_EMAIL!;
  const password = SUPER_ADMIN_PASSWORD!;
  const existing = await db("users").where({ email }).whereNull("deleted_at").first();

  if (existing) {
    console.log(`Superadmin already exists (${email}) — skipping.`);
    await db.destroy();
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await db("users").insert({
    first_name: SUPER_ADMIN_FIRST_NAME,
    last_name: SUPER_ADMIN_LAST_NAME,
    email,
    password_hash: passwordHash,
    role: "SUPER_ADMIN",
    status: true,
  });

  console.log(`Superadmin created: ${email}`);
  await db.destroy();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
