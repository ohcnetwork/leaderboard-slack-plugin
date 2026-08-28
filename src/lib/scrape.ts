import { WebClient } from "@slack/web-api";
import { format, subDays } from "date-fns";
import { toHTML } from "slack-markdown";
import {
  anonymousEodUpdateQueries,
  getContributorUsernamesBySlackUserIds,
} from "./queries";
import {
  Activity,
  activityQueries,
  PluginContext,
} from "@ohcnetwork/leaderboard-api";
import { getSlackWebClient } from "@/src/lib/slack-web-client";

interface ConversationHistoryResponse {
  messages: { type: string; user?: string; text?: string; ts: string }[];
}

/**
 * Collapses an error into a single short line for logs and error reports.
 */
function describeError(error: unknown, maxLength = 200): string {
  const raw =
    error instanceof Error ? error.message : String(error ?? "unknown error");
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed.length > maxLength
    ? `${collapsed.slice(0, maxLength)}…`
    : collapsed;
}

/**
 * Generate Unix timestamp from a Date object
 */
function generateTimestamp(date: Date): string {
  return (date.getTime() / 1000).toString();
}

/**
 * Get the date range for the Slack messages since a specific date
 * @param since - The date to start fetching messages from (optional, defaults to current date)
 * @returns An object with the oldest and latest dates
 */
function getDateRange(since?: Date) {
  const oldest = since ? new Date(since) : new Date();
  oldest.setHours(0, 0, 0, 0);

  const latest = new Date();
  latest.setHours(23, 59, 59, 999);

  return { oldest, latest };
}

/**
 * Fetch Slack messages for a given date range
 * @param oldest - Start date for message retrieval
 * @param latest - End date for message retrieval
 * @returns Array of Slack messages with user, text, timestamp, and permalink
 */
export async function getSlackMessages(ctx: PluginContext, since?: Date) {
  const { oldest, latest } = getDateRange(since);
  const slack = getSlackWebClient(ctx.config);

  const slackChannel = ctx.config.slackChannel as string;
  const logger = ctx.logger;

  logger.info(
    `Fetching Slack messages from ${slackChannel} between ${oldest.toISOString()} and ${latest.toISOString()}...`,
  );

  let stored = 0;
  let failed = 0;

  try {
    for await (const page of slack.paginate("conversations.history", {
      channel: slackChannel,
      oldest: generateTimestamp(oldest),
      latest: generateTimestamp(latest),
      limit: 100,
    })) {
      const messages = (page as unknown as ConversationHistoryResponse).messages
        .filter(
          (msg) =>
            msg.type === "message" &&
            msg.user &&
            msg.text &&
            msg.text.trim().length > 5, // ignore very short messages
        )
        .map((msg) => ({
          id: parseInt((parseFloat(msg.ts) * 1000).toString()), // slack's ts is a float, so we multiply by 1000 to get the timestamp in milliseconds
          user_id: msg.user!,
          text: toHTML(msg.text ?? ""),
          timestamp: new Date(Number(msg.ts) * 1000).toISOString(),
        }));

      logger.info(`Writing ${messages.length} messages to database`);
      for (const message of messages) {
        try {
          await anonymousEodUpdateQueries.upsert(ctx.db, message);
          stored++;
        } catch (error) {
          // One malformed message must not discard the rest of the page.
          failed++;
          logger.debug(
            `Failed to store Slack message ${message.id}: ${describeError(error)}`,
          );
        }
      }
    }
  } catch (error) {
    logger.error(
      `Stopped fetching Slack messages after storing ${stored}`,
      error as Error,
      { channel: slackChannel },
    );
  }

  if (failed > 0) {
    logger.warn(`Failed to store ${failed} Slack messages`);
  }

  return { stored, failed };
}

/**
 * Process pending EOD updates from the queue and convert them to activities
 * Matches Slack user IDs to contributors and creates activities for matched users
 * Optimized to use a single bulk query for contributor lookups
 */
