import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { transcripts } from "@db/schema";
import { eq, and, desc } from "drizzle-orm";

export const transcriptRouter = createRouter({
  create: publicQuery
    .input(
      z.object({
        sessionId: z.number(),
        speaker: z.enum(["interviewer", "candidate"]),
        text: z.string(),
        sequence: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const [transcript] = await db.insert(transcripts).values(input);
      return { id: Number(transcript.insertId), ...input };
    }),

  listBySession: publicQuery
    .input(z.object({ sessionId: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      return db.query.transcripts.findMany({
        where: eq(transcripts.sessionId, input.sessionId),
        orderBy: [transcripts.sequence],
      });
    }),

  getLatest: publicQuery
    .input(
      z.object({
        sessionId: z.number(),
        speaker: z.enum(["interviewer", "candidate"]).optional(),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [eq(transcripts.sessionId, input.sessionId)];
      if (input.speaker) {
        conditions.push(eq(transcripts.speaker, input.speaker));
      }
      const result = await db.query.transcripts.findMany({
        where: and(...conditions),
        orderBy: [desc(transcripts.sequence)],
        limit: 1,
      });
      return result[0] ?? null;
    }),
});
