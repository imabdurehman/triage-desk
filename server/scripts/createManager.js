// Creates the first manager account (or promotes an existing user to manager).
// Public registration only ever creates customers, so without this script
// nobody could create agents or managers.
//
//   node scripts/createManager.js --name "Ali Khan" --email ali@example.com --password "S3cure-pass"
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { User } from "../src/models/User.js";
import { hashPassword } from "../src/services/authService.js";

export async function createManager({ name, email, password }) {
  const normalised = String(email).trim().toLowerCase();
  if (!normalised || !password || password.length < 8) {
    throw new Error(
      "email and a password of at least 8 characters are required",
    );
  }
  const existing = await User.findOne({ email: normalised });
  if (existing) {
    existing.role = "manager";
    existing.active = true;
    await existing.save();
    return { user: existing.toSafeJSON(), created: false };
  }
  const user = await User.create({
    name: name || normalised.split("@")[0],
    email: normalised,
    role: "manager",
    passwordHash: await hashPassword(password),
  });
  return { user: user.toSafeJSON(), created: true };
}

// CLI entry point. Skipped when this file is imported (e.g. by tests).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { connectDB, disconnectDB } = await import("../src/config/db.js");
  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      email: { type: "string" },
      password: { type: "string" },
    },
  });
  try {
    await connectDB();
    const { user, created } = await createManager(values);
    console.log(`${created ? "Created" : "Promoted"} manager: ${user.email}`);
  } catch (err) {
    console.error(`Could not create manager: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await disconnectDB();
  }
}
