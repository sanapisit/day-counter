import { parseEnvDate } from "../utils/date";

export enum NodeEnv {
  development = "development",
  test = "test",
  production = "production",
}

export type Env = {
  NODE_ENV: NodeEnv;
  HOST: string;
  PORT: number;

  FONT_SIZE: number;
  DEFAULT_HEIGHT: number;
  DEFAULT_WIDTH: number;

  PERSON_NAME_1: string;
  PERSON_BIRTHDAY_1: string;
  PERSON_NAME_2: string;
  PERSON_BIRTHDAY_2: string;
  ANNIVERSARY: string;
};

const MAX_NAME_LENGTH = 30;

// DD/MM/YYYY ปี พ.ศ. — parseEnvDate เช็คทั้งรูปแบบ, ความมีอยู่จริงของวันที่
// (31/02/2569 ไม่ผ่าน) และช่วงปี พ.ศ. ที่สมเหตุสมผล จึงดักได้ตั้งแต่ตอน boot
// แทนที่จะปล่อยไปโผล่เป็น "Invalid date" บนภาพ
const DATE_HINT = "expected DD/MM/YYYY in Buddhist year, e.g. 01/03/2569";

const invalid = (name: string, hint?: string) =>
  new Error(hint ? `Invalid ${name} (${hint})` : `Invalid ${name}`);

const requireInteger = (name: string, value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw invalid(name);

  return parsed;
};

const requirePort = (name: string, value: string): number => {
  const port = requireInteger(name, value);
  if (port <= 0 || port > 65535) throw invalid(name);

  return port;
};

const requireName = (name: string, value: string): string => {
  if (value.trim().length === 0 || value.length > MAX_NAME_LENGTH) {
    throw invalid(name);
  }

  return value;
};

const requireDate = (name: string, value: string): string => {
  if (!parseEnvDate(value)) throw invalid(name, DATE_HINT);

  return value;
};

export const loadEnv = (): Env => {
  const {
    NODE_ENV = NodeEnv.development,
    HOST = "0.0.0.0",
    PORT = "3000",

    FONT_SIZE = "48",
    DEFAULT_HEIGHT = "2556",
    DEFAULT_WIDTH = "1179",

    PERSON_NAME_1 = "Person1",
    PERSON_BIRTHDAY_1 = "01/03/2569",
    PERSON_NAME_2 = "Person2",
    PERSON_BIRTHDAY_2 = "01/03/2569",
    ANNIVERSARY = "01/03/2569",
  } = process.env;

  const nodeEnv = NODE_ENV as NodeEnv;
  if (!Object.values(NodeEnv).includes(nodeEnv)) throw invalid("NODE_ENV");
  if (!HOST) throw invalid("HOST");

  return {
    NODE_ENV: nodeEnv,
    HOST,
    PORT: requirePort("PORT", PORT),

    FONT_SIZE: requireInteger("FONT_SIZE", FONT_SIZE),
    DEFAULT_HEIGHT: requireInteger("DEFAULT_HEIGHT", DEFAULT_HEIGHT),
    DEFAULT_WIDTH: requireInteger("DEFAULT_WIDTH", DEFAULT_WIDTH),

    PERSON_NAME_1: requireName("PERSON_NAME_1", PERSON_NAME_1),
    PERSON_BIRTHDAY_1: requireDate("PERSON_BIRTHDAY_1", PERSON_BIRTHDAY_1),
    PERSON_NAME_2: requireName("PERSON_NAME_2", PERSON_NAME_2),
    PERSON_BIRTHDAY_2: requireDate("PERSON_BIRTHDAY_2", PERSON_BIRTHDAY_2),
    ANNIVERSARY: requireDate("ANNIVERSARY", ANNIVERSARY),
  };
};