export async function ingestEodUpdates(ctx: PluginContext) {
  ctx.logger.info("Starting EOD updates ingestion...");

  const updates = await anonymousEodUpdateQueries.getAllGroupedByUserId(ctx.db);
  ctx.logger.info(`Found ${updates.size} anonymous EOD updates`);

  // Bulk lookup all contributors by their Slack user IDs in a single query
  const slackUserIds = Array.from(updates.keys());
  const contributorMap = await getContributorUsernamesBySlackUserIds(
    ctx.db,
    slackUserIds,
  );

  let processedCount = 0;
  let skippedCount = 0;
  const warnings: string[] = [];
  const allActivities: Activity[] = [];
  const processedMessageIds: number[] = [];
  const activityMessageIds = new Map<string, number[]>();

  updates.forEach((userUpdates, user_id) => {
    // Look up the contributor from our pre-fetched map
    const contributorUsername = contributorMap.get(user_id);

    if (!contributorUsername) {
      ctx.logger.warn(
        `⚠️  No contributor found with slack_user_id: ${user_id} (${userUpdates.length} messages skipped)`,
      );
      warnings.push(user_id);
      skippedCount += userUpdates.length;
      return;
    }

    // Group messages by date (YYYY-MM-DD)
    const messagesByDate = new Map<
      string,
      { texts: string[]; timestamp: Date; ids: number[] }
    >();

    for (let i = 0; i < userUpdates.length; i++) {
      const update = userUpdates[i];
      if (!update) continue;
      const date = format(update.timestamp, "yyyy-MM-dd");
      if (!date) continue;

      if (!messagesByDate.has(date)) {
        messagesByDate.set(date, {
          texts: [],
          timestamp: new Date(update.timestamp),
          ids: [update.id],
        });
      }

      const dateEntry = messagesByDate.get(date);
      if (dateEntry) {
        dateEntry.texts.push(update.text);
        dateEntry.ids.push(update.id);
      }
    }

    for (const [
      date,
      { texts: dayTexts, timestamp, ids },
    ] of messagesByDate.entries()) {
      const mergedText = dayTexts.join("\n\n");
      const slug = `eod_update_${date}_${contributorUsername}`;

      allActivities.push({
        slug,
        contributor: contributorUsername,
        activity_definition: "eod_update",
        title: "EOD Update",
        occurred_at: timestamp.toISOString(),
        link: null,
        text: mergedText,
        points: null,
        meta: null,
      });

      // Track processed message IDs for bulk deletion
      activityMessageIds.set(slug, ids);
      processedMessageIds.push(...ids);
      processedCount += ids.length;
    }

    ctx.logger.info(
      `✓ Prepared ${messagesByDate.size} EOD activities for ${contributorUsername}`,
    );
  });

  if (allActivities.length > 0) {
    let inserted = 0;
    const failedSlugs = new Set<string>();

    for (const activity of allActivities) {
      try {
        await activityQueries.upsert(ctx.db, activity);
        inserted++;
      } catch (error) {
        failedSlugs.add(activity.slug);
        ctx.logger.debug(
          `Failed to upsert EOD activity ${activity.slug}: ${describeError(error)}`,
        );
      }
    }

    ctx.logger.info(`✓ Inserted ${inserted} total EOD activities`);

    if (failedSlugs.size > 0) {
      ctx.logger.error(
        `Failed to upsert ${failedSlugs.size} of ${allActivities.length} EOD activities`,
      );
      // Keep the source messages so the next run can retry the failed days.
      for (const [slug, ids] of activityMessageIds) {
        if (failedSlugs.has(slug)) {
          for (const id of ids) {
            const index = processedMessageIds.indexOf(id);
            if (index !== -1) processedMessageIds.splice(index, 1);
          }
        }
      }
    }
  }

  for (const id of processedMessageIds) {
    try {
      await anonymousEodUpdateQueries.delete(ctx.db, id);
    } catch (error) {
      ctx.logger.debug(
        `Failed to delete processed Slack message ${id}: ${describeError(error)}`,
      );
    }
  }

  ctx.logger.info("\n=== EOD Ingestion Summary ===");
  ctx.logger.info(`Processed: ${processedCount} messages`);
  ctx.logger.info(`Skipped: ${skippedCount} messages`);
  if (warnings.length > 0) {
    ctx.logger.info(
      `\nUnmatched Slack user IDs (${warnings.length}): ${warnings.join(", ")}`,
    );
  }
  ctx.logger.info("=============================");
}
