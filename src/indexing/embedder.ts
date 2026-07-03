import { config } from "../core/config.js";

async function embedRequest(input: string | string[]): Promise<number[][]> {
  const response = await fetch(`${config.ollama.baseUrl}/api/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.ollama.embedding,
      input,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama embed error: ${response.status} ${await response.text()}`);
  }

  const json = (await response.json()) as { embeddings: number[][] };
  return json.embeddings;
}

export async function embed(text: string): Promise<number[]> {
  const [vector] = await embedRequest(text);
  return vector;
}

export async function embedBatch(
  texts: string[],
  batchSize = 8,
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const vectors: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchVectors = await embedRequest(batch);
    vectors.push(...batchVectors);
    onProgress?.(Math.min(i + batch.length, texts.length), texts.length);
  }

  return vectors;
}
