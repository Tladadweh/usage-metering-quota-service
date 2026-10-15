
import { Router } from "express";
import swaggerUi from "swagger-ui-express";

const security = [{ ApiKeyAuth: [] }];

const jsonBody = (schemaName: string) => ({
  required: true,
  content: {
    "application/json": {
      schema: {
        $ref: `#/components/schemas/${schemaName}`,
      },
    },
  },
});

const idParameter = {
  name: "id",
  in: "path",
  required: true,
  schema: {
    type: "string",
    format: "uuid",
  },
};

const monthParameter = {
  name: "month",
  in: "query",
  required: false,
  description: "UTC calendar month. Defaults to current UTC month.",
  schema: {
    type: "string",
    pattern: "^\\d{4}-(0[1-9]|1[0-2])$",
    example: "2026-10",
  },
};

const swaggerDocument = {
  openapi: "3.0.3",
  info: {
    title: "Usage Metering and Quota Service",
    version: "1.0.0",
    description: "Foothill backend training final project.",
  },
  servers: [{ url: "/" }],
  components: {
    securitySchemes: {
      ApiKeyAuth: {
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
      },
    },
    schemas: {
      CreateAccount: {
        type: "object",
        required: ["name", "planId"],
        properties: {
          name: {
            type: "string",
            example: "Test Company",
          },
          planId: {
            type: "string",
            format: "uuid",
          },
        },
      },
      CreateUser: {
        type: "object",
        required: ["externalUserId", "planId"],
        properties: {
          externalUserId: {
            type: "string",
            example: "user_001",
          },
          planId: {
            type: "string",
            format: "uuid",
          },
        },
      },
      CreatePlan: {
        type: "object",
        required: [
          "name",
          "planType",
          "monthlyAllowance",
          "maxUnitsPerRequest",
        ],
        properties: {
          name: {
            type: "string",
            example: "Business",
          },
          planType: {
            type: "string",
            enum: ["ACCOUNT", "USER"],
          },
          monthlyAllowance: {
            type: "integer",
            minimum: 0,
            example: 5000,
          },
          maxUnitsPerRequest: {
            type: "integer",
            minimum: 1,
            example: 50,
          },
        },
      },
      UpdatePlan: {
        type: "object",
        properties: {
          name: {
            type: "string",
            example: "Business Plus",
          },
          monthlyAllowance: {
            type: "integer",
            minimum: 0,
            example: 8000,
          },
          maxUnitsPerRequest: {
            type: "integer",
            minimum: 1,
            example: 60,
          },
        },
      },
      AssignPlan: {
        type: "object",
        required: ["planId"],
        properties: {
          planId: {
            type: "string",
            format: "uuid",
          },
        },
      },
      ConsumeUnits: {
        type: "object",
        required: ["userId", "units", "requestId"],
        properties: {
          userId: {
            type: "string",
            format: "uuid",
          },
          units: {
            type: "integer",
            minimum: 1,
            example: 10,
          },
          requestId: {
            type: "string",
            example: "consume-001",
          },
        },
      },
    },
  },
  tags: [
    { name: "Health" },
    { name: "Plans" },
    { name: "Accounts" },
    { name: "Users" },
    { name: "Consumption" },
    { name: "Usage" },
    { name: "History" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Check service health",
        responses: {
          "200": { description: "Healthy" },
          "503": { description: "Database unavailable" },
        },
      },
    },

    "/plans": {
      get: {
        tags: ["Plans"],
        summary: "List predefined plans",
        parameters: [{
          name: "type",
          in: "query",
          schema: {
            type: "string",
            enum: ["ACCOUNT", "USER"],
          },
        }],
        responses: {
          "200": { description: "Predefined plans" },
          "400": { description: "Invalid type" },
        },
      },
      post: {
        tags: ["Plans"],
        summary: "Create custom plan",
        security,
        requestBody: jsonBody("CreatePlan"),
        responses: {
          "201": { description: "Plan created" },
          "400": { description: "Invalid plan data" },
          "401": { description: "Unauthorized" },
        },
      },
    },

    "/plans/mine": {
      get: {
        tags: ["Plans"],
        summary: "List available account plans",
        security,
        responses: {
          "200": { description: "Plans returned" },
          "401": { description: "Unauthorized" },
        },
      },
    },

    "/plans/{id}": {
      patch: {
        tags: ["Plans"],
        summary: "Update owned custom plan",
        security,
        parameters: [idParameter],
        requestBody: jsonBody("UpdatePlan"),
        responses: {
          "200": { description: "Plan updated" },
          "400": { description: "Invalid input" },
          "401": { description: "Unauthorized" },
          "404": { description: "Plan not found" },
        },
      },
    },

    "/accounts": {
      post: {
        tags: ["Accounts"],
        summary: "Create account and issue API key",
        requestBody: jsonBody("CreateAccount"),
        responses: {
          "201": { description: "Account created" },
          "400": { description: "Invalid input" },
        },
      },
    },

    "/accounts/me": {
      get: {
        tags: ["Accounts"],
        summary: "Get authenticated account",
        security,
        responses: {
          "200": { description: "Account details" },
          "401": { description: "Unauthorized" },
        },
      },
    },

    "/accounts/plan": {
      put: {
        tags: ["Accounts"],
        summary: "Change account plan",
        security,
        requestBody: jsonBody("AssignPlan"),
        responses: {
          "200": { description: "Plan changed" },
          "400": { description: "Invalid plan" },
          "401": { description: "Unauthorized" },
        },
      },
    },

    "/users": {
      get: {
        tags: ["Users"],
        summary: "List account users",
        security,
        responses: {
          "200": { description: "Users returned" },
          "401": { description: "Unauthorized" },
        },
      },
      post: {
        tags: ["Users"],
        summary: "Create user",
        security,
        requestBody: jsonBody("CreateUser"),
        responses: {
          "201": { description: "User created" },
          "400": { description: "Invalid input" },
          "401": { description: "Unauthorized" },
          "409": { description: "User already exists" },
        },
      },
    },

    "/users/{id}": {
      get: {
        tags: ["Users"],
        summary: "Get user details",
        security,
        parameters: [idParameter],
        responses: {
          "200": { description: "User details" },
          "400": { description: "Invalid ID" },
          "401": { description: "Unauthorized" },
          "404": { description: "User not found" },
        },
      },
    },

    "/users/{id}/plan": {
      put: {
        tags: ["Users"],
        summary: "Change user plan",
        security,
        parameters: [idParameter],
        requestBody: jsonBody("AssignPlan"),
        responses: {
          "200": { description: "Plan changed" },
          "400": { description: "Invalid plan" },
          "401": { description: "Unauthorized" },
          "404": { description: "User not found" },
        },
      },
    },

    "/consumption": {
      post: {
        tags: ["Consumption"],
        summary: "Consume units",
        description:
          "Evaluates account and user quotas. Records accepted and rejected requests. Identical retries do not consume again.",
        security,
        requestBody: jsonBody("ConsumeUnits"),
        responses: {
          "200": { description: "Consumption decision" },
          "400": { description: "Invalid input" },
          "401": { description: "Unauthorized" },
          "404": { description: "User not found" },
          "409": { description: "Conflicting requestId" },
        },
      },
    },

    "/usage/account": {
      get: {
        tags: ["Usage"],
        summary: "Get monthly account usage",
        description:
          "Returns consumed and remaining units for the authenticated account.",
        security,
        parameters: [monthParameter],
        responses: {
          "200": { description: "Account usage" },
          "400": { description: "Invalid month" },
          "401": { description: "Unauthorized" },
        },
      },
    },

    "/usage/users/{id}": {
      get: {
        tags: ["Usage"],
        summary: "Get monthly user usage",
        description:
          "Returns consumed and remaining units for a user belonging to the authenticated account.",
        security,
        parameters: [
          idParameter,
          monthParameter,
        ],
        responses: {
          "200": { description: "User usage" },
          "400": { description: "Invalid ID or month" },
          "401": { description: "Unauthorized" },
          "404": { description: "User not found" },
        },
      },
    },

    "/history": {
      get: {
        tags: ["History"],
        summary: "Get consumption request history",
        description:
          "Returns accepted and rejected requests for a UTC month, ordered newest first, with pagination.",
        security,
        parameters: [
          monthParameter,
          {
            name: "userId",
            in: "query",
            required: false,
            schema: {
              type: "string",
              format: "uuid",
            },
            description: "Filter by a user in the account",
          },
          {
            name: "page",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 1000000,
              default: 1,
            },
          },
          {
            name: "limit",
            in: "query",
            required: false,
            schema: {
              type: "integer",
              minimum: 1,
              maximum: 100,
              default: 20,
            },
          },
        ],
        responses: {
          "200": { description: "Paginated request history" },
          "400": { description: "Invalid query parameters" },
          "401": { description: "Unauthorized" },
          "404": { description: "User not found" },
        },
      },
    },
  },
};

const swaggerRouter = Router();

swaggerRouter.get("/openapi.json", (_req, res) => {
  res.json(swaggerDocument);
});

swaggerRouter.use("/", swaggerUi.serve);
swaggerRouter.get("/", swaggerUi.setup(swaggerDocument));

export default swaggerRouter;
