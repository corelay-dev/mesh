export interface PostResult {
  postId: string;
  url: string;
  publishedAt: Date;
}

export interface EngagementMetrics {
  likes: number;
  shares: number;
  comments: number;
  impressions: number;
  reach: number;
}

export interface Reply {
  id: string;
  author: string;
  content: string;
  createdAt: Date;
  sentiment?: "positive" | "negative" | "neutral";
}

export interface SocialEvent {
  id: string;
  platform: string;
  type: "post" | "reply" | "mention" | "share";
  author: string;
  content: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface PlatformAdapter {
  post(content: string, media?: Buffer[]): Promise<PostResult>;
  getEngagement(postId: string): Promise<EngagementMetrics>;
  getReplies(postId: string): Promise<Reply[]>;
  monitor(keywords: string[]): AsyncIterable<SocialEvent>;
  close?(): Promise<void>;
}
