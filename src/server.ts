import { HeaderConstants } from "./constants/headers";
import { ResConstants } from "./constants/res";
import { Config } from "./preload";
import { NodeEnv } from "./preload/env";
import { dayCounter } from "./services/day-counter";
import { Logs } from "./utils/log";

const route = async (
  path: string,
  searchParams: URLSearchParams,
): Promise<Response> => {
  switch (path) {
    case "/":
      return new Response(ResConstants.ROOT_PAYLOAD, {
        headers: HeaderConstants.JSON_HEADERS,
      });

    case "/health":
      return new Response("ok");

    case "/day-counter":
      return await dayCounter(searchParams);

    default:
      return new Response(ResConstants.NOT_FOUND, { status: 404 });
  }
};

export const createServer = () => {
  return Bun.serve({
    port: Config.PORT,
    hostname: Config.HOST,
    development: Config.NODE_ENV !== NodeEnv.production,
    reusePort: true,

    fetch: async (req: Request): Promise<Response> => {
      const { pathname, searchParams, search } = new URL(req.url);
      Logs.log(`call ${pathname}${search}`);

      try {
        return await route(pathname, searchParams);
      } catch (err) {
        Logs.log(`error ${pathname}${search}: ${(err as Error).message}`);
        return new Response("Internal Server Error", { status: 500 });
      }
    },
  });
};
