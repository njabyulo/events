import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { maxEventBodyBytes } from "../events.config.js";
import {
  getEventHandler,
  getEventsHandler,
  postEventHandler,
} from "./core.handlers.js";

export const coreRouter = new Hono();

coreRouter.get("/", getEventsHandler);
coreRouter.post(
  "/",
  bodyLimit({
    maxSize: maxEventBodyBytes(),
    onError: () => {
      throw new HTTPException(413, { message: "Event payload is too large" });
    },
  }),
  postEventHandler,
);
coreRouter.get("/:id", getEventHandler);
