import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Ticket } from "../models/Ticket.js";
import { User } from "../models/User.js";
import { Assignment } from "../models/Assignment.js";
import { ApiError } from "../utils/ApiError.js";
import { ACTIVE_STATUSES, canTransition } from "../config/contract.js";
import * as ml from "./mlService.js";
import { computeSlaDue } from "./slaService.js";
import { pickAgent } from "./assignmentService.js";
import {
  greeting,
  managerEmails,
  notify,
  ticketLink,
  ticketRef,
} from "./mailService.js";
import { env } from "../config/env.js";

// ---------------------------------------------------------------- access
/** Query filter limiting what each role may see. */
function scopeFor(user) {
  if (user.role === "manager") return {};
  if (user.role === "customer") return { customer: user.id };
  // Agents: their own tickets, plus unassigned tickets waiting for triage.
  return {
    $or: [
      { assignedAgent: user.id },
      { needsTriage: true, assignedAgent: null },
    ],
  };
}

function canSee(user, t) {
  if (user.role === "manager") return true;
  if (user.role === "customer") return t.customer.toString() === user.id;
  const assigned = t.assignedAgent?.toString() === user.id;
  return assigned || (t.needsTriage && !t.assignedAgent);
}

/** Loads a ticket the user may see. 404, not 403, so ids of others' tickets don't leak. */
async function loadVisible(user, id) {
  const t = await Ticket.findById(id);
  if (!t || !canSee(user, t)) throw ApiError.notFound("Ticket");
  return t;
}

/** Customers never see internal notes or the model's working. */
export function present(ticket, user) {
  const t = ticket.toObject ? ticket.toObject() : ticket;
  if (user.role !== "customer") return t;
  return {
    ...t,
    comments: (t.comments ?? []).filter((c) => !c.internal),
    predictedCategory: undefined,
    predictedPriority: undefined,
    predictionConfidence: undefined,
    modelVersion: undefined,
    overriddenBy: undefined,
    history: undefined,
  };
}

async function autoAssign(ticket) {
  if (ticket.assignedAgent || !ticket.category) return null;
  const pick = await pickAgent(ticket.category, ticket.priority);
  if (!pick) return null;
  ticket.assignedAgent = pick.agent._id;
  if (ticket.status === "open") ticket.status = "assigned";
  ticket.history.push({
    action: "assigned",
    to: pick.agent._id.toString(),
    note: `auto: ${pick.reason}`,
  });
  return pick.agent;
}

// ---------------------------------------------------------------- emails
const excerpt = (text) =>
  text.length > 300 ? `${text.slice(0, 300)}...` : text;
const dueBy = (t) =>
  t.slaDueAt.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });

/** Tells an agent a ticket is now theirs. */
function tellAgent(t, agent) {
  notify(() => ({
    to: [agent.email],
    subject: `${ticketRef(t)} New ticket assigned to you: ${t.subject}`,
    paragraphs: [
      greeting(agent.name),
      `A ${t.priority} priority ${t.category} ticket has been assigned to you. Please respond by ${dueBy(t)}.`,
      `${t.subject}\n${excerpt(t.body)}`,
    ],
    link: ticketLink(t),
  }));
}

/** Tells the managers a ticket has arrived, and where it went. */
function tellManagersNew(t, agent, customerName) {
  const route = agent
    ? `It was assigned to ${agent.name} as ${t.category}, ${t.priority} priority.`
    : t.needsTriage
      ? "It is waiting for triage: the model was not sure enough, or was unavailable."
      : "There is no active agent to assign it to.";
  notify(async () => ({
    to: await managerEmails(),
    subject: `${ticketRef(t)} New ticket: ${t.subject}`,
    paragraphs: [
      `A new ticket has arrived from ${customerName}.`,
      route,
      `${t.subject}\n${excerpt(t.body)}`,
    ],
    link: ticketLink(t),
  }));
}

function tellCustomerResolved(t) {
  notify(async () => {
    const customer = await User.findById(t.customer)
      .select("name email")
      .lean();
    return {
      to: [customer.email],
      subject: `${ticketRef(t)} Your ticket has been resolved: ${t.subject}`,
      paragraphs: [
        greeting(customer.name),
        `Your ticket "${t.subject}" has been resolved.`,
        `How it was resolved:\n${t.resolution}`,
        `If this has not fixed the problem, reply on the ticket within ${env.autoCloseResolvedDays} days ` +
          "and it will be reopened.",
      ],
      link: ticketLink(t),
    };
  });
}

