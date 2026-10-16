
import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const BASE_URL =
  process.env.TEST_API_URL ?? "http://localhost:3000";

async function api(
  method: string,
  path: string,
  body?: object,
  apiKey?: string
) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body
        ? { "Content-Type": "application/json" }
        : {}),
      ...(apiKey
        ? { "X-API-Key": apiKey }
        : {}),
    },
    ...(body
      ? { body: JSON.stringify(body) }
      : {}),
  });

  return {
    status: response.status,
    data: await response.json() as any,
  };
}

it("replays identical UUIDs regardless of letter case", async () => {
  const plans = await api("GET", "/plans");

  expect(plans.status).toBe(200);

  const starter = plans.data.plans.find(
    (p: any) =>
      p.name === "Starter" &&
      p.planType === "ACCOUNT"
  );

  const basic = plans.data.plans.find(
    (p: any) =>
      p.name === "Basic" &&
      p.planType === "USER"
  );

  expect(starter).toBeDefined();
  expect(basic).toBeDefined();

  const account = await api("POST", "/accounts", {
    name: `UUID Test ${randomUUID()}`,
    planId: starter.id,
  });

  expect(account.status).toBe(201);

  const apiKey = account.data.apiKey;

  const user = await api(
    "POST",
    "/users",
    {
      externalUserId: `uuid-test-${randomUUID()}`,
      planId: basic.id,
    },
    apiKey
  );

  expect(user.status).toBe(201);

  const userId = user.data.user.id as string;
  const requestId = randomUUID();

  // First consumption request
  const first = await api(
    "POST",
    "/consumption",
    {
      userId,
      units: 10,
      requestId,
    },
    apiKey
  );

  expect(first.status).toBe(200);
  expect(first.data.accepted).toBe(true);
  expect(first.data.replayed).toBe(false);

  // Same requestId, with uppercase userId
  const replay = await api(
    "POST",
    "/consumption",
    {
      userId: userId.toUpperCase(),
      units: 10,
      requestId,
    },
    apiKey
  );

  expect(replay.status).toBe(200);
  expect(replay.data.accepted).toBe(true);
  expect(replay.data.replayed).toBe(true);

  // Verify that usage was counted only once
  const usage = await api(
    "GET",
    "/usage/account",
    undefined,
    apiKey
  );

  expect(usage.status).toBe(200);
  expect(usage.data.account.usage.consumed).toBe("10");
});
