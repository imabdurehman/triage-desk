import * as tickets from "../services/ticketService.js";
import { teamWorkload } from "../services/assignmentService.js";

export async function create(req, res) {
  const ticket = await tickets.create(req.user, req.body);
  res.status(201).json({ ticket: tickets.present(ticket, req.user) });
}
export async function list(req, res) {
  res.json(await tickets.list(req.user, req.validatedQuery));
}
export async function get(req, res) {
  res.json({ ticket: await tickets.get(req.user, req.params.id) });
}
export async function updateStatus(req, res) {
  res.json({
    ticket: await tickets.updateStatus(req.user, req.params.id, req.body),
  });
}
export async function assign(req, res) {
  res.json({ ticket: await tickets.assign(req.user, req.params.id, req.body) });
}
export async function triage(req, res) {
  res.json({ ticket: await tickets.triage(req.user, req.params.id, req.body) });
}
export async function addComment(req, res) {
  res
    .status(201)
    .json({
      ticket: await tickets.addComment(req.user, req.params.id, req.body),
    });
}
export async function workload(req, res) {
  res.json({ agents: await teamWorkload(req.user) });
}
export async function addImages(req, res) {
  res
    .status(201)
    .json({
      ticket: await tickets.addImages(req.user, req.params.id, req.files ?? []),
    });
}
export async function image(req, res) {
  const { path, mimetype } = await tickets.imageFile(
    req.user,
    req.params.id,
    req.params.filename,
  );
  res
    .type(mimetype)
    .set("Cache-Control", "private, max-age=86400")
    .sendFile(path);
}
