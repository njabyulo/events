import 'dotenv/config';

export const DATABASE_URL = process.env.DATABASE_URL;
export const EVENTS_CHANNEL = process.env.EVENTS_CHANNEL || 'my_channel';

if (!/^[a-z_][a-z0-9_$]*$/i.test(EVENTS_CHANNEL)) {
    throw new Error('EVENTS_CHANNEL must be a valid PostgreSQL identifier');
}