// ---------------------------------------------------------------- create
export async function create(user, { subject, body }) {
  const prediction = await ml.predict({ subject, body });
  const confident = ml.isConfident(prediction);
  const now = new Date();

  const ticket = new Ticket({
    subject,
    body,
    customer: user.id,
    // A low-confidence prediction is kept, but a human confirms it.
    category: prediction.ok ? prediction.category : null,
    priority: prediction.priority, // the fallback supplies 'medium' when ML is down
    predictedCategory: prediction.ok ? prediction.category : null,
    predictedPriority: prediction.ok ? prediction.priority : null,
    predictionConfidence: prediction.confidence,
    modelVersion: prediction.modelVersion,
    needsTriage: !confident,
    slaDueAt: computeSlaDue(prediction.priority, now),
    history: [
      {
        action: "created",
        by: user.id,
        note: prediction.ok
          ? `predicted ${prediction.category}/${prediction.priority}`
          : `ML unavailable: ${prediction.reason}`,
      },
    ],
  });

  const agent = confident ? await autoAssign(ticket) : null;
  await ticket.save();
  if (agent)
    await Assignment.create({
      ticket: ticket._id,
      agent: agent._id,
      method: "auto",
    });
  if (agent) tellAgent(ticket, agent);
  tellManagersNew(ticket, agent, user.name);
  return ticket;
}

// ---------------------------------------------------------------- read
export async function list(
  user,
  { status, active, category, priority, needsTriage, page, limit },
) {
  const filter = { ...scopeFor(user) };
  if (status) filter.status = status;
  else if (active) filter.status = { $in: ACTIVE_STATUSES };
  if (category) filter.category = category;
  if (priority) filter.priority = priority;
  if (needsTriage !== undefined) filter.needsTriage = needsTriage;

  // Customers want their newest first; staff want the most urgent first.
  const sort =
    user.role === "customer"
      ? { createdAt: -1 }
      : { slaDueAt: 1, createdAt: 1 };
  const [items, total] = await Promise.all([
    Ticket.find(filter)
      .select("-history -body -comments -attachments")
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("assignedAgent", "name")
      .populate("customer", "name")
      .lean(),
    Ticket.countDocuments(filter),
  ]);
  return { items, page, limit, total, pages: Math.ceil(total / limit) || 1 };
}

export async function get(user, id) {
  const t = await loadVisible(user, id);
  await t.populate([
    { path: "customer", select: "name email" },
    { path: "assignedAgent", select: "name email" },
    { path: "comments.author", select: "name role" },
    { path: "overriddenBy", select: "name" },
    { path: "history.by", select: "name" },
  ]);
  return present(t, user);
}

// ---------------------------------------------------------------- change
export async function updateStatus(user, id, { status, note }) {
  const t = await loadVisible(user, id);
  if (user.role === "agent" && t.assignedAgent?.toString() !== user.id) {
    throw ApiError.forbidden("Only the assigned agent can change this ticket");
  }
  if (!canTransition(t.status, status)) {
    throw new ApiError(
      409,
      "INVALID_TRANSITION",
      `Cannot move a ticket from ${t.status} to ${status}`,
    );
  }
  const from = t.status;
  const now = new Date();
  leaving(t, now);
  t.status = status;
  if (status === "waiting_customer") t.waitingSince = now;
  if (status === "resolved")
    Object.assign(t, { resolvedAt: now, resolution: note });
  if (status === "closed") t.closedAt = now;
  t.history.push({ action: "status", by: user.id, from, to: status, note });
  await t.save();
  if (status === "resolved") tellCustomerResolved(t);
  return present(t, user);
}

/**
 * Bookkeeping for a ticket leaving its current status. Leaving waiting_customer
 * moves the SLA deadline by the time spent waiting: the clock was paused.
 * Leaving resolved is a reopen: the resolution no longer holds, and the ticket
 * gets a fresh SLA window from now.
 */
function leaving(t, now) {
  if (t.status === "waiting_customer" && t.waitingSince) {
    t.slaDueAt = new Date(t.slaDueAt.getTime() + (now - t.waitingSince));
    t.waitingSince = null;
  }
  if (t.status === "resolved") {
    Object.assign(t, {
      resolvedAt: undefined,
      resolution: undefined,
      slaBreached: false,
      slaWarnedAt: null,
    });
    t.slaDueAt = computeSlaDue(t.priority, now);
  }
}

export async function assign(user, id, { agentId }) {
  const t = await Ticket.findById(id);
  if (!t) throw ApiError.notFound("Ticket");
  const agent = await User.findOne({
    _id: agentId,
    role: "agent",
    active: true,
  }).select("name email");
  if (!agent) throw ApiError.badRequest("That user is not an active agent");
  if (["resolved", "closed"].includes(t.status)) {
    throw new ApiError(
      409,
      "TICKET_FINISHED",
      "Reopen the ticket before reassigning it",
    );
  }

  const from = t.assignedAgent?.toString() ?? null;
  t.assignedAgent = agent._id;
  if (t.status === "open") t.status = "assigned";
  t.history.push({
    action: "assigned",
    by: user.id,
    from,
    to: agentId,
    note: "manual",
  });
  await t.save();
  await Assignment.create({
    ticket: t._id,
    agent: agent._id,
    assignedBy: user.id,
    method: "manual",
  });
  tellAgent(t, agent);
  return present(t, user);
}

