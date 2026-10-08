// Fills an EMPTY database with demo people and tickets, so the app has something
// to show on first run. Tickets go through the real ticket service, so they get
// the live model's predictions; whatever the model is unsure about is then
// triaged by the demo manager with each ticket's correct labels, as a person would.
//
//   npm run seed:demo          empty database only
//   npm run seed:demo:reset    wipe an existing DEMO database and fill it again
//
// Never touches a database with real users: demo data must not mix with real data.
import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../src/config/db.js";
import { User } from "../src/models/User.js";
import { Ticket } from "../src/models/Ticket.js";
import { hashPassword } from "../src/services/authService.js";
import * as ml from "../src/services/mlService.js";
import * as tickets from "../src/services/ticketService.js";

const PASSWORD = "demo-pass-1";
const PEOPLE = [
  { key: "maya", name: "Maya Qureshi", role: "manager" },
  {
    key: "bilal",
    name: "Bilal Ahmed",
    role: "agent",
    categories: ["billing", "refund"],
  },
  {
    key: "tariq",
    name: "Tariq Mehmood",
    role: "agent",
    categories: ["technical"],
  },
  {
    key: "nadia",
    name: "Nadia Khan",
    role: "agent",
    categories: ["account", "general"],
  },
  { key: "sara", name: "Sara Malik", role: "customer" },
  { key: "omar", name: "Omar Farooq", role: "customer" },
  { key: "ayesha", name: "Ayesha Siddiqui", role: "customer" },
];
// [customer, subject, body, correct category, correct priority]
const TICKETS = [
  [
    "sara",
    "Charged twice this month",
    "My card was charged twice for the Pro plan on the 3rd. Please refund the duplicate.",
    "billing",
    "high",
  ],
  [
    "omar",
    "App crashes when I export",
    "Every time I export a report to PDF the desktop app closes without any message.",
    "technical",
    "medium",
  ],
  [
    "ayesha",
    "Cannot reset my password",
    "The reset email never arrives. I have checked spam. I am locked out of my account.",
    "account",
    "high",
  ],
  [
    "sara",
    "Refund for cancelled order",
    "I cancelled order 55019 within the trial and still have not received the refund.",
    "refund",
    "medium",
  ],
  [
    "omar",
    "URGENT: checkout is down",
    "Production is down. None of our customers can pay and we are losing sales every minute.",
    "technical",
    "urgent",
  ],
  [
    "ayesha",
    "Do you offer student pricing?",
    "Just a quick question, no rush. Is there a discount for university students?",
    "general",
    "low",
  ],
  [
    "sara",
    "Invoice does not match my plan",
    "My invoice shows Rs 12,000 but the Business plan should be Rs 7,500 a month.",
    "billing",
    "medium",
  ],
  [
    "omar",
    "Search stopped working",
    "Since the last update the search returns nothing, even for exact names.",
    "technical",
    "medium",
  ],
  [
    "ayesha",
    "Change the email on my account",
    "I changed jobs. Please move my account to my new work email address.",
    "account",
    "low",
  ],
  [
    "sara",
    "Two-factor code not arriving",
    "The verification code for two-factor login is not reaching my phone.",
    "account",
    "high",
  ],
  [
    "omar",
    "Where is my refund",
    "You promised a refund for invoice 8841 two weeks ago. It is still not on my card.",
    "refund",
    "medium",
  ],
  [
    "ayesha",
    "Feedback on the new dashboard",
    "The new dashboard is much clearer. It would be great if it also worked on my iPad.",
    "general",
    "low",
  ],
  [
    "sara",
    "Payment failed but money deducted",
    "The payment failed on screen but Rs 4,999 left my bank account. This is blocking my work today.",
    "billing",
    "urgent",
  ],
  [
    "omar",
    "File uploads hang at 99%",
    "Uploads get stuck at 99% on Chrome. It is affecting several of our users.",
    "technical",
    "high",
  ],
  [
    "ayesha",
    "Delete my account",
    "Please close my account and remove all of my personal data.",
    "account",
    "medium",
  ],
  [
    "sara",
    "Card charged after cancelling",
    "I cancelled last month but was billed again. Please look at this as soon as possible.",
    "billing",
    "high",
  ],
];

async function main() {
  await connectDB();
  if (await User.estimatedDocumentCount()) {
    if (!process.argv.includes("--reset")) {
      throw new Error(
        "this database already has users. Run npm run seed:demo:reset to replace " +
          "the demo data, or point MONGO_URI at an empty database.",
      );
    }
    if (!(await User.exists({ email: "maya@demo.test" }))) {
      throw new Error(
        "--reset only clears a demo database, and this one has no demo manager. " +
          "It may hold real data, so it was left untouched.",
      );
    }
    await mongoose.connection.dropDatabase();
    console.log("Old demo data removed.");
  }

  const health = await ml.health();
  if (!health.modelLoaded) {
    const why = health.reachable
      ? "no model is live on the ML service"
      : "the ML service is not running";
    console.log(
      `Note: ${why}, so every ticket is triaged by hand. ` +
        "Train a model first (README, step 1) to see the model route tickets itself.",
    );
  }

  const people = {};
  const passwordHash = await hashPassword(PASSWORD);
  for (const p of PEOPLE) {
    const u = await User.create({
      name: p.name,
      email: `${p.key}@demo.test`,
      role: p.role,
      categories: p.categories ?? [],
      passwordHash,
    });
    people[p.key] = { id: u._id.toString(), role: u.role, name: u.name };
  }

  const made = [];
  for (const [who, subject, body, category, priority] of TICKETS) {
    made.push({
      ticket: await tickets.create(people[who], { subject, body }),
      category,
      priority,
    });
  }

  // The manager triages whatever the model was unsure about, with the correct labels,
  // exactly as a person would. Where she disagrees with the model it counts as a correction.
  const agentFor = (t) =>
    Object.values(people).find((p) => p.id === t.assignedAgent?.toString());
  for (const { ticket, category, priority } of made.filter(
    (x) => x.ticket.needsTriage,
  )) {
    await tickets.triage(people.maya, ticket._id, { category, priority });
  }
  const assigned = await Ticket.find({ assignedAgent: { $ne: null } }).sort({
    createdAt: 1,
  });
  for (const [i, t] of assigned.entries()) {
    const agent = agentFor(t);
    if (i % 3 === 0)
      await tickets.updateStatus(agent, t._id, { status: "in_progress" });
    if (i % 5 === 0) {
      await tickets.addComment(agent, t._id, {
        body: "Checking this with the payments team.",
        internal: true,
      });
      await tickets.addComment(agent, t._id, {
        body: "Thanks for the details, we are looking into it now.",
      });
    }
    if (i % 6 === 0) {
      await tickets.updateStatus(agent, t._id, {
        status: "resolved",
        note: "Found the cause and fixed it; confirmed it works now.",
      });
    }
  }
  const overdue = await Ticket.findOne({ status: "in_progress" });
  if (overdue)
    await Ticket.updateOne(
      { _id: overdue._id },
      { slaDueAt: new Date(Date.now() - 45 * 60_000) },
    );

  const byModel = made.filter((x) => !x.ticket.needsTriage).length;
  console.log(
    `Created ${PEOPLE.length} people and ${made.length} tickets ` +
      `(${byModel} routed by the model, ${made.length - byModel} triaged by hand). Everyone's password: ${PASSWORD}`,
  );
  for (const p of PEOPLE)
    console.log(`  ${p.role.padEnd(8)} ${p.key}@demo.test`);
}

main()
  .catch((err) => {
    console.error(`Demo data not created: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(disconnectDB);
