import { useMessages } from "../../i18n";
import { Link } from "react-router-dom";


const CONTACT_EMAIL = "admin@clyapps.com";

export default function PrivacyPage() {
  const t = useMessages("entry");
  return (
    <main className="privacy-document" aria-label={t("about.privacy")}>
        <header className="privacy-document__header">
          <p className="eyebrow">合谱 · Same Page</p>

          <p className="privacy-document__updated">{t("privacy.updated")}</p>
          <p className="privacy-document__lead">
            {t("privacy.lead")}
          </p>
        </header>

        <section aria-labelledby="privacy-collect">
          <h2 id="privacy-collect">{t("privacy.collect.title")}</h2>
          <ul>
            <li>{t.rich("privacy.collect.identity", { label: children => <strong>{children}</strong> })}</li>
            <li>{t.rich("privacy.collect.google", { label: children => <strong>{children}</strong> })}</li>
            <li>{t.rich("privacy.collect.drive", { label: children => <strong>{children}</strong> })}</li>
            <li>{t.rich("privacy.collect.local", { label: children => <strong>{children}</strong> })}</li>
            <li>{t.rich("privacy.collect.usage", { label: children => <strong>{children}</strong> })}</li>
          </ul>
        </section>

        <section aria-labelledby="privacy-use">
          <h2 id="privacy-use">{t("privacy.use.title")}</h2>
          <ul>
            <li>{t("privacy.use.protectUser")}</li>
            <li>{t("privacy.use.access")}</li>
            <li>{t("privacy.use.sync")}</li>
            <li>{t("privacy.use.emails")}</li>
            <li>{t("privacy.use.security")}</li>
          </ul>
          <p>{t("privacy.use.advertising")}</p>
        </section>

        <section aria-labelledby="privacy-sharing">
          <h2 id="privacy-sharing">{t("privacy.sharing.title")}</h2>
          <p>{t("privacy.sharing.visibility")}</p>
          <p>{t("privacy.sharing.identity")}</p>
        </section>

        <section aria-labelledby="privacy-processors">
          <h2 id="privacy-processors">{t("privacy.processors.title")}</h2>
          <p>{t("privacy.processors.intro")}</p>
          <ul>
            <li>{t.rich("privacy.processors.cloudflare", { label: children => <strong>{children}</strong> })}</li>
            <li>{t.rich("privacy.processors.resend", { label: children => <strong>{children}</strong> })}</li>
            <li>{t.rich("privacy.processors.google", { label: children => <strong>{children}</strong> })}</li>
          </ul>
          <p>{t("privacy.processors.disclosure")}</p>
        </section>

        <section aria-labelledby="privacy-google">
          <h2 id="privacy-google">{t("privacy.google.title")}</h2>
          <p>{t("privacy.google.identity")}</p>
          <p>{t.rich("privacy.google.compliance", { policy: children => <a href="https://developers.google.com/terms/api-services-user-data-policy" rel="noreferrer" target="_blank">{children}</a> })}</p>
        </section>

        <section aria-labelledby="privacy-retention">
          <h2 id="privacy-retention">{t("privacy.retention.title")}</h2>
          <p>{t("privacy.retention.deletedContent")}</p>
          <ul>
            <li>{t("privacy.retention.inactive")}</li>
            <li>{t("privacy.retention.membership")}</li>
            <li>{t("privacy.retention.user")}</li>
            <li>{t("privacy.retention.pdfs")}</li>
          </ul>
          <p>{t("privacy.retention.devices")}</p>
        </section>

        <section aria-labelledby="privacy-security">
          <h2 id="privacy-security">{t("privacy.security.title")}</h2>
          <p>{t("privacy.security.safeguards")}</p>
        </section>

        <section aria-labelledby="privacy-diagnostics">
          <h2 id="privacy-diagnostics">{t("privacy.diagnostics.title")}</h2>
          <p>{t.rich("privacy.diagnostics.local", { feedback: children => <Link to="/diagnostics">{children}</Link> })}</p>
          <p>{t("privacy.diagnostics.report")}</p>
          <p>{t("privacy.diagnostics.retention")}</p>
          <p>{t("privacy.diagnostics.logs")}</p>
        </section>

        <section aria-labelledby="privacy-rights">
          <h2 id="privacy-rights">{t("privacy.rights.title")}</h2>
          <p>{t.rich("privacy.rights.contact", { email: CONTACT_EMAIL, contact: children => <a href={`mailto:${CONTACT_EMAIL}`}>{children}</a> })}</p>
        </section>

        <section aria-labelledby="privacy-updates">
          <h2 id="privacy-updates">{t("privacy.updates.title")}</h2>
          <p>{t("privacy.updates.description")}</p>
        </section>
    </main>
  );
}
