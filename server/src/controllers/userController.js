import * as users from "../services/userService.js";

export async function list(req, res) {
  res.json({ users: await users.list(req.validatedQuery) });
}
export async function create(req, res) {
  res.status(201).json({ user: await users.create(req.body) });
}
export async function update(req, res) {
  res.json({ user: await users.update(req.user, req.params.id, req.body) });
}
