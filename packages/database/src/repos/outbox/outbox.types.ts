export type ClaimedOutboxEvent = {
  eventId: string;
  leaseToken: string;
  attempts: number;
};
