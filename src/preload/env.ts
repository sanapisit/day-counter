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
  if (!Object.values(NodeEnv).includes(nodeEnv)) {
    throw new Error("Invalid NODE_ENV");
  }

  if (!HOST) {
    throw new Error("Invalid HOST");
  }

  const port = Number(PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("Invalid PORT");
  }

  const fontSize = Number(FONT_SIZE);
  if (!Number.isInteger(fontSize)) {
    throw new TypeError("Invalid FONT_SIZE");
  }

  const defaultHeight = Number(DEFAULT_HEIGHT);
  if (!Number.isInteger(defaultHeight)) {
    throw new TypeError("Invalid DEFAULT_HEIGHT");
  }

  const defaultWidth = Number(DEFAULT_WIDTH);
  if (!Number.isInteger(defaultWidth)) {
    throw new TypeError("Invalid DEFAULT_WIDTH");
  }

  const maxNameLength = 30;
  if (
    typeof PERSON_NAME_1 === "string" &&
    (PERSON_NAME_1.trim().length === 0 || PERSON_NAME_1.length > maxNameLength)
  ) {
    throw new Error("Invalid PERSON_NAME_1");
  }

  if (
    typeof PERSON_NAME_2 === "string" &&
    (PERSON_NAME_2.trim().length === 0 || PERSON_NAME_2.length > maxNameLength)
  ) {
    throw new Error("Invalid PERSON_NAME_2");
  }

  // DD/MM/YYYY ปี พ.ศ. — parseEnvDate เช็คทั้งรูปแบบ, ความมีอยู่จริงของวันที่
  // (31/02/2569 ไม่ผ่าน) และช่วงปี พ.ศ. ที่สมเหตุสมผล จึงดักตั้งแต่ตอน boot
  // แทนที่จะปล่อยไปโผล่เป็น "Invalid date" บนภาพ
  const dateHint = "expected DD/MM/YYYY in Buddhist year, e.g. 01/03/2569";

  if (!parseEnvDate(PERSON_BIRTHDAY_1)) {
    throw new Error(`Invalid PERSON_BIRTHDAY_1 (${dateHint})`);
  }

  if (!parseEnvDate(PERSON_BIRTHDAY_2)) {
    throw new Error(`Invalid PERSON_BIRTHDAY_2 (${dateHint})`);
  }

  if (!parseEnvDate(ANNIVERSARY)) {
    throw new Error(`Invalid ANNIVERSARY (${dateHint})`);
  }

  return {
    NODE_ENV: nodeEnv,
    HOST,
    PORT: port,

    FONT_SIZE: fontSize,
    DEFAULT_HEIGHT: defaultHeight,
    DEFAULT_WIDTH: defaultWidth,

    PERSON_NAME_1,
    PERSON_BIRTHDAY_1,
    PERSON_NAME_2,
    PERSON_BIRTHDAY_2,
    ANNIVERSARY,
  };
};
