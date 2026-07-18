import { describe, it, expect } from "vitest";
import { PgVectorRetriever, validateSqlIdentifier } from "../src/pgvector-retriever.js";
import type { Embedder } from "../src/types.js";
import type { Pool } from "pg";

const stubEmbedder: Embedder = {
  dimensions: 4,
  async embed(texts: string[]) {
    return texts.map(() => [0.1, 0.2, 0.3, 0.4]);
  },
};

const stubPool = {
  query: async () => ({ rows: [], rowCount: 0 }),
} as unknown as Pool;

describe("validateSqlIdentifier", () => {
  it("accepts valid identifiers", () => {
    expect(validateSqlIdentifier("document_chunks", "table")).toBe("document_chunks");
    expect(validateSqlIdentifier("_private", "col")).toBe("_private");
    expect(validateSqlIdentifier("Col123", "col")).toBe("Col123");
  });

  it("rejects identifiers containing SQL injection payloads", () => {
    expect(() => validateSqlIdentifier("documents; DROP TABLE users--", "table")).toThrow(
      "Invalid SQL identifier",
    );
  });

  it("rejects identifiers starting with a digit", () => {
    expect(() => validateSqlIdentifier("1table", "table")).toThrow("Invalid SQL identifier");
  });

  it("rejects identifiers with spaces", () => {
    expect(() => validateSqlIdentifier("my table", "table")).toThrow("Invalid SQL identifier");
  });

  it("rejects identifiers with special characters", () => {
    expect(() => validateSqlIdentifier("table$name", "table")).toThrow("Invalid SQL identifier");
    expect(() => validateSqlIdentifier("name.space", "col")).toThrow("Invalid SQL identifier");
  });

  it("rejects empty string", () => {
    expect(() => validateSqlIdentifier("", "table")).toThrow("Invalid SQL identifier");
  });
});

describe("PgVectorRetriever", () => {
  it("rejects malicious table name at construction time", () => {
    expect(
      () =>
        new PgVectorRetriever({
          pool: stubPool,
          embedder: stubEmbedder,
          table: "chunks; DROP TABLE users --",
        }),
    ).toThrow("Invalid SQL identifier");
  });

  it("rejects malicious column names at construction time", () => {
    expect(
      () =>
        new PgVectorRetriever({
          pool: stubPool,
          embedder: stubEmbedder,
          embeddingColumn: "col\" OR 1=1 --",
        }),
    ).toThrow("Invalid SQL identifier");
  });

  it("constructs successfully with valid identifiers", () => {
    const retriever = new PgVectorRetriever({
      pool: stubPool,
      embedder: stubEmbedder,
      table: "my_docs",
      embeddingColumn: "vec",
      contentColumn: "body",
      namespaceColumn: "ns",
    });
    expect(retriever).toBeInstanceOf(PgVectorRetriever);
  });
});
