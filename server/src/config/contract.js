// Loads shared/contract.json - the single source of truth for every enum.
// Import from here; never hardcode a category, priority, status or role.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(
  resolve(here, "../../../shared/contract.json"),
  "utf8",
);

export const contract = Object.freeze(JSON.parse(raw));

export const ROLES = Object.freeze([...contract.roles]);
export const CATEGORIES = Object.freeze([...contract.categories]);
export const PRIORITIES = Object.freeze([...contract.priorities]);
export const STATUSES = Object.freeze([...contract.statuses]);
/** Every status that still needs work: all but resolved and closed. */
export const ACTIVE_STATUSES = Object.freeze(
  STATUSES.filter((s) => !["resolved", "closed"].includes(s)),
);
const STATUS_TRANSITIONS = Object.freeze(contract.statusTransitions);
export const SLA_HOURS = Object.freeze(contract.slaHours);
export const ML_CONFIG = Object.freeze(contract.ml);

/** true if `from -> to` is an allowed status change */
export const canTransition = (from, to) =>
  Array.isArray(STATUS_TRANSITIONS[from]) &&
  STATUS_TRANSITIONS[from].includes(to);
