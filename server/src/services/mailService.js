// Sends email through SMTP_URL. Without one (development), each email is printed
// to the console instead. Every email goes out as plain text and simple HTML, and
// every attempt is logged, so it is always clear whether mail is working.
import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { User } from "../models/User.js";

export const transport = nodemailer.createTransport(
  env.smtpUrl || { jsonTransport: true },
);

const escape = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

function html(paragraphs, link) {
  const body = paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 14px">${escape(p).replaceAll("\n", "<br>")}</p>`,
    )
    .join("");
  const button = link
    ? `<p style="margin:22px 0 0"><a href="${escape(link.url)}" style="background:#1c5d99;color:#fff;` +
      `padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:bold">${escape(link.label)}</a></p>`
    : "";
  return (
    `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#16202a;max-width:560px">` +
    `<p style="margin:0 0 18px;font-size:18px;font-weight:bold">TriageDesk</p>${body}${button}</div>`
  );
}

/** Sends one email now. `paragraphs` are the body; `link` ({ label, url }) becomes a button. */
export async function send(to, subject, paragraphs, link) {
  const recipients = [...new Set(to.filter(Boolean))];
  if (!recipients.length) return;
  const text = [
    ...paragraphs,
    ...(link ? [`${link.label}: ${link.url}`] : []),
  ].join("\n\n");
  await transport.sendMail({
    from: env.mailFrom,
    to: recipients,
    subject,
    text,
    html: html(paragraphs, link),
  });
  if (!env.isTest) {
    console.log(
      `[mail] ${env.smtpUrl ? "sent" : "not sent (no SMTP_URL)"} to ${recipients.join(", ")}: ${subject}`,
    );
  }
}

/**
 * Sends in the background, so no request waits for the mail server. `build` returns
 * { to, subject, paragraphs, link }. A failure is logged with its reason, never thrown.
 */
export function notify(build) {
  Promise.resolve()
    .then(build)
    .then((m) =>
      send(m.to, m.subject, m.paragraphs, m.link).catch((err) => {
        throw new Error(`"${m.subject}" to ${m.to.join(", ")}: ${err.message}`);
      }),
    )
    .catch((err) => console.error(`[mail] FAILED ${err.message}`));
}

export const managerEmails = async () =>
  (
    await User.find({ role: "manager", active: true }).select("email").lean()
  ).map((u) => u.email);

export const greeting = (name) => `Hi ${name.split(" ")[0]},`;

/** A short ticket number for subjects, e.g. #4F2A1C. */
export const ticketRef = (ticket) =>
  `#${ticket._id.toString().slice(-6).toUpperCase()}`;
export const ticketLink = (ticket) => ({
  label: "Open the ticket",
  url: `${env.clientOrigin}/tickets/${ticket._id}`,
});
