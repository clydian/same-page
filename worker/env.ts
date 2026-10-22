export interface Env {
  ASSETS: Fetcher;
  FRONTEND_RELEASES?: R2Bucket;
  RELEASE_CHANNELS_ENABLED?: string;
  DB: D1Database;
  SCORES_BUCKET: R2Bucket;
  ANDROID_RELEASES?: R2Bucket;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  RESEND_API_KEY_SAMEPAGE: string;
  AUTH_EMAIL_FROM: string;
  INVITE_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  PERFORMANCE_TEST_DELAY_MS?: string;
}

export interface AppEnvironment {
  Bindings: Env;
  Variables: {
    serverTiming?: import("./performance/server-timing").RequestServerTiming;
    adminCliToken?: { id: string; userId: string; driveIds: string[] };
  };
}

export interface WaitUntilContext {
  waitUntil(promise: Promise<unknown>): void;
}
