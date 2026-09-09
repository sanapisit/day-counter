import { HeaderConstants } from "./constants/headers";
import { ResConstants } from "./constants/res";
import { Config } from "./preload";
import { NodeEnv } from "./preload/env";
import { dayCounter } from "./services/day-counter";
import { Logs } from "./utils/log";

export const createServer = () => {
  return Bun.serve({
    port: Config.PORT,
    hostname: Config.HOST,
    development: Config.NODE_ENV !== NodeEnv.production,
    reusePort: true,

    fetch: async (req: Request): Promise<Response> => {
      const url = new URL(req.url);
      const path = url.pathname;
      Logs.log("call " + path + url.search);

      try {
        if (path === "/") {
          return new Response(ResConstants.ROOT_PAYLOAD, {
            status: 200,
            headers: HeaderConstants.JSON_HEADERS,
          });
        }

        if (path === "/health") {
          return new Response("ok");
        }

        if (path === "/day-counter") {
          return await dayCounter(url.searchParams);
        }

        return new Response(ResConstants.NOT_FOUND, { status: 404 });
      } catch (err) {
        Logs.log("error " + path + url.search + ": " + (err as Error).message);
        return new Response("Internal Server Error", { status: 500 });
      }
    },
  });
};
