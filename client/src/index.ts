
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.PORT ?? 3001);
const API_URL = process.env.API_URL ?? "http://api:3000";
const STATE_FILE =
  process.env.STATE_FILE ?? "/app/data/demo-state.json";

interface Plan {
  id: string;
  name: string;
  planType: "ACCOUNT" | "USER";
}

interface DemoState {
  accountId: string;
  apiKey: string;
  basicUserId: string;
  premiumUserId: string;
  accountPlanId: string;
}

interface ApiResult {
  status: number;
  data: any;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function apiRequest(
  method: string,
  path: string,
  body?: object,
  apiKey?: string
): Promise<ApiResult> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(apiKey ? { "X-API-Key": apiKey } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(10000),
  });

  const data: any = await response.json();

  return {
    status: response.status,
    data,
  };
}

async function requireSuccess(
  method: string,
  path: string,
  body?: object,
  apiKey?: string
): Promise<any> {
  const result = await apiRequest(method, path, body, apiKey);

  if (result.status < 200 || result.status >= 300) {
    throw new Error(
      `API ${method} ${path} failed: ${result.status} ${JSON.stringify(result.data)}`
    );
  }

  return result.data;
}

async function waitForApi(): Promise<void> {
  for (let attempt = 1; attempt <= 30; attempt++) {
    try {
      const result = await apiRequest("GET", "/health");

      if (result.status === 200) {
        return;
      }
    } catch {
      // The API may still be starting.
    }

    console.log(`Waiting for API (${attempt}/30)...`);
    await sleep(2000);
  }

  throw new Error("Quota API did not become healthy");
}

function loadState(): DemoState | null {
  if (!existsSync(STATE_FILE)) {
    return null;
  }

  const parsed = JSON.parse(
    readFileSync(STATE_FILE, "utf8")
  ) as DemoState;

  if (
    !parsed.accountId ||
    !parsed.apiKey ||
    !parsed.basicUserId ||
    !parsed.premiumUserId ||
    !parsed.accountPlanId
  ) {
    throw new Error("Invalid saved demo state");
  }

  return parsed;
}

function saveState(state: DemoState): void {
  mkdirSync(dirname(STATE_FILE), {
    recursive: true,
    mode: 0o700,
  });

  writeFileSync(
    STATE_FILE,
    JSON.stringify(state, null, 2),
    { mode: 0o600 }
  );
}

async function bootstrap(): Promise<DemoState> {
  const existing = loadState();

  if (existing) {
    const check = await apiRequest(
      "GET",
      "/accounts/me",
      undefined,
      existing.apiKey
    );

    if (check.status !== 200) {
      throw new Error(
        "Saved demo account is unavailable. Check the database and demo state."
      );
    }

    console.log("Using existing demo account");
    return existing;
  }

  console.log("Creating demo account and users...");

  const plansResponse = await requireSuccess(
    "GET",
    "/plans"
  );

  const plans = plansResponse.plans as Plan[];

  const starter = plans.find(
    (plan) =>
      plan.name === "Starter" &&
      plan.planType === "ACCOUNT"
  );

  const basic = plans.find(
    (plan) =>
      plan.name === "Basic" &&
      plan.planType === "USER"
  );

  const premium = plans.find(
    (plan) =>
      plan.name === "Premium" &&
      plan.planType === "USER"
  );

  if (!starter || !basic || !premium) {
    throw new Error("Required predefined plans not found");
  }

  const account = await requireSuccess(
    "POST",
    "/accounts",
    {
      name: "Quota Demo Company",
      planId: starter.id,
    }
  );

  const apiKey = account.apiKey as string;
  const accountId = account.account.id as string;

  const basicUser = await requireSuccess(
    "POST",
    "/users",
    {
      externalUserId: "demo-basic",
      planId: basic.id,
    },
    apiKey
  );

  const premiumUser = await requireSuccess(
    "POST",
    "/users",
    {
      externalUserId: "demo-premium",
      planId: premium.id,
    },
    apiKey
  );

  const customPlan = await requireSuccess(
    "POST",
    "/plans",
    {
      name: "Demo Shared Quota",
      planType: "ACCOUNT",
      monthlyAllowance: 40,
      maxUnitsPerRequest: 100,
    },
    apiKey
  );

  const accountPlanId = customPlan.plan.id as string;

  await requireSuccess(
    "PUT",
    "/accounts/plan",
    { planId: accountPlanId },
    apiKey
  );

  const state: DemoState = {
    accountId,
    apiKey,
    basicUserId: basicUser.user.id,
    premiumUserId: premiumUser.user.id,
    accountPlanId,
  };

  saveState(state);

  console.log("Demo account initialized successfully");

  return state;
}

