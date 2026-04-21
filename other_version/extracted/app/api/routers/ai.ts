import { z } from "zod";
import { createRouter, publicQuery } from "../middleware";
import { getDb } from "../queries/connection";
import { responses } from "@db/schema";
import { OpenAI } from "openai";
import { observable } from "@trpc/server/observable";
import { TRPCError } from "@trpc/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

const ANSWER_SYSTEM_PROMPT = `You are a helpful interview copilot. Provide concise, professional answers that sound natural when spoken aloud. Keep answers to 2-4 sentences unless asked for detail. Use clear, confident language. Structure responses with key points. The candidate is in a live interview — answers must be immediately usable and sound like natural speech. Avoid overly formal language. Use bullet points for multi-part answers.`;

const CODE_SYSTEM_PROMPT = `You are a coding interview assistant. Analyze the coding challenge and provide a clean, efficient solution. Respond in this exact format:

\`\`\`[language]
[code]
\`\`\`

**Explanation:** [explanation]

**Time Complexity:** O(...)
**Space Complexity:** O(...)`;

export const aiRouter = createRouter({
  generateAnswer: publicQuery
    .input(
      z.object({
        sessionId: z.number(),
        transcriptText: z.string(),
        context: z.string().optional(),
        apiKey: z.string().optional(),
      })
    )
    .subscription(async ({ input }) => {
      return observable<string>((emit) => {
        const client = input.apiKey
          ? new OpenAI({ apiKey: input.apiKey })
          : openai;

        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
          { role: "system", content: ANSWER_SYSTEM_PROMPT },
        ];

        if (input.context) {
          messages.push({
            role: "user",
            content: `Previous context: ${input.context}`,
          });
        }

        messages.push({
          role: "user",
          content: `The interviewer asked: "${input.transcriptText}". Provide a concise, natural-sounding answer.`,
        });

        let fullResponse = "";

        client.chat.completions
          .create({
            model: "gpt-4o-mini",
            messages,
            stream: true,
            temperature: 0.7,
            max_tokens: 500,
          })
          .then(async (stream) => {
            for await (const chunk of stream) {
              const content = chunk.choices[0]?.delta?.content;
              if (content) {
                fullResponse += content;
                emit.next(content);
              }
            }
            emit.complete();

            // Store response in background
            try {
              const db = getDb();
              await db.insert(responses).values({
                sessionId: input.sessionId,
                content: fullResponse,
                mode: "voice_answer",
                metadata: { model: "gpt-4o-mini" },
              });
            } catch {
              // Non-critical: don't fail if storage fails
            }
          })
          .catch((error) => {
            emit.error(
              new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: error.message || "AI generation failed",
              })
            );
          });

        return () => {
          // Cleanup if needed
        };
      });
    }),

  generateCodeSolution: publicQuery
    .input(
      z.object({
        sessionId: z.number(),
        codeText: z.string(),
        language: z.string().optional(),
        apiKey: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const client = input.apiKey
        ? new OpenAI({ apiKey: input.apiKey })
        : openai;

      const startTime = Date.now();

      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: CODE_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Solve this coding challenge:\n\n${input.codeText}${
              input.language ? `\n\nLanguage: ${input.language}` : ""
            }`,
          },
        ],
        temperature: 0.5,
        max_tokens: 2000,
      });

      const content = completion.choices[0]?.message?.content || "";
      const latencyMs = Date.now() - startTime;

      // Parse code and explanation
      const codeMatch = content.match(/```(?:\w+)?\n([\s\S]*?)\n```/);
      const explanationMatch = content.match(/\*\*Explanation:\*\*\s*(.+?)(?=\*\*Time Complexity|\Z)/s);
      const timeComplexityMatch = content.match(/\*\*Time Complexity:\*\*\s*(O\([^)]+\))/);
      const spaceComplexityMatch = content.match(/\*\*Space Complexity:\*\*\s*(O\([^)]+\))/);

      const result = {
        code: codeMatch ? codeMatch[1].trim() : content,
        explanation: explanationMatch
          ? explanationMatch[1].trim()
          : "",
        complexity: {
          time: timeComplexityMatch ? timeComplexityMatch[1] : "Unknown",
          space: spaceComplexityMatch ? spaceComplexityMatch[1] : "Unknown",
        },
        raw: content,
      };

      // Store response
      try {
        const db = getDb();
        await db.insert(responses).values({
          sessionId: input.sessionId,
          content: content,
          mode: "code_solution",
          metadata: {
            model: "gpt-4o-mini",
            latencyMs,
            tokensUsed: completion.usage?.total_tokens,
          },
        });
      } catch {
        // Non-critical
      }

      return result;
    }),
});
