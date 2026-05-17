export interface Segment {
  id: string;
  name: string;
  campaignId: string;
  supporterIds: string[];
  size: number;
}

export interface Supporter {
  id: string;
  ward?: string;
}

export function createSegments(supporters: Supporter[], count: number): Segment[] {
  const shuffled = [...supporters].sort(() => Math.random() - 0.5);
  const segmentSize = Math.ceil(shuffled.length / count);
  const segments: Segment[] = [];

  for (let i = 0; i < count; i++) {
    const slice = shuffled.slice(i * segmentSize, (i + 1) * segmentSize);
    segments.push({
      id: crypto.randomUUID(),
      name: `Segment ${i + 1}`,
      campaignId: "",
      supporterIds: slice.map((s) => s.id),
      size: slice.length,
    });
  }

  return segments;
}

export function createSegmentByWard(supporters: Supporter[], ward: string): Segment {
  const filtered = supporters.filter((s) => s.ward === ward);
  return {
    id: crypto.randomUUID(),
    name: `Ward: ${ward}`,
    campaignId: "",
    supporterIds: filtered.map((s) => s.id),
    size: filtered.length,
  };
}
