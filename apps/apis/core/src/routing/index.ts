import { Hono } from "hono"
import { notificationsRouter } from "../modules/notifications/notifications.routes.js"


export const app = new Hono()

app.get('/', (c) => {
  return c.text('Hello Hono!')
})

app.route('/notifications', notificationsRouter)