import { authRouter } from "./auth-router";
import { createRouter, publicQuery } from "./middleware";
import { sessionRouter } from "./routers/session";
import { transcriptRouter } from "./routers/transcript";
import { aiRouter } from "./routers/ai";
import { voiceRouter } from "./routers/voice";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  session: sessionRouter,
  transcript: transcriptRouter,
  ai: aiRouter,
  voice: voiceRouter,
});

export type AppRouter = typeof appRouter;
