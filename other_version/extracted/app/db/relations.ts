import { relations } from "drizzle-orm";
import { sessions, transcripts, responses } from "./schema";

export const sessionsRelations = relations(sessions, ({ many }) => ({
  transcripts: many(transcripts),
  responses: many(responses),
}));

export const transcriptsRelations = relations(transcripts, ({ one }) => ({
  session: one(sessions, {
    fields: [transcripts.sessionId],
    references: [sessions.id],
  }),
}));

export const responsesRelations = relations(responses, ({ one }) => ({
  session: one(sessions, {
    fields: [responses.sessionId],
    references: [sessions.id],
  }),
  triggerTranscript: one(transcripts, {
    fields: [responses.triggerTranscriptId],
    references: [transcripts.id],
  }),
}));
