import { LocaleConstants, TZConstants } from "../constants/tz";

// timestamp ผูกกับเวลาไทยเสมอ ไม่ขึ้นกับ TZ ของ container
const formatter = new Intl.DateTimeFormat(LocaleConstants.TH, {
  timeZone: TZConstants.TH,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const log = (type: string, ...args: unknown[]) => {
  console.log(`${formatter.format(Date.now())} [${type}]`, ...args);
};

export const Logs = {
  log: (...args: unknown[]) => log("LOG", ...args),
};
