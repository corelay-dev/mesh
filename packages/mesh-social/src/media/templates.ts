export interface TemplateLayer {
  type: "text" | "image" | "shape";
  x: number;
  y: number;
  width?: number;
  height?: number;
  content?: string;
  fontSize?: number;
  color?: string;
  src?: string;
  shape?: "rect" | "circle";
  fill?: string;
}

export interface Template {
  name: string;
  width: number;
  height: number;
  layers: TemplateLayer[];
}

const PREDEFINED_TEMPLATES: Template[] = [
  {
    name: "quote-card",
    width: 1080,
    height: 1080,
    layers: [
      { type: "shape", x: 0, y: 0, width: 1080, height: 1080, shape: "rect", fill: "#1a1a2e" },
      { type: "text", x: 100, y: 400, content: "{{quote}}", fontSize: 48, color: "#ffffff" },
      { type: "text", x: 100, y: 900, content: "— {{author}}", fontSize: 24, color: "#cccccc" },
    ],
  },
  {
    name: "policy-infographic",
    width: 1080,
    height: 1350,
    layers: [
      { type: "shape", x: 0, y: 0, width: 1080, height: 1350, shape: "rect", fill: "#0f3460" },
      { type: "text", x: 100, y: 100, content: "{{title}}", fontSize: 56, color: "#ffffff" },
      { type: "text", x: 100, y: 300, content: "{{body}}", fontSize: 32, color: "#e0e0e0" },
    ],
  },
  {
    name: "event-flyer",
    width: 1080,
    height: 1920,
    layers: [
      { type: "shape", x: 0, y: 0, width: 1080, height: 1920, shape: "rect", fill: "#16213e" },
      { type: "text", x: 100, y: 200, content: "{{eventName}}", fontSize: 64, color: "#ffffff" },
      { type: "text", x: 100, y: 400, content: "{{date}}", fontSize: 36, color: "#e94560" },
      { type: "text", x: 100, y: 500, content: "{{venue}}", fontSize: 32, color: "#cccccc" },
    ],
  },
];

export class TemplateEngine {
  private templates = new Map<string, Template>();

  constructor() {
    for (const t of PREDEFINED_TEMPLATES) {
      this.templates.set(t.name, t);
    }
  }

  register(name: string, template: Template): void {
    this.templates.set(name, template);
  }

  render(name: string, data: Record<string, string>): Template {
    const template = this.templates.get(name);
    if (!template) throw new Error(`Template not found: ${name}`);

    const rendered: Template = {
      ...template,
      layers: template.layers.map((layer) => ({
        ...layer,
        content: layer.content
          ? layer.content.replace(/\{\{(\w+)\}\}/g, (_, key: string) => data[key] ?? "")
          : layer.content,
      })),
    };

    return rendered;
  }
}
