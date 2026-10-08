import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { hashPassword } from "./authService.js";

export async function list({ role }) {
  const users = await User.find(role ? { role } : {}).sort({
    role: 1,
    name: 1,
  });
  return users.map((u) => u.toSafeJSON());
}

export async function create({ name, email, password, role, categories }) {
  if (await User.exists({ email })) {
    throw ApiError.conflict(
      "EMAIL_TAKEN",
      "An account with this email already exists",
    );
  }
  const user = await User.create({
    name,
    email,
    role,
    categories: role === "agent" ? categories : [],
    passwordHash: await hashPassword(password),
  });
  return user.toSafeJSON();
}

export async function update(actor, id, changes) {
  if (
    id === actor.id &&
    (changes.active === false || (changes.role && changes.role !== "manager"))
  ) {
    throw ApiError.badRequest(
      "You cannot deactivate or demote your own account",
    );
  }
  const user = await User.findById(id);
  if (!user) throw ApiError.notFound("User");
  if (changes.email !== undefined && changes.email !== user.email) {
    if (await User.exists({ email: changes.email })) {
      throw ApiError.conflict(
        "EMAIL_TAKEN",
        "An account with this email already exists",
      );
    }
    user.email = changes.email; // e.g. fixing a typo, without losing their tickets and record
  }
  if (changes.role !== undefined) user.role = changes.role;
  if (changes.active !== undefined) {
    user.active = changes.active;
    if (!changes.active) user.refreshTokenHash = null; // end their sessions now
  }
  if (changes.categories !== undefined) user.categories = changes.categories;
  await user.save();
  return user.toSafeJSON();
}
