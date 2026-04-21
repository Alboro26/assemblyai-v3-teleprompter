import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { sessions } from "@db/schema";
import { eq, desc } from "drizzle-orm";

export const sessionRouter = createRouter({
  create: publicQuery
    .input(
      z.object({
        mode: z.enum(["voice", "coding"]).default("voice"),
        aiModel: z.string().default("gpt-4o"),
        settings: z
          .object({
            fontSize: z.number().default(28),
            scrollSpeed: z.number().default(120),
            language: z.string().default("en"),
          })
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const [session] = await db.insert(sessions).values({
        mode: input.mode,
        aiModel: input.aiModel,
        settings: input.settings,
      });
      return { id: Number(session.insertId), ...input, status: "active" as const, createdAt: new Date() };
    }),

  get: publicQuery
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = getDb();
      const session = await db.query.sessions.findFirst({
        where: eq(sessions.id, input.id),
        with: {
          transcripts: true,
          responses: true,
        },
      });
      return session ?? null;
    }),

  update: publicQuery
    .input(
      z.object({
        id: z.number(),
        status: z.enum(["active", "paused", "completed"]).optional(),
        settings: z
          .object({
            fontSize: z.number(),
            scrollSpeed: z.number(),
            language: z.string(),
          })
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDb();
      const { id, ...updates } = input;
      await db.update(sessions).set(updates).where(eq(sessions.id, id));
      const updated = await db.query.sessions.findFirst({
        where: eq(sessions.id, id),
      });
      return updated;
    }),

  end: publicQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = getDb();
      await db
        .update(sessions)
        .set({ status: "completed", endedAt: new Date() })
        .where(eq(sessions.id, input.id));
      const updated = await db.query.sessions.findFirst({
        where: eq(sessions.id, input.id),
      });
      return updated;
    }),

  list: publicQuery
    .input(
      z
        .object({
          limit: z.number().default(20),
          offset: z.number().default(0),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = getDb();
      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;
      return db.query.sessions.findMany({
        orderBy: [desc(sessions.createdAt)],
        limit,
        offset,
      });
    }),
});
