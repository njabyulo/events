import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { Client } from "pg";
import { DATABASE_URL, SSE_CHANNEL } from "../events.config.js";

const RECONNECT_DELAY_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30000;

type ActiveClient = { streamKey: string; send: (data: string) => Promise<void> };
const activeClients = new Set<ActiveClient>();
let notificationEngineStarted = false;

function broadcast(payload: string) {
    let streamKey: string | undefined;
    try {
        const parsed = JSON.parse(payload) as { streamKey?: unknown };
        if (typeof parsed.streamKey === "string") streamKey = parsed.streamKey;
    } catch {
        return;
    }
    if (!streamKey) return;

    for (const client of activeClients) {
        if (client.streamKey !== streamKey) continue;
        client.send(payload).catch(() => activeClients.delete(client));
    }
}

function startNotificationEngine() {
    if (!DATABASE_URL) throw new Error("DATABASE_URL is required for SSE");
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
        .then(() => pgListener.query(`LISTEN "${SSE_CHANNEL}"`))
        .then(() => console.log(`SSE listener active on "${SSE_CHANNEL}"`))
        .catch(restart);
}

export function startSseNotificationEngine() {
    if (notificationEngineStarted) return;
    notificationEngineStarted = true;
    startNotificationEngine();
}

export const streamEventsHandler = (c: Context) => {
    const streamKey = c.req.param("streamKey") || c.req.query("streamKey") || "triage";
    return streamSSE(c, async (stream) => {
        const sendEvent = async (data: string) => {
            await stream.writeSSE({
                data,
                event: 'db-update',
            });
        };

        const client = { streamKey, send: sendEvent };
        activeClients.add(client);
        console.log(`Client connected. Total: ${activeClients.size}`);

        stream.onAbort(() => {
            activeClients.delete(client);
            console.log(`Client disconnected. Total: ${activeClients.size}`);
        });

        while (!stream.aborted) {
            await stream.sleep(HEARTBEAT_INTERVAL_MS);
            if (stream.aborted) break;
            await stream.write(': heartbeat\n\n');
        }
    });
}
