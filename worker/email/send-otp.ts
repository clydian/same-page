import { Resend } from "resend";
import { createTranslator } from "use-intl/core";

import type { Env } from "../env";
import { sourceLocale, type AppLocale } from "../../src/i18n/locales";
import de from "../../src/i18n/messages/de/email.json";
import en from "../../src/i18n/messages/en/email.json";
import es419 from "../../src/i18n/messages/es-419/email.json";
import fr from "../../src/i18n/messages/fr/email.json";
import it from "../../src/i18n/messages/it/email.json";
import ja from "../../src/i18n/messages/ja/email.json";
import ko from "../../src/i18n/messages/ko/email.json";
import ptBR from "../../src/i18n/messages/pt-BR/email.json";
import zhHans from "../../src/i18n/messages/zh-Hans/email.json";
import zhHantTW from "../../src/i18n/messages/zh-Hant-TW/email.json";

const messages = { de, en, "es-419": es419, fr, it, ja, ko, "pt-BR": ptBR, "zh-Hans": zhHans, "zh-Hant-TW": zhHantTW } satisfies Record<AppLocale, typeof zhHans>;

export type AuthOtpPurpose = "registration" | "forget-password";

export async function sendAuthOtp(
  env: Pick<Env, "AUTH_EMAIL_FROM" | "RESEND_API_KEY_SAMEPAGE">,
  email: string,
  otp: string,
  purpose: AuthOtpPurpose,
  locale: AppLocale = sourceLocale,
): Promise<void> {
  const message = buildAuthOtpEmail(otp, purpose, locale);
  const resend = new Resend(env.RESEND_API_KEY_SAMEPAGE);
  const { error } = await resend.emails.send({
    from: env.AUTH_EMAIL_FROM,
    to: email,
    ...message,
  });

  if (error) {
    throw new Error("OTP delivery failed");
  }
}

export function buildAuthOtpEmail(otp: string, purpose: AuthOtpPurpose, locale: AppLocale = sourceLocale) {
  const t = createTranslator({ locale, messages: messages[locale] });
  const isRegistration = purpose === "registration";
  const subject = t(isRegistration ? "registrationSubject" : "resetSubject");
  const intro = t(isRegistration ? "registrationIntro" : "resetIntro", { site: "samepage.clyapps.com" });
  const expiry = t("expiry");
  const unexpected = t(isRegistration ? "registrationUnexpected" : "resetUnexpected");

  return {
    subject,
    text: [intro, "", t("codeLine", { code: otp }), "", expiry, unexpected].join("\n"),
    html: [
      `<div lang="${locale}"><p>${escapeHtml(intro)}</p>`,
      `<p>${escapeHtml(t("codeLabel"))}</p><p style="font-size:32px;font-weight:700;letter-spacing:6px">${escapeHtml(otp)}</p>`,
      `<p>${escapeHtml(expiry)}</p><p>${escapeHtml(unexpected)}</p></div>`,
    ].join(""),
  };
}

function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
