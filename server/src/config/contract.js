// Loads shared/contract.json - the single source of truth for every enum.
// Import from here; never hardcode a category, priority, status or role.

export const contract = Object.freeze(JSON.parse(raw));

export const ROLES = Object.freeze([...contract.roles]);
export const CATEGORIES = Object.freeze([...contract.categories]);
export const PRIORITIES = Object.freeze([...contract.priorities]);
export const STATUSES = Object.freeze([...contract.statuses]);

export const SLA_HOURS = Object.freeze(contract.slaHours);
export const ML_CONFIG = Object.freeze(contract.ml);

/** true if `from -> to` is an allowed status change */
export const canTransition = (from, to) =>

