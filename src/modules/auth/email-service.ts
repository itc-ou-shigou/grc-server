/**
 * Email Service — SMTP email delivery for verification codes.
 *
 * Uses nodemailer with STARTTLS to send verification emails.
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import pino from "pino";
import type { GrcConfig } from "../../config.js";

const logger = pino({ name: "auth:email-service" });

export class EmailService {
  private transporter: Transporter;
  private fromEmail: string;
  private fromName: string;

  constructor(config: GrcConfig) {
    this.fromEmail = config.smtp.fromEmail;
    this.fromName = config.smtp.fromName;

    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: false, // STARTTLS
      auth: {
        user: config.smtp.user,
        pass: config.smtp.password,
      },
    });
  }

  /**
   * Send a 6-digit verification code to the given email address.
   */
  async sendVerificationCode(email: string, code: string): Promise<void> {
    const mailOptions = {
      from: `"${this.fromName}" <${this.fromEmail}>`,
      to: email,
      subject: "GRC - Email Verification Code",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px">
          <h2 style="color:#333;margin-bottom:16px">Your Verification Code</h2>
          <p style="font-size:32px;font-weight:bold;letter-spacing:8px;color:#1a73e8;text-align:center;padding:16px 0;background:#f5f5f5;border-radius:8px">${code}</p>
          <p style="color:#666;font-size:14px;margin-top:16px">This code expires in 10 minutes. If you did not request this code, please ignore this email.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
          <p style="color:#999;font-size:12px">GRC - WinClaw Global Resource Center</p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
      logger.info({ email }, "Verification code email sent");
    } catch (err) {
      logger.error({ err, email }, "Failed to send verification code email");
      throw new Error("Failed to send verification email");
    }
  }
}
