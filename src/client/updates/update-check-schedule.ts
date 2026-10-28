const interval = 30 * 60_000;
const minimumGap = 30_000;

// Kept by the page, including across registration retries. Manual checks bypass
// due(), but still update the schedule so lifecycle events cannot multiply them.
export class UpdateCheckSchedule {
  private nextCheckAt = 0;
  private earliestCheckAt = 0;
  private failures = 0;

  request() {
    this.nextCheckAt = Math.min(this.nextCheckAt, this.earliestCheckAt);
  }

  due() {
    const now = Date.now();
    return now >= this.earliestCheckAt && now >= this.nextCheckAt;
  }

  started() {
    this.earliestCheckAt = Date.now() + minimumGap;
    this.nextCheckAt = Date.now() + interval;
  }

  succeeded() {
    this.failures = 0;
    this.nextCheckAt = Date.now() + interval;
  }

  failed() {
    const delay = Math.min(interval, minimumGap * 2 ** Math.min(this.failures++, 6));
    this.earliestCheckAt = this.nextCheckAt = Date.now() + delay;
  }
}
