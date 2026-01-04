/**
 * Tests for leaderboard-slack-plugin plugin
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createDatabase,
  initializeSchema,
  activityDefinitionQueries,
  activityQueries,
} from "@leaderboard/api";
import type { Database } from "@leaderboard/api";
import plugin from "../index";

// Mock the Slack Web API
vi.mock("@slack/web-api", () => {
  class MockWebClient {
    async *paginate() {
      // Mock empty response - no messages
      yield { messages: [] };
    }
  }

  return {
    WebClient: MockWebClient,
  };
});

describe("Leaderboard-slack-plugin Plugin", () => {
  let db: Database;

  beforeEach(async () => {
    db = createDatabase(":memory:");
    await initializeSchema(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it("should have correct plugin metadata", () => {
    expect(plugin.name).toBe("@leaderboard/plugin-leaderboard-slack-plugin");
    expect(plugin.version).toBeTruthy();
    expect(plugin.scrape).toBeDefined();
  });

  it("should setup activity definitions", async () => {
    const logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    if (plugin.setup) {
      await plugin.setup({
        db,
        dataDirectory: "",
        config: {
          slackChannel: "test-channel",
          slackApiToken: "xoxb-test-token",
        },
        orgConfig: {
          name: "Test Org",
          description: "Test",
          url: "https://test.com",
          logo_url: "https://test.com/logo.png",
        },
        logger,
      });
    }

    // Verify activity definition was created
    const activityDef = await activityDefinitionQueries.getBySlug(
      db,
      "eod_update"
    );
    expect(activityDef).toBeDefined();
    expect(activityDef).toMatchObject({
      slug: "eod_update",
      name: "EOD Update",
      points: 2,
    });
  });

  it("should scrape data", async () => {
    const logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

    const config = {
      slackChannel: "test-channel",
      slackApiToken: "xoxb-test-token",
    };

    // Setup first if needed
    if (plugin.setup) {
      await plugin.setup({
        db,
        dataDirectory: "",
        config,
        orgConfig: {
          name: "Test Org",
          description: "Test",
          url: "https://test.com",
          logo_url: "https://test.com/logo.png",
        },
        logger,
      });
    }

    // Then scrape
    await plugin.scrape({
      db,
      dataDirectory: "",
      config,
      orgConfig: {
        name: "Test Org",
        description: "Test",
        url: "https://test.com",
        logo_url: "https://test.com/logo.png",
      },
      logger,
    });

    // Verify scrape completed without errors
    // With mocked empty messages, there should be no activities created
    const activities = await activityQueries.getAll(db);
    expect(activities).toEqual([]);
  });
});
