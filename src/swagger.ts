import { Router } from "express";
import swaggerUi from "swagger-ui-express";

const swaggerDocument = {
  openapi: "3.0.3",
  info: {
    title: "Usage Metering and Quota Service",
    version: "1.0.0",
    description:
      "REST API documentation for the Foothill backend project.",
  },
  servers: [
    {
      url: "/",
      description: "Current server",
    },
  ],
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
    },
  },
  tags: [
    { name: "Health", description: "Service health checks" },
    { name: "Plans", description: "Available plans" },
    { name: "Accounts", description: "Account management" },
    { name: "Users", description: "User management" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Check API and database health",
        responses: {
          "200": { description: "Service is healthy" },
          "503": { description: "Database unavailable" },
        },
      },
    },

    "/plans": {
      get: {
        tags: ["Plans"],
        summary: "List predefined plans",
        parameters: [
          {
            name: "type",
            in: "query",
            required: false,
            schema: {
              type: "string",
              enum: ["ACCOUNT", "USER"],
            },
          },
        ],
        responses: {
          "200": { description: "List of predefined plans" },
          "400": { description: "Invalid plan type" },
        },
      },
    },

    "/accounts": {
      post: {
        tags: ["Accounts"],
        summary: "Create account and generate API key",
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
          "201": {
            description: "Account created with API key",
          },
          "400": { description: "Invalid account data" },
        },
      },
    },

    "/accounts/me": {
      get: {
        tags: ["Accounts"],
        summary: "Get authenticated account",
        security: [{ ApiKeyAuth: [] }],
        responses: {
          "200": { description: "Account details" },
          "401": { description: "Missing or invalid API key" },
          "404": { description: "Account not found" },
        },
      },
    },

    "/users": {
      get: {
        tags: ["Users"],
        summary: "List users in authenticated account",
        security: [{ ApiKeyAuth: [] }],
        responses: {
          "200": { description: "Account users" },
          "401": { description: "Unauthorized" },
        },
      },

      post: {
        tags: ["Users"],
        summary: "Create user",
        security: [{ ApiKeyAuth: [] }],
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
          "400": { description: "Invalid request data" },
          "401": { description: "Unauthorized" },
          "409": { description: "User already exists" },
        },
      },
    },

    "/users/{id}": {
      get: {
        tags: ["Users"],
        summary: "Get user by ID",
        security: [{ ApiKeyAuth: [] }],
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: {
              type: "string",
              format: "uuid",
            },
          },
        ],
        responses: {
          "200": { description: "User details" },
          "400": { description: "Invalid user ID" },
          "401": { description: "Unauthorized" },
          "404": { description: "User not found" },
        },
      },
    },
  },
};

const swaggerRouter = Router();

swaggerRouter.use("/", swaggerUi.serve);
swaggerRouter.get("/", swaggerUi.setup(swaggerDocument));

export default swaggerRouter;