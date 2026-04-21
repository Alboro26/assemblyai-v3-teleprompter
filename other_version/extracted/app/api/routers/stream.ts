import { Hono } from "hono";
import { OpenAI } from "openai";

const ANSWER_SYSTEM_PROMPT = `You are a helpful interview copilot. Provide concise, professional answers that sound natural when spoken aloud. Keep answers to 2-4 sentences unless asked for detail. Use clear, confident language. Structure responses with key points. The candidate is in a live interview — answers must be immediately usable and sound like natural speech. Avoid overly formal language.`;

const app = new Hono();

app.post("/", async (c) => {
  const body = await c.req.json<{
    transcriptText: string;
    context?: string;
    apiKey?: string;
  }>();

  const { transcriptText, context, apiKey } = body;

  const client = apiKey
    ? new OpenAI({ apiKey })
    : new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: ANSWER_SYSTEM_PROMPT },
  ];

  if (context) {
    messages.push({ role: "user", content: `Previous context: ${context}` });
  }

  messages.push({
    role: "user",
    content: `The interviewer asked: "${transcriptText}". Provide a concise, natural-sounding answer.`,
  });

  const stream = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    stream: true,
    temperature: 0.7,
    max_tokens: 500,
  });

  // Return SSE stream
  return new Response(
    new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const data = JSON.stringify(chunk);
            controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
          }
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    }),
    {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    }
  );
});

export default app;
