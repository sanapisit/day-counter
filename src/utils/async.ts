// ---------------------------------------------------------------------------
// Semaphore
// ---------------------------------------------------------------------------
// จำกัดจำนวนงานหนักที่วิ่งพร้อมกัน: บน Pi ที่มี 2 CPU การปล่อยให้ทุกงาน render
// พร้อมกันทำให้ทุกอันช้าลงพร้อมกันจนชน timeout และ peak memory พุ่งเกิน limit
export type Semaphore = {
  run: <T>(task: () => Promise<T>) => Promise<T>;
};

export const createSemaphore = (limit: number): Semaphore => {
  let active = 0;
  const waiters: Array<() => void> = [];

  const acquire = (): Promise<void> => {
    if (active < limit) {
      active++;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => waiters.push(resolve));
  };

  const release = () => {
    const next = waiters.shift();
    // ส่งต่อ slot ให้คิวถัดไปโดยไม่ลด active
    if (next) next();
    else active--;
  };

  return {
    run: async (task) => {
      await acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
};

// ---------------------------------------------------------------------------
// Debounce
// ---------------------------------------------------------------------------
// รวบการเรียกรัวๆ ให้เหลืองานเดียว — timer ถูก unref() เสมอ จะได้ไม่กัน process
// ไม่ให้ปิดตัวตอน shutdown
export const createDebouncedTask = (delayMs: number, task: () => void) => {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      task();
    }, delayMs);
    timer.unref();
  };
};

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------
// หมายเหตุ: race ไม่ได้ยกเลิกงานที่ค้างอยู่ แค่เลิกรอผลลัพธ์เท่านั้น
export const withTimeout = async <T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    // ไม่เคลียร์ = ทุก request ทิ้ง timer ค้าง event loop ไว้จนครบเวลา
    clearTimeout(timer);
  }
};