function sendJson(
  res: ServerResponse,
  status: number,
  data: unknown
): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });

  res.end(JSON.stringify(data));
}

async function readBody(
  req: IncomingMessage
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk);

    size += buffer.length;

    if (size > 4096) {
      throw new Error("Request body too large");
    }

    chunks.push(buffer);
  }

  const raw = Buffer.concat(chunks).toString("utf8");

  return raw ? JSON.parse(raw) : {};
}

async function getDashboard(
  state: DemoState
): Promise<object> {
  const key = state.apiKey;

  const [
    account,
    accountUsage,
    basicUser,
    premiumUser,
    basicUsage,
    premiumUsage,
  ] = await Promise.all([
    requireSuccess("GET", "/accounts/me", undefined, key),
    requireSuccess("GET", "/usage/account", undefined, key),
    requireSuccess(
      "GET",
      `/users/${state.basicUserId}`,
      undefined,
      key
    ),
    requireSuccess(
      "GET",
      `/users/${state.premiumUserId}`,
      undefined,
      key
    ),
    requireSuccess(
      "GET",
      `/usage/users/${state.basicUserId}`,
      undefined,
      key
    ),
    requireSuccess(
      "GET",
      `/usage/users/${state.premiumUserId}`,
      undefined,
      key
    ),
  ]);

  return {
    account: account.account,
    accountUsage: accountUsage.account.usage,
    month: accountUsage.month,
    users: [
      {
        ...basicUser.user,
        usage: basicUsage.user.usage,
      },
      {
        ...premiumUser.user,
        usage: premiumUsage.user.usage,
      },
    ],
  };
}

async function handleAction(
  action: string,
  state: DemoState
): Promise<ApiResult> {
  if (action === "upgrade-account") {
    return apiRequest(
      "PATCH",
      `/plans/${state.accountPlanId}`,
      {
        monthlyAllowance: 100,
        maxUnitsPerRequest: 100,
      },
      state.apiKey
    );
  }

  const actions: Record<
    string,
    { userId: string; units: number }
  > = {
    "basic-accepted": {
      userId: state.basicUserId,
      units: 10,
    },
    "basic-user-rejection": {
      userId: state.basicUserId,
      units: 25,
    },
    "premium-account-rejection": {
      userId: state.premiumUserId,
      units: 40,
    },
  };

  const selected = actions[action];

  if (!selected) {
    return {
      status: 404,
      data: { error: "Unknown demo action" },
    };
  }

  return apiRequest(
    "POST",
    "/consumption",
    {
      userId: selected.userId,
      units: selected.units,
      requestId: randomUUID(),
    },
    state.apiKey
  );
}

async function start(): Promise<void> {
  await waitForApi();

  const state = await bootstrap();

  const html = readFileSync(
    join(__dirname, "../public/index.html"),
    "utf8"
  );

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(
        req.url ?? "/",
        `http://localhost:${PORT}`
      );

      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });

        res.end(html);
        return;
      }

      if (
        req.method === "GET" &&
        url.pathname === "/api/state"
      ) {
        const data = await getDashboard(state);
        sendJson(res, 200, data);
        return;
      }

      if (
        req.method === "POST" &&
        url.pathname.startsWith("/api/actions/")
      ) {
        // The demo action is determined by its URL.
        // Do not forward arbitrary requests to the backend.
        await readBody(req);

        const action = url.pathname.slice(
          "/api/actions/".length
        );

        const result = await handleAction(action, state);

        sendJson(res, result.status, result.data);
        return;
      }

      sendJson(res, 404, {
        error: "Endpoint not found",
      });
    } catch (error) {
      console.error("Client error:", error);

      sendJson(res, 500, {
        error: "Demo client request failed",
      });
    }
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`Demo client running on port ${PORT}`);
  });
}

start().catch((error) => {
  console.error("Failed to start demo client:", error);
  process.exitCode = 1;
});
