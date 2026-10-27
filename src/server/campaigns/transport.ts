/**
 * Message transport. By default nothing leaves this machine: messages are written to the outbox
 * with status "held" for the owner to read. Real email needs SMTP_URL (an SMTP server the owner
 * controls or contracts) and is sent through nodemailer with a List-Unsubscribe header.
 * WhatsApp is not implemented: it needs the owner's WhatsApp Business account and approved
 * templates (see docs/platform/07-integration-research.md).
 */

export type SendResult = { status: "held" | "sent" | "failed"; transport: "outbox" | "smtp"; providerId: string | null; error: string | null };
export type Email = { to: string; subject: string; body: string; unsubscribeUrl: string };

export const transportName = () => (process.env.SMTP_URL ? "smtp" : "outbox");

export async function sendEmail(email: Email): Promise<SendResult> {
  if (!process.env.SMTP_URL) return { status: "held", transport: "outbox", providerId: null, error: null };
  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport(process.env.SMTP_URL);
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: email.to,
      subject: email.subject,
      text: email.body,
      headers: { "List-Unsubscribe": `<${email.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
    });
    return { status: "sent", transport: "smtp", providerId: info.messageId ?? null, error: null };
  } catch (error) {
    return { status: "failed", transport: "smtp", providerId: null, error: (error as Error).message.slice(0, 500) };
  }
}
