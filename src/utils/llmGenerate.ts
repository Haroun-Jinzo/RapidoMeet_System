import { GoogleGenerativeAI } from "@google/generative-ai";
import { OpenAI } from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GEMINI_CONFIG } from "../config/services";

export type LlmProvider = "openai" | "anthropic" | "claude" | "gemini" | string;

/**
 * Shared multi-provider text generation (JSON-oriented system+user prompts).
 * Used by intent router; extract.ts can migrate gradually.
 */
export async function generateLlmText(options: {
  provider: LlmProvider;
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const {
    provider,
    apiKey,
    systemPrompt,
    userPrompt,
    temperature = 0,
    maxTokens = 2048,
  } = options;

  if (provider === "openai") {
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature,
      max_tokens: maxTokens,
    });
    return response.choices[0].message.content || "{}";
  }

  if (provider === "anthropic" || provider === "claude") {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      temperature,
      max_tokens: maxTokens,
    });
    const block = response.content[0];
    return block && "text" in block ? block.text : "{}";
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_CONFIG.model,
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: "application/json",
      temperature,
      maxOutputTokens: maxTokens,
    },
  });
  const result = await model.generateContent(userPrompt);
  return result.response.text();
}
