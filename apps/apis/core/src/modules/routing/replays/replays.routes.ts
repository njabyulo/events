import { Hono } from "hono";
import {
  createReplayHandler,
  getReplayHandler,
  listReplaysHandler,
} from "./replays.handlers.js";

export const replaysRouter = new Hono();

replaysRouter.get("/", listReplaysHandler);
replaysRouter.post("/", createReplayHandler);
replaysRouter.get("/:id", getReplayHandler);