/** A human confirms or corrects the model. Recorded, because it measures the model. */
export async function triage(user, id, { category, priority }) {
  const t = await loadVisible(user, id);
  const before = { category: t.category, priority: t.priority };

  if (category) t.category = category;
  if (priority && priority !== t.priority) {
    t.priority = priority;
    t.slaDueAt = computeSlaDue(priority, t.createdAt); // SLA runs from when the customer asked
    t.slaBreached = t.slaDueAt < new Date();
    t.slaWarnedAt = null;
  }
  const differsFromModel =
    (t.predictedCategory && t.category !== t.predictedCategory) ||
    (t.predictedPriority && t.priority !== t.predictedPriority);
  t.overriddenBy = differsFromModel ? user.id : null;
  t.needsTriage = false;
  t.history.push({
    action: "triaged",
    by: user.id,
    from: before,
    to: { category: t.category, priority: t.priority },
  });

  const agent = await autoAssign(t);
  await t.save();
  if (agent)
    await Assignment.create({
      ticket: t._id,
      agent: agent._id,
      method: "auto",
    });
  if (agent) tellAgent(t, agent);
  return present(t, user);
}

export async function addComment(user, id, { body, internal }) {
  const t = await loadVisible(user, id);
  if (t.status === "closed")
    throw new ApiError(409, "TICKET_CLOSED", "This ticket is closed");

  const isInternal = user.role === "customer" ? false : Boolean(internal);
  t.comments.push({ author: user.id, body, internal: isInternal });

  // A customer reply to "waiting on you", or to a resolution that did not fix it,
  // puts the ticket back in the agent's court.
  if (
    user.role === "customer" &&
    ["waiting_customer", "resolved"].includes(t.status)
  ) {
    const from = t.status;
    leaving(t, new Date());
    t.status = "in_progress";
    t.history.push({
      action: "status",
      by: user.id,
      from,
      to: "in_progress",
      note:
        from === "resolved" ? "reopened by the customer" : "customer replied",
    });
  }
  await t.save();
  await t.populate({ path: "comments.author", select: "name role" });
  return present(t, user);
}

// ---------------------------------------------------------------- images
const IMAGE_TYPES = [
  // recognised by their first bytes, never by the name or type the browser sent
  {
    mimetype: "image/png",
    ext: "png",
    is: (b) => b.readUInt32BE(0) === 0x89504e47,
  },
  {
    mimetype: "image/jpeg",
    ext: "jpg",
    is: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mimetype: "image/gif",
    ext: "gif",
    is: (b) => b.toString("latin1", 0, 4) === "GIF8",
  },
  {
    mimetype: "image/webp",
    ext: "webp",
    is: (b) =>
      b.toString("latin1", 0, 4) === "RIFF" &&
      b.toString("latin1", 8, 12) === "WEBP",
  },
];
const MAX_IMAGES_PER_TICKET = 10;

/** Saves images (already size-limited by the upload middleware) to the ticket. */
export async function addImages(user, id, files) {
  const t = await loadVisible(user, id);
  if (t.status === "closed")
    throw new ApiError(409, "TICKET_CLOSED", "This ticket is closed");
  if (!files.length) throw ApiError.badRequest("Choose at least one image");
  if (t.attachments.length + files.length > MAX_IMAGES_PER_TICKET) {
    throw ApiError.badRequest(
      `A ticket can hold at most ${MAX_IMAGES_PER_TICKET} images`,
    );
  }
  const images = files.map((f) => ({
    file: f,
    type: f.buffer.length >= 12 && IMAGE_TYPES.find((i) => i.is(f.buffer)),
  }));
  const bad = images.find((i) => !i.type);
  if (bad)
    throw ApiError.badRequest(
      `${bad.file.originalname} is not a PNG, JPEG, GIF or WebP image`,
    );

  const dir = resolve(env.uploadDir);
  await mkdir(dir, { recursive: true });
  for (const { file, type } of images) {
    const filename = `${randomUUID()}.${type.ext}`;
    await writeFile(join(dir, filename), file.buffer);
    t.attachments.push({
      filename,
      mimetype: type.mimetype,
      size: file.size,
      uploadedBy: user.id,
    });
  }
  await t.save();
  return present(t, user);
}

/** Where an image of a ticket this user can see is stored. */
export async function imageFile(user, id, filename) {
  const t = await loadVisible(user, id);
  const image = t.attachments.find((a) => a.filename === filename);
  if (!image) throw ApiError.notFound("Image");
  return {
    path: join(resolve(env.uploadDir), image.filename),
    mimetype: image.mimetype,
  };
}
