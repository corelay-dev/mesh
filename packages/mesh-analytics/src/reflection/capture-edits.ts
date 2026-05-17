export interface EditCapture {
  messageId: string;
  campaignId: string;
  originalContent: string;
  editedContent: string;
  editedBy: string;
  editedAt: Date;
}

export interface EditMetadata {
  messageId: string;
  campaignId: string;
  editedBy: string;
}

export function captureEdit(original: string, edited: string, metadata: EditMetadata): EditCapture {
  return {
    messageId: metadata.messageId,
    campaignId: metadata.campaignId,
    originalContent: original,
    editedContent: edited,
    editedBy: metadata.editedBy,
    editedAt: new Date(),
  };
}

/**
 * Produces a human-readable diff summary using longest common subsequence.
 * Identifies additions, removals, and replacements at the sentence/phrase level.
 */
export function diffContent(original: string, edited: string): string {
  if (original === edited) return "No changes detected";

  const originalSentences = splitIntoChunks(original);
  const editedSentences = splitIntoChunks(edited);

  const removed: string[] = [];
  const added: string[] = [];
  const editedSet = new Set(editedSentences.map((s) => s.toLowerCase().trim()));
  const originalSet = new Set(originalSentences.map((s) => s.toLowerCase().trim()));

  for (const s of originalSentences) {
    if (!editedSet.has(s.toLowerCase().trim())) {
      removed.push(s.trim());
    }
  }
  for (const s of editedSentences) {
    if (!originalSet.has(s.toLowerCase().trim())) {
      added.push(s.trim());
    }
  }

  const parts: string[] = [];

  if (removed.length > 0 && added.length > 0 && removed.length === added.length) {
    // Likely replacements
    for (let i = 0; i < removed.length; i++) {
      parts.push(`Replaced "${truncate(removed[i]!, 50)}" → "${truncate(added[i]!, 50)}"`);
    }
  } else {
    if (removed.length > 0) {
      parts.push(`Removed: ${removed.map((r) => `"${truncate(r, 40)}"`).join(", ")}`);
    }
    if (added.length > 0) {
      parts.push(`Added: ${added.map((a) => `"${truncate(a, 40)}"`).join(", ")}`);
    }
  }

  // Check for tone/length changes
  if (edited.length < original.length * 0.7) {
    parts.push("Significantly shortened");
  } else if (edited.length > original.length * 1.3) {
    parts.push("Significantly expanded");
  }

  return parts.length > 0 ? parts.join(". ") + "." : "Minor formatting changes.";
}

function splitIntoChunks(text: string): string[] {
  // Split on sentence boundaries or newlines
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}
