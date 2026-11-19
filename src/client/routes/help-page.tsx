import { useMessages } from "../../i18n";
import { useLayoutEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { TaskHeader } from "../components/task-header";

type Chapter = { id: string; title: string; intro: string; topics: { title: string; paragraphs?: string[]; steps?: string[] }[] };

const chapters: Chapter[] = [
  { id: "start", title: "help.start.title", intro: "help.start.intro", topics: [
    { title: "help.start.walkthrough.title", steps: ["help.start.walkthrough.step1", "help.start.walkthrough.step2", "help.start.walkthrough.step3", "help.start.walkthrough.step4", "help.start.walkthrough.step5", "help.start.walkthrough.step6"] },
    { title: "help.start.try.title", paragraphs: ["help.start.try.paragraph1"] },
  ] },
  { id: "read", title: "help.read.title", intro: "help.read.intro", topics: [
    { title: "help.read.navigation.title", paragraphs: ["help.read.navigation.paragraph1", "help.read.navigation.paragraph2"] },
    { title: "help.read.layers.title", paragraphs: ["help.read.layers.paragraph1", "help.read.layers.paragraph2", "help.read.layers.paragraph3"] },
  ] },
  { id: "practice", title: "help.practice.title", intro: "help.practice.intro", topics: [
    { title: "help.practice.open.title", steps: ["help.practice.open.step1", "help.practice.open.step2"] },
    { title: "help.practice.repetition.title", paragraphs: ["help.practice.repetition.paragraph1", "help.practice.repetition.paragraph2"] },
    { title: "help.practice.views.title", paragraphs: ["help.practice.views.paragraph1", "help.practice.views.paragraph2"] },
    { title: "help.practice.offline.title", steps: ["help.practice.offline.step1", "help.practice.offline.step2", "help.practice.offline.step3"] },
  ] },
  { id: "notes", title: "help.notes.title", intro: "help.notes.intro", topics: [
    { title: "help.notes.edit.title", steps: ["help.notes.edit.step1", "help.notes.edit.step2", "help.notes.edit.step3"] },
    { title: "help.notes.tools.title", paragraphs: ["help.notes.tools.paragraph1", "help.notes.tools.paragraph2", "help.notes.tools.paragraph3"] },
    { title: "help.notes.sync.title", paragraphs: ["help.notes.sync.paragraph1", "help.notes.sync.paragraph2"] },
  ] },
  { id: "sharing", title: "help.sharing.title", intro: "help.sharing.intro", topics: [
    { title: "help.sharing.newLayer.title", paragraphs: ["help.sharing.newLayer.paragraph1"] },
    { title: "help.sharing.share.title", paragraphs: ["help.sharing.share.paragraph1", "help.sharing.share.paragraph2", "help.sharing.share.paragraph3"] },
    { title: "help.sharing.restore.title", paragraphs: ["help.sharing.restore.paragraph1"] },
  ] },
  { id: "offline", title: "help.offline.title", intro: "help.offline.intro", topics: [
    { title: "help.offline.prepare.title", steps: ["help.offline.prepare.step1", "help.offline.prepare.step2", "help.offline.prepare.step3"] },
    { title: "help.offline.install.title", paragraphs: ["help.offline.install.paragraph1", "help.offline.install.paragraph2"] },
    { title: "help.offline.storage.title", paragraphs: ["help.offline.storage.paragraph1", "help.offline.storage.paragraph2"] },
  ] },
  { id: "files", title: "help.files.title", intro: "help.files.intro", topics: [
    { title: "help.files.upload.title", paragraphs: ["help.files.upload.paragraph1", "help.files.upload.paragraph2"] },
    { title: "help.files.export.title", paragraphs: ["help.files.export.paragraph1", "help.files.export.paragraph2"] },
    { title: "help.files.trash.title", paragraphs: ["help.files.trash.paragraph1", "help.files.trash.paragraph2"] },
  ] },
  { id: "members", title: "help.members.title", intro: "help.members.intro", topics: [
    { title: "help.members.create.title", paragraphs: ["help.members.create.paragraph1", "help.members.create.paragraph2"] },
    { title: "help.members.permissions.title", paragraphs: ["help.members.permissions.paragraph1", "help.members.permissions.paragraph2"] },
    { title: "help.members.retention.title", paragraphs: ["help.members.retention.paragraph1", "help.members.retention.paragraph2"] },
  ] },
  { id: "account", title: "help.account.title", intro: "help.account.intro", topics: [
    { title: "help.account.sync.title", paragraphs: ["help.account.sync.paragraph1"] },
    { title: "help.account.leave.title", paragraphs: ["help.account.leave.paragraph1", "help.account.leave.paragraph2"] },
    { title: "help.account.delete.title", paragraphs: ["help.account.delete.paragraph1", "help.account.delete.paragraph2"] },
  ] },
  { id: "questions", title: "help.questions.title", intro: "help.questions.intro", topics: [
    { title: "help.questions.finding.title", paragraphs: ["help.questions.finding.paragraph1", "help.questions.finding.paragraph2"] },
    { title: "help.questions.sync.title", paragraphs: ["help.questions.sync.paragraph1", "help.questions.sync.paragraph2"] },
    { title: "help.questions.offline.title", paragraphs: ["help.questions.offline.paragraph1", "help.questions.offline.paragraph2"] },
  ] },
];

export default function HelpPage() {
  const t = useMessages("entry");
  const { hash, key } = useLocation();
  useLayoutEffect(() => {
    const target = document.getElementById(hash.slice(1));
    if (target) { target.focus({ preventScroll: true }); target.scrollIntoView(); }
  }, [hash, key]);
  return <div className="privacy-page">
    <TaskHeader title={t("about.manual")} backTo="/drives" />
    <main className="privacy-document" aria-label={t("about.manual")}>
      <header className="privacy-document__header">
        <p className="eyebrow">合谱 · Same Page</p>
        <p className="privacy-document__updated">{t.rich("help.updated", { date: children => <time dateTime="2026-10-21">{children}</time> })}</p>
        <p className="privacy-document__lead">{t("help.lead")}</p>
      </header>
      <details className="manual-contents" id="contents" tabIndex={-1} open>
        <summary>{t("help.contents")}</summary>
        <nav aria-label={t("help.contentsLabel")}><ol>{chapters.map(chapter => <li key={chapter.id}><Link replace to={`#${chapter.id}`}>{t(chapter.title)}</Link></li>)}</ol></nav>
      </details>
      {chapters.map(chapter => <section key={chapter.id} aria-labelledby={chapter.id}>
        <h2 id={chapter.id} tabIndex={-1}>{t(chapter.title)}</h2>
        <p>{t(chapter.intro)}</p>
        {chapter.topics.map(topic => <div className="manual-topic" key={topic.title}>
          <h3>{t(topic.title)}</h3>
          {topic.steps && <ol>{topic.steps.map(step => <li key={step}>{t(step)}</li>)}</ol>}
          {topic.paragraphs?.map(paragraph => <p key={paragraph}>{t(paragraph)}</p>)}
        </div>)}
        <Link replace className="manual-back" to="#contents">{t("help.back")}</Link>
      </section>)}
      <section aria-labelledby="diagnostics"><h2 id="diagnostics">{t("about.feedback")}</h2><p>{t("help.feedbackHint")}</p><Link to="/diagnostics">{t("help.sendFeedback")}</Link></section>
    </main>
  </div>;
}
