import type { AbstractIntlMessages } from "use-intl/core";

export default import.meta.glob<AbstractIntlMessages>(
  "/src/i18n/messages/ja/{common,entry,language,library,practice,reader,system}.json",
  { eager: true, import: "default" },
);
