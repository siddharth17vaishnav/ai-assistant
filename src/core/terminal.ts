const RESET = "\x1b[0m";

export const colors = {
  green: (text: string) => `\x1b[32m${text}${RESET}`,
  greenPrompt: "\x1b[32m",
  reset: RESET,
};

export const USER_PROMPT = `${colors.greenPrompt}You: `;
