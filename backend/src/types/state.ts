import { MessagesAnnotation } from "@langchain/langgraph";
import { z } from "zod";

// Use MessagesAnnotation as the base and extend it
export const ResearchState = MessagesAnnotation;

// Structured output schemas
export const ClarifyWithUserSchema = z.object({
  needClarification: z
    .boolean()
    .describe("Whether the user needs to be asked a clarifying question"),
  question: z
    .string()
    .describe("A question to ask the user to clarify the report scope"),
  verification: z
    .string()
    .describe(
      "Verify message that we will start research after the user has provided the necessary information"
    ),
});

export const ResearchQuestionSchema = z.object({
  researchBrief: z
    .string()
    .describe("A research question that will be used to guide the research"),
});

export const SummarySchema = z.object({
  summary: z.string().describe("Concise summary of the webpage content"),
  keyExcerpts: z
    .string()
    .describe("Important quotes and excerpts from the content"),
});

export type ClarifyWithUser = z.infer<typeof ClarifyWithUserSchema>;
export type ResearchQuestion = z.infer<typeof ResearchQuestionSchema>;
export type Summary = z.infer<typeof SummarySchema>;
