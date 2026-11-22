import OpenAI from 'openai';

// gpt-4 was shut down on 2026-10-23. OpenAI's listed replacement is gpt-5.6-sol.
// Override with OPENAI_CHAT_MODEL (e.g. gpt-5.6-terra for lower cost and latency).
export const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL || 'gpt-5.6-sol';

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

/**
 * One system + user turn, returning the answer text.
 *
 * Calls the OpenAI SDK directly instead of LangChain's ChatOpenAI: LangChain 0.3.x
 * always sends sampling params (temperature, top_p, ...) that GPT-5.x models may
 * reject. reasoning_effort "none" keeps latency and cost close to a plain chat model.
 */
export async function generateAnswer(system: string, user: string): Promise<string> {
  const res = await getClient().chat.completions.create({
    model: CHAT_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    // 'none' is newer than this SDK's type definitions
    reasoning_effort: (process.env.OPENAI_REASONING_EFFORT || 'none') as any,
  });
  return res.choices[0]?.message?.content?.trim() ?? '';
}
