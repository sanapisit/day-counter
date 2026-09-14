export const RegexConstants = {
  // DD/MM/YYYY (ปี พ.ศ.) — จับกลุ่มไว้ให้ parseEnvDate() ใช้ต่อ
  DATE: /^(\d{2})\/(\d{2})\/(\d{4})$/,
} as const;
