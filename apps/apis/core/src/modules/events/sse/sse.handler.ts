import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { Client } from "pg";
import { DATABASE_URL, EVENTS_CHANNEL } from "../events.config.js";

const RECONNECT_DELAY_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30000;

const activeClients = new Set<(data: string) => Promise<void>>();

function broadcast(payload: string) {
    for (const sendEvent of activeClients) {
        sendEvent(payload).catch(() => activeClients.delete(sendEvent));
    }
}

function startNotificationEngine() {
    const pgListener = new Client({ connectionString: DATABASE_URL });
    let restartScheduled = false;

    const restart = (error: unknown) => {
        if (restartScheduled) return;
        restartScheduled = true;
        console.error('Postgres listener disconnected; reconnecting shortly', error);
        pgListener.end().catch(() => {});
        setTimeout(startNotificationEngine, RECONNECT_DELAY_MS);
    };

    pgListener.on('error', restart);
    pgListener.on('notification', (msg) => broadcast(msg.payload ?? ''));

    pgListener.connect()
        .then(() => pgListener.query(`LISTEN "${EVENTS_CHANNEL}"`))
        .then(() => console.log(`Postgres listener active on "${EVENTS_CHANNEL}"`))
        .catch(restart);
}

startNotificationEngine();

export const streamEventsHandler = (c: Context) => {
    return streamSSE(c, async (stream) => {
        const sendEvent = async (data: string) => {
            await stream.writeSSE({
                data,
                event: 'db-update',
            });
        };

        activeClients.add(sendEvent);
        console.log(`Client connected. Total: ${activeClients.size}`);

        stream.onAbort(() => {
            activeClients.delete(sendEvent);
            console.log(`Client disconnected. Total: ${activeClients.size}`);
        });

        while (!stream.aborted) {
            await stream.sleep(HEARTBEAT_INTERVAL_MS);
            if (stream.aborted) break;
            await stream.write(': heartbeat\n\n');
        }
    });
}
