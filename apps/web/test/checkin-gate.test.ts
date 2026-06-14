import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { PrismaClient } from "@prisma/client";
import { createCheckinPreAuth } from "../src/checkin-gate.js";

const mockPrisma = {} as PrismaClient;
const CORRECT_TOKEN = "test-operator-token-abc123";

function makeApp(operatorToken: string | null, allowBearer = true) {
  const app = new Hono();
  const deps = {
    prisma: mockPrisma,
    config: { allowBearer, operatorToken },
  };
  app.use("/api/checkin/*", createCheckinPreAuth(deps));
  app.post("/api/checkin/scan", (c) => c.json({ status: "VALID" }, 200));
  app.get("/api/checkin/history", (c) => c.json([], 200));
  app.get("/t/:tok", (c) => c.json({ public: true }, 200));
  return app;
}

describe("createCheckinPreAuth — bearer emergency (allowBearer=true)", () => {
  describe("null operator token", () => {
    const app = makeApp(null, true);

    it("scan returns 401 when token not configured", async () => {
      const res = await app.request("/api/checkin/scan", { method: "POST" });
      expect(res.status).toBe(401);
    });

    it("history returns 401 when token not configured", async () => {
      const res = await app.request("/api/checkin/history");
      expect(res.status).toBe(401);
    });
  });

  describe("no Authorization header", () => {
    const app = makeApp(CORRECT_TOKEN, true);

    it("scan returns 401", async () => {
      const res = await app.request("/api/checkin/scan", { method: "POST" });
      expect(res.status).toBe(401);
    });

    it("history returns 401", async () => {
      const res = await app.request("/api/checkin/history");
      expect(res.status).toBe(401);
    });
  });

  describe("wrong Bearer token", () => {
    const app = makeApp(CORRECT_TOKEN, true);

    it("scan returns 401 for wrong token", async () => {
      const res = await app.request("/api/checkin/scan", {
        method: "POST",
        headers: { Authorization: "Bearer totally-wrong-secret" },
      });
      expect(res.status).toBe(401);
    });

    it("history returns 401 for wrong token", async () => {
      const res = await app.request("/api/checkin/history", {
        headers: { Authorization: "Bearer totally-wrong-secret" },
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 (not 403 or 400) to not reveal whether token was missing or wrong", async () => {
      const res = await app.request("/api/checkin/scan", {
        method: "POST",
        headers: { Authorization: "Bearer wrong" },
      });
      expect(res.status).toBe(401);
    });
  });

  describe("correct Bearer token", () => {
    const app = makeApp(CORRECT_TOKEN, true);

    it("scan passes through with correct token", async () => {
      const res = await app.request("/api/checkin/scan", {
        method: "POST",
        headers: { Authorization: `Bearer ${CORRECT_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ scanned: "x", eventId: "y" }),
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as { status: string };
      expect(json.status).toBe("VALID");
    });

    it("history passes through with correct token", async () => {
      const res = await app.request("/api/checkin/history", {
        headers: { Authorization: `Bearer ${CORRECT_TOKEN}` },
      });
      expect(res.status).toBe(200);
    });
  });

  describe("public routes unaffected", () => {
    const app = makeApp(CORRECT_TOKEN, true);

    it("GET /t/:token is public — no auth needed", async () => {
      const res = await app.request("/t/some-token-abc");
      expect(res.status).toBe(200);
      const json = (await res.json()) as { public: boolean };
      expect(json.public).toBe(true);
    });
  });

  describe("malformed Authorization", () => {
    const app = makeApp(CORRECT_TOKEN, true);

    it("returns 401 for non-Bearer scheme", async () => {
      const res = await app.request("/api/checkin/scan", {
        method: "POST",
        headers: { Authorization: `Basic ${CORRECT_TOKEN}` },
      });
      expect(res.status).toBe(401);
    });

    it("returns 401 for empty Bearer value", async () => {
      const res = await app.request("/api/checkin/scan", {
        method: "POST",
        headers: { Authorization: "Bearer " },
      });
      expect(res.status).toBe(401);
    });
  });
});

describe("createCheckinPreAuth — session-only (allowBearer=false)", () => {
  const app = makeApp(CORRECT_TOKEN, false);

  it("ignores valid Bearer when allowBearer=false", async () => {
    const res = await app.request("/api/checkin/history", {
      headers: { Authorization: `Bearer ${CORRECT_TOKEN}` },
    });
    expect(res.status).toBe(401);
  });
});
