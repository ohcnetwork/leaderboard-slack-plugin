/**
 * Leaderboard scraper to track EOD messages from a slack channel.
 */

import { anonymousEodUpdateQueries } from "@/src/lib/queries";
import { getSlackMessages, ingestEodUpdates } from "@/src/lib/scrape";
import {
  activityDefinitionQueries,
  type Plugin,
  type PluginContext,
} from "@ohcnetwork/leaderboard-api";
import { subDays } from "date-fns";

enum ActivityDefinitions {
  EOD_UPDATE = "eod_update",
}

const plugin: Plugin = {
  name: "@leaderboard/plugin-leaderboard-slack-plugin",
  version: "0.1.0",

  async setup(ctx: PluginContext) {
    ctx.logger.info("Setting up leaderboard-slack-plugin plugin...");

    activityDefinitionQueries.insertOrIgnore(ctx.db, {
      slug: ActivityDefinitions.EOD_UPDATE,
      name: "EOD Update",
      description: "EOD Update",
      points: 2,
      icon: "message-square",
    });

    await anonymousEodUpdateQueries.createTable(ctx.db);

    ctx.logger.info("Setup complete");
  },

  async scrape(ctx: PluginContext) {
    ctx.logger.info("Starting leaderboard-slack-plugin data scraping...");

    const days = 1;
    const since = days ? subDays(new Date(), days) : undefined;

    await getSlackMessages(ctx, since);
    await ingestEodUpdates(ctx);

    ctx.logger.info("Scraping complete");
  },
};

export default plugin;
