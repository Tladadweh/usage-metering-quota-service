
import { Router } from "express";
import swaggerUi from "swagger-ui-express";

const apiKeySecurity = [{ ApiKeyAuth: [] }];

const planLimits = {
  type: "object",
  properties: {
    monthlyAllowance: {
      type: "integer",
      minimum: 0,
      maximum: 9007199254740991,
      example: 5000,
    },
    maxUnitsPerRequest: {
      type: "integer",
      minimum: 1,
      maximum: 9007199254740991,
      example: 50,
    },
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
          name: { type: "string", example: "Test Company" },
          planId: { type: "string", format: "uuid" },
        },
      },
      CreateUser: {
        type: "object",
        required: ["externalUserId", "planId"],
        properties: {
          externalUserId: {
            type: "string",
            example: "user_002",
          },
          planId: { type: "string", format: "uuid" },
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
          ...planLimits.properties,
        },
      },
      UpdatePlan: {
        type: "object",
        properties: {
          name: { type: "string", example: "Business Plus" },
          ...planLimits.properties,
        },
      },
      AssignPlan: {
        type: "object",
        required: ["planId"],
        properties: {
          planId: { type: "string", format: "uuid" },
        },
      },
      ConsumeUnits: {
        type: "object",
        required: ["userId", "units", "requestId"],
        properties: {
          userId: { type: "string", format: "uuid" },
          units: {
            type: "integer",
            minimum: 1,
            maximum: 9007199254740991,
            example: 10,
          },
          requestId: {
            type: "string",
            example: "request-001",
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
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Check API and database health",
        responses: {
          "200": { description: "Healthy" },
          "503": { description: "Database unavailable" },
        },
      },
    },

   

    "/plans/mine": {
      get: {
        tags: ["Plans"],
        summary: "List plans available to this account",
        security: apiKeySecurity,
        responses: {
          "200": { description: "Available plans" },
          "401": { description: "Unauthorized" },
        },
      },
    },

    "/plans/{id}": {
      patch: {
        tags: ["Plans"],
        summary: "Update an owned custom plan",
        security: apiKeySecurity,
        parameters: [{
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/UpdatePlan",
              },
            },
          },
        },
        responses: {
          "200": { description: "Plan updated" },
          "400": { description: "Invalid input" },
          "401": { description: "Unauthorized" },
          "404": { description: "Custom plan not found" },
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
        security: apiKeySecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/CreatePlan",
              },
            },
          },
        },
        responses: {
          "201": { description: "Custom plan created" },
          "400": { description: "Invalid plan data" },
          "401": { description: "Unauthorized" },
        },
      },
    },

    "/accounts": {
      post: {
        tags: ["Accounts"],
        summary: "Create account and issue API key",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/CreateAccount",
              },
            },
          },
        },
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
        security: apiKeySecurity,
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
        security: apiKeySecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/AssignPlan",
              },
            },
          },
        },
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
        security: apiKeySecurity,
        responses: {
          "200": { description: "Users returned" },
          "401": { description: "Unauthorized" },
        },
      },
      post: {
        tags: ["Users"],
        summary: "Create user",
        security: apiKeySecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/CreateUser",
              },
            },
          },
        },
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
        security: apiKeySecurity,
        parameters: [{
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        }],
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
        summary: "Change user's plan",
        security: apiKeySecurity,
        parameters: [{
          name: "id",
          in: "path",
          required: true,
          schema: { type: "string", format: "uuid" },
        }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/AssignPlan",
              },
            },
          },
        },
        responses: {
          "200": { description: "User plan changed" },
          "400": { description: "Invalid plan" },
          "401": { description: "Unauthorized" },
          "404": { description: "User not found" },
        },
      },
    },

    "/consumption": {
      post: {
        tags: ["Consumption"],
        summary: "Consume units under account and user quotas",
        description:
          "An accepted request updates both account and user counters. A rejected request consumes nothing. Reusing the same request ID with identical data replays the original decision.",
        security: apiKeySecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/ConsumeUnits",
              },
            },
          },
        },
        responses: {
          "200": { description: "Accepted or rejected decision" },
          "400": { description: "Invalid request" },
          "401": { description: "Unauthorized" },
          "404": { description: "User not found" },
          "409": { description: "Conflicting requestId" },
        },
      },
    },
  },
};

// Export plain OpenAPI specification for inspection.
const swaggerRouter = Router();

swaggerRouter.get("/openapi.json", (_req, res) => {
  res.json(swaggerDocument);
});

swaggerRouter.use("/", swaggerUi.serve);
swaggerRouter.get("/", swaggerUi.setup(swaggerDocument));

export default swaggerRouter;
