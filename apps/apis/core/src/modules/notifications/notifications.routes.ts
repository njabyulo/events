import { Hono } from "hono";
import { streamNotificationshandler } from "./handlers/streamNotificationshandler.js";
import { getNotificationhandler } from "./handlers/getNotificationhandler.js";
import { postNotificationhandler } from "./handlers/postNotificationhandler.js";

export const notificationsRouter = new Hono();

notificationsRouter.get('/', streamNotificationshandler)
notificationsRouter.get('/:id', getNotificationhandler)
notificationsRouter.post('/', postNotificationhandler)