declare const __SAME_PAGE_BUILD_ID__: string;

export const buildId = typeof __SAME_PAGE_BUILD_ID__ === "string"
  ? __SAME_PAGE_BUILD_ID__
  : "development";

declare const __SAME_PAGE_BUILD_RUN_ID__: string;
export const buildRunId = typeof __SAME_PAGE_BUILD_RUN_ID__ === "string" ? __SAME_PAGE_BUILD_RUN_ID__ : "";

declare const __SAME_PAGE_BUILD_PUBLISHED_DATE__: string;
export const buildPublishedDate = typeof __SAME_PAGE_BUILD_PUBLISHED_DATE__ === "string" ? __SAME_PAGE_BUILD_PUBLISHED_DATE__ : "";

declare const __SAME_PAGE_BUILD_VERSION__: string;
export const buildVersion = typeof __SAME_PAGE_BUILD_VERSION__ === "string" ? __SAME_PAGE_BUILD_VERSION__ : "本地开发版";
