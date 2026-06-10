import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createCheckinGate } from "../src/checkin-gate.js";

function makeApp(token: string | null) {
  const app = new Hono();
  app.use("/api/checkin/*", createCheckinGate(token));
  app.post("/api/checkin/scan", (c) => c.json({ status: "VALID" }, 200));
  app.get("/api/checkin/history", (c) => c.json([], 200));
  app.get("/t/:tok", (c) => c.json({ public: true }, 200));
  return app;
}

const CORRECT_TOKEN = "test-operator-token-abc123";

describe("createCheckinGate — unconfigured (null token)", () => {
  const app = makeApp(null);

  it("scan returns 503 when token not configured", async () => {
    const res = await app.request("/api/checkin/scan", { method: "POST" });
    expect(res.status).toBe(503);
  });

  it("history returns 503 when token not configured", async () => {
    const res = await app.request("/api/checkin/history");
    expect(res.status).toBe(503);
  });
});

describe("createCheckinGate — no Authorization header", () => {
  const app = makeApp(CORRECT_TOKEN);

  it("scan returns 401", async () => {
    const res = await app.request("/api/checkin/scan", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("history returns 401", async () => {
    const res = await app.request("/api/checkin/history");
    expect(res.status).toBe(401);
  });
});

describe("createCheckinGate — wrong Bearer token", () => {
  const app = makeApp(CORRECT_TOKEN);

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

describe("createCheckinGate — correct Bearer token", () => {
  const app = makeApp(CORRECT_TOKEN);

  it("scan passes through with correct token", async () => {
    const res = await app.request("/api/checkin/scan", {
      method: "POST",
      headers: { Authorization: `Bearer ${CORRECT_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ scanned: "x", eventId: "y" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json() as { status: string };
    expect(json.status).toBe("VALID");
  });

  it("history passes through with correct token", async () => {
    const res = await app.request("/api/checkin/history", {
      headers: { Authorization: `Bearer ${CORRECT_TOKEN}` },
    });
    expect(res.status).toBe(200);
  });
});

describe("createCheckinGate — public routes unaffected", () => {
  const app = makeApp(CORRECT_TOKEN);

  it("GET /t/:token is public — no auth needed", async () => {
    const res = await app.request("/t/some-token-abc");
    expect(res.status).toBe(200);
    const json = await res.json() as { public: boolean };
    expect(json.public).toBe(true);
  });
});

describe("createCheckinGate — malformed Authorization", () => {
  const app = makeApp(CORRECT_TOKEN);

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
