export interface ImageGeneratorConfig {
  provider: "dalle" | "stability" | "local";
  apiKey?: string;
}

export interface GenerateOptions {
  width?: number;
  height?: number;
  style?: string;
}

export class ImageGenerator {
  private config: ImageGeneratorConfig;

  constructor(config: ImageGeneratorConfig) {
    this.config = config;
  }

  async generate(prompt: string, options?: GenerateOptions): Promise<Buffer> {
    switch (this.config.provider) {
      case "dalle":
        return this.generateDalle(prompt, options);
      case "stability":
        return this.generateStability(prompt, options);
      case "local":
        return this.generateLocal(prompt, options);
      default:
        throw new Error(`Unknown provider: ${this.config.provider}`);
    }
  }

  private async generateDalle(prompt: string, options?: GenerateOptions): Promise<Buffer> {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        size: `${options?.width ?? 1024}x${options?.height ?? 1024}`,
        response_format: "b64_json",
      }),
    });
    if (!res.ok) throw new Error(`DALL-E generation failed: ${res.status}`);
    const data = (await res.json()) as { data: Array<{ b64_json: string }> };
    return Buffer.from(data.data[0]!.b64_json, "base64");
  }

  private async generateStability(prompt: string, options?: GenerateOptions): Promise<Buffer> {
    const res = await fetch(
      "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text_prompts: [{ text: prompt }],
          width: options?.width ?? 1024,
          height: options?.height ?? 1024,
        }),
      },
    );
    if (!res.ok) throw new Error(`Stability generation failed: ${res.status}`);
    const data = (await res.json()) as { artifacts: Array<{ base64: string }> };
    return Buffer.from(data.artifacts[0]!.base64, "base64");
  }

  private async generateLocal(_prompt: string, options?: GenerateOptions): Promise<Buffer> {
    // Generate a placeholder image using sharp
    const sharp = (await import("sharp")).default;
    const width = options?.width ?? 1024;
    const height = options?.height ?? 1024;
    return sharp({
      create: { width, height, channels: 3, background: { r: 26, g: 26, b: 46 } },
    })
      .png()
      .toBuffer();
  }
}
