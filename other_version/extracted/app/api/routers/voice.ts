import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { voiceProfiles } from "@db/schema";
import { eq } from "drizzle-orm";

export const voiceRouter = createRouter({
  saveProfile: publicQuery
    .input(
      z.object({
        features: z.object({
          pitchAvg: z.number(),
          pitchStd: z.number(),
          energyAvg: z.number(),
          energyStd: z.number(),
          rate: z.number(),
        }),
        sampleDuration: z.number(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = getDb();
      const userId = ctx.user?.unionId ?? "guest";

      await db
        .insert(voiceProfiles)
        .values({
          userId,
          features: input.features,
          sampleDuration: input.sampleDuration,
        })
        .onDuplicateKeyUpdate({
          set: {
            features: input.features,
            sampleDuration: input.sampleDuration,
            updatedAt: new Date(),
          },
        });

      const profile = await db.query.voiceProfiles.findFirst({
        where: eq(voiceProfiles.userId, userId),
      });
      return profile;
    }),

  getProfile: publicQuery.query(async ({ ctx }) => {
    const db = getDb();
    const userId = ctx.user?.unionId ?? "guest";
    return (
      (await db.query.voiceProfiles.findFirst({
        where: eq(voiceProfiles.userId, userId),
      })) ?? null
    );
  }),

  compare: publicQuery
    .input(
      z.object({
        features: z.object({
          pitchAvg: z.number(),
          energyAvg: z.number(),
          rate: z.number(),
        }),
      })
    )
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const userId = ctx.user?.unionId ?? "guest";
      const profile = await db.query.voiceProfiles.findFirst({
        where: eq(voiceProfiles.userId, userId),
      });

      if (!profile) {
        return { score: 0, isMatch: false };
      }

      const stored = profile.features;
      const incoming = input.features;

      // Weighted Euclidean distance
      const weights = { pitch: 0.4, energy: 0.35, rate: 0.25 };
      const distance = Math.sqrt(
        weights.pitch * Math.pow((incoming.pitchAvg - stored.pitchAvg) / (stored.pitchStd || 1), 2) +
          weights.energy * Math.pow(incoming.energyAvg - stored.energyAvg, 2) * 100 +
          weights.rate * Math.pow(incoming.rate - stored.rate, 2) * 10
      );

      const score = Math.max(0, Math.min(1, 1 / (1 + distance)));
      return { score, isMatch: score > 0.7 };
    }),
});
