import { PRIORITIES, SLA_HOURS } from "../config/contract.js";

const HOUR = 60 * 60 * 1000;

/** When a ticket of this priority, opened at `from`, is due. */
export function computeSlaDue(priority, from = new Date()) {
  const hours = SLA_HOURS[priority] ?? SLA_HOURS.medium;
  return new Date(new Date(from).getTime() + hours * HOUR);
}

/** One step up the priority ladder, capped at the top. */
export function escalatePriority(priority) {
  const i = PRIORITIES.indexOf(priority);
  if (i === -1) return priority;
  return PRIORITIES[Math.min(i + 1, PRIORITIES.length - 1)];
}
