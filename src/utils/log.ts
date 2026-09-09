import { LocaleConstants, TZConstants } from "../constants/tz";

export const Logs = {
  log: (...args: any) => log("LOG", ...args),
};

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

const getDateTime = () => formatter.format(Date.now());

const log = (type: string, ...args: any) => {
  return console.log(`${getDateTime()} [${type}]`, ...args);
};
