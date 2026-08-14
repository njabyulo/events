import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { Client } from "pg";
import 'dotenv/config';

const DATABASE_URL = process.env.DATABASE_URL

const pgListener = new Client({
    connectionString: DATABASE_URL,
});

const activeClients = new Set<(data: any) => Promise<void>>();

async function startNotificationEngine() {
    await pgListener.connect();
    await pgListener.query('LISTEN my_channel');
    console.log('🚀 Postgres engine listening on "my_channel"');

    // 2. Broadcast incoming DB notifications to all active Hono streams
    pgListener.on('notification', (msg) => {
        console.log('🔔 Received from DB:', msg.payload);

        for (const sendEvent of activeClients) {
            sendEvent(msg.payload || '');
        }
    });
}

startNotificationEngine().catch(console.error);

export const streamNotificationshandler = (c: Context) => {
    return streamSSE(c, async (stream) => {
        // Define how to push data down this specific user's pipe
        const sendEvent = async (data: any) => {
            await stream.writeSSE({
                data: data,
                event: 'db-update',
            });
        };

        // Add this unique client to our broadcaster pool
        activeClients.add(sendEvent);
        console.log(`👤 Client connected. Total: ${activeClients.size}`);

        // Keep the stream alive and handle sudden client disconnects
        stream.onAbort(() => {
            activeClients.delete(sendEvent);
            console.log(`❌ Client disconnected. Total: ${activeClients.size}`);
        });

        // Prevent the stream function from closing immediately
        while (true) {
            await stream.sleep(30000); // Heartbeat loop
        }
    });
}