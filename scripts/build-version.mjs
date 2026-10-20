// A release keeps this value with its immutable build bytes, including redeploys.
export function formatBuildVersion(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai", year: "2-digit", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `v${parts.year}.${parts.month}.${parts.day}.${parts.hour}${parts.minute}`;
}
