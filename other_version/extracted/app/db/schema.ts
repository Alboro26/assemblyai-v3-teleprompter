import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  bigint,
  int,
  json,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const sessions = mysqlTable("sessions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }),
  mode: mysqlEnum("mode", ["voice", "coding"]).default("voice"),
  status: mysqlEnum("status", ["active", "paused", "completed"]).default("active"),
  aiModel: varchar("ai_model", { length: 100 }).default("gpt-4o"),
  settings: json("settings").$type<{
    fontSize: number;
    scrollSpeed: number;
    language: string;
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
  endedAt: timestamp("ended_at"),
});

export type Session = typeof sessions.$inferSelect;
export type InsertSession = typeof sessions.$inferInsert;

export const transcripts = mysqlTable("transcripts", {
  id: serial("id").primaryKey(),
  sessionId: bigint("session_id", { mode: "number", unsigned: true }).references(() => sessions.id),
  speaker: mysqlEnum("speaker", ["interviewer", "candidate"]).notNull(),
  text: text("text").notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
  sequence: int("sequence").notNull(),
});

export type Transcript = typeof transcripts.$inferSelect;
export type InsertTranscript = typeof transcripts.$inferInsert;

export const voiceProfiles = mysqlTable("voice_profiles", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id", { length: 255 }).notNull().unique(),
  features: json("features").$type<{
    pitchAvg: number;
    pitchStd: number;
    energyAvg: number;
    energyStd: number;
    rate: number;
  }>().notNull(),
  sampleDuration: int("sample_duration").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type VoiceProfile = typeof voiceProfiles.$inferSelect;
export type InsertVoiceProfile = typeof voiceProfiles.$inferInsert;

export const responses = mysqlTable("responses", {
  id: serial("id").primaryKey(),
  sessionId: bigint("session_id", { mode: "number", unsigned: true }).references(() => sessions.id),
  triggerTranscriptId: bigint("trigger_transcript_id", { mode: "number", unsigned: true }).references(() => transcripts.id),
  content: text("content").notNull(),
  mode: mysqlEnum("mode", ["voice_answer", "code_solution"]).notNull(),
  metadata: json("metadata").$type<{
    tokensUsed?: number;
    model?: string;
    latencyMs?: number;
  }>(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Response = typeof responses.$inferSelect;
export type InsertResponse = typeof responses.$inferInsert;
