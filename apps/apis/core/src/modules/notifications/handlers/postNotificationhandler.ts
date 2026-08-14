import type { Context } from "hono"

export const postNotificationhandler = (c: Context) => {
    return c.json({ message: 'Posted Notifications' })
}