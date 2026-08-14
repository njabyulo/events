import type { Context } from "hono"

export const getNotificationhandler = (c: Context) => {
    const id = c.req.param('id')

    return c.json({
        data: {
            id
        }
    })
}
