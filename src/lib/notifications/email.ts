import { prisma } from "../db";

export type EmailMessage = { to: string; subject: string; text: string; template?: string };

interface EmailProvider {
  name: string;
  send(msg: EmailMessage): Promise<void>;
}

/** Development/test provider: nothing leaves the server; messages appear in Settings → Email log. */
const previewProvider: EmailProvider = { name: "preview", async send() {} };

function smtpProvider(): EmailProvider {
  return {
    name: "smtp",
    async send(msg) {
      const nodemailer = await import("nodemailer");
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === "true",
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined,
      });
      await transport.sendMail({ from: process.env.EMAIL_FROM ?? "TRENDS <no-reply@localhost>", to: msg.to, subject: msg.subject, text: msg.text });
    },
  };
}

export function emailProvider(): EmailProvider {
  return process.env.EMAIL_PROVIDER === "smtp" && process.env.SMTP_HOST ? smtpProvider() : previewProvider;
}

export const emailMode = () => emailProvider().name;

/** Send with up to 3 attempts; every attempt outcome is logged (never credentials). */
export async function sendEmail(msg: EmailMessage) {
  const provider = emailProvider();
  let attempts = 0;
  let error: string | null = null;
  while (attempts < 3) {
    attempts++;
    try {
      await provider.send(msg);
      error = null;
      break;
    } catch (e) {
      error = e instanceof Error ? e.message.replace(/(pass(word)?|auth)[^\s]*/gi, "[redacted]").slice(0, 500) : "send failed";
      await new Promise((r) => setTimeout(r, 200 * attempts));
    }
  }
  await prisma.emailLog.create({
    data: { template: msg.template, to: msg.to, subject: msg.subject, body: msg.text.slice(0, 5000), provider: provider.name, status: error ? "FAILED" : provider.name === "preview" ? "PREVIEW" : "SENT", error, attempts },
  });
  return !error;
}
